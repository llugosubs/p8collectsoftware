-- ============================================================================
-- 0018 — Abrir un break (Fase 2)
--
-- Abrir una caja toca cuatro tablas y tiene que ser todo o nada: si se crean
-- los hijos y falla el costo, queda inventario cuyo costo se perdió en el
-- camino, y el margen de cada carta que salga de ahí es mentira durante meses.
--
-- `supabase-js` no da transacciones, así que la escritura entra por esta
-- función, que corre entera en una. NO calcula nada: el reparto lo hace
-- `lib/domain/breaks.ts` y llega ya resuelto. Lo único que hace con números es
-- ASERTAR que la suma de los hijos es exactamente el costo de la caja.
--
-- `security invoker`: corre con el rol de quien llama, así que el RLS sigue
-- decidiendo. Un `staff` simplemente no puede escribir en `item_costs`, y por
-- eso el reparto puede quedar pendiente para un admin sin que la caja se quede
-- abierta a medias.
-- ============================================================================

alter table public.breaks
  add column cost_allocated_at timestamptz;

comment on column public.breaks.cost_allocated_at is
  'Cuándo se repartió el costo de la caja entre los hijos. NULL = pendiente, normalmente porque quien abrió el break no puede ver costos.';

create or replace function public.open_break(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source          public.items%rowtype;
  v_break_id        uuid;
  v_child           jsonb;
  v_child_id        uuid;
  v_child_ids       uuid[] := '{}';
  v_costs_total     numeric(14,4) := 0;
  v_box_cost        numeric(14,4);
  v_has_costs       boolean := false;
  v_children_count  int;
begin
  select * into v_source
  from public.items
  where id = (p_payload ->> 'source_item_id')::uuid
  for update;

  if not found then
    raise exception 'La caja no existe o no la puedes ver.' using errcode = 'P0002';
  end if;

  if v_source.type not in ('sealed_box', 'sealed_pack', 'lot') then
    raise exception 'Solo se abren cajas, sobres o lotes sellados.' using errcode = 'P0001';
  end if;

  if v_source.status in ('consumed', 'sold') then
    raise exception 'Esa caja ya se abrió o se vendió.' using errcode = 'P0001';
  end if;

  -- Una fila con cantidad > 1 son varias cajas. Abrirla pasaría las tres a
  -- 'consumed' y el índice único de breaks impediría abrir la segunda: se
  -- perdería existencia real. Hay que separarlas primero.
  if v_source.quantity <> 1 then
    raise exception
      'Esa fila tiene % unidades. Sepárala en filas de una antes de abrir el break.',
      v_source.quantity
      using errcode = 'P0001';
  end if;

  v_children_count := jsonb_array_length(p_payload -> 'children');
  if v_children_count is null or v_children_count = 0 then
    raise exception 'Un break sin cartas no se registra.' using errcode = 'P0001';
  end if;

  insert into public.breaks
    (source_item_id, opened_at, platform, revenue_from_spots, notes, created_by)
  values (
    v_source.id,
    coalesce((p_payload ->> 'opened_at')::timestamptz, now()),
    nullif(p_payload ->> 'platform', '')::public.sales_channel,
    coalesce((p_payload ->> 'revenue_from_spots')::numeric, 0),
    nullif(p_payload ->> 'notes', ''),
    auth.uid()
  )
  returning id into v_break_id;

  for v_child in select * from jsonb_array_elements(p_payload -> 'children')
  loop
    insert into public.items (
      type, category, sport_or_game, player_or_character, brand, set_name, year,
      card_number, variant, serial_numbered, language, grading_company, grade,
      cert_number, raw_condition, status, location,
      -- Los hijos heredan dueño y consignante de la caja. Si la caja era de un
      -- tercero, las cartas que salen también lo son.
      owner_type, consignor_id, acquisition_id, parent_item_id,
      market_value, created_by
    )
    values (
      coalesce(nullif(v_child ->> 'type', ''), 'raw_card')::public.item_type,
      v_source.category,
      coalesce(nullif(v_child ->> 'sport_or_game', ''), v_source.sport_or_game),
      nullif(v_child ->> 'player_or_character', ''),
      coalesce(nullif(v_child ->> 'brand', ''), v_source.brand),
      coalesce(nullif(v_child ->> 'set_name', ''), v_source.set_name),
      coalesce((v_child ->> 'year')::int, v_source.year),
      nullif(v_child ->> 'card_number', ''),
      nullif(v_child ->> 'variant', ''),
      nullif(v_child ->> 'serial_numbered', ''),
      coalesce(nullif(v_child ->> 'language', ''), v_source.language),
      coalesce(nullif(v_child ->> 'grading_company', ''), 'none')::public.grading_company,
      (v_child ->> 'grade')::numeric,
      nullif(v_child ->> 'cert_number', ''),
      nullif(v_child ->> 'raw_condition', '')::public.raw_condition,
      'in_stock',
      v_source.location,
      v_source.owner_type,
      v_source.consignor_id,
      v_source.acquisition_id,
      v_source.id,
      (v_child ->> 'market_value')::numeric,
      auth.uid()
    )
    returning id into v_child_id;

    v_child_ids := array_append(v_child_ids, v_child_id);

    if (v_child ? 'allocated_cost') and (v_child ->> 'allocated_cost') is not null then
      v_has_costs := true;
      insert into public.item_costs (item_id, allocated_cost, created_by)
      values (v_child_id, (v_child ->> 'allocated_cost')::numeric, auth.uid());
      v_costs_total := v_costs_total + (v_child ->> 'allocated_cost')::numeric;
    end if;
  end loop;

  if v_has_costs then
    select cost_basis into v_box_cost from public.item_costs where item_id = v_source.id;

    if v_box_cost is null then
      raise exception 'La caja no tiene costo registrado: no hay nada que repartir.'
        using errcode = 'P0001';
    end if;

    -- El invariante. Si esto salta, el reparto que llegó está mal y no se
    -- escribe nada: abrir una caja no crea ni destruye dinero.
    if v_costs_total <> v_box_cost then
      raise exception
        'El reparto no cuadra: las cartas suman % y la caja costó %.',
        v_costs_total, v_box_cost
        using errcode = 'P0001';
    end if;

    update public.breaks set cost_allocated_at = now() where id = v_break_id;
  end if;

  update public.items
  set status = 'consumed'
  where id = v_source.id;

  return jsonb_build_object(
    'break_id', v_break_id,
    'child_ids', to_jsonb(v_child_ids),
    'cost_allocated', v_has_costs
  );
end;
$$;

-- En Postgres el EXECUTE de una función nueva se concede a PUBLIC por defecto.
-- Revocar solo de `anon` no le quitaría nada: lo seguiría teniendo por esa vía.
revoke execute on function public.open_break(jsonb) from public;
grant execute on function public.open_break(jsonb) to authenticated, service_role;
