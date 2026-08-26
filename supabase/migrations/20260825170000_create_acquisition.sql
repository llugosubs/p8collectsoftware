-- ============================================================================
-- 0019 — Registrar un lote de compra (Fase 2)
--
-- La MISMA función la usan el wizard de Compras y el importador de Excel. Si
-- cada uno inventara su camino habría tres sitios donde el prorrateo puede
-- quedar mal, y el costo es la cifra que decide si una venta ganó o perdió.
--
-- Un lote a medio escribir es peor que ningún lote: deja inventario fantasma
-- con SKU consumido y un total que no cuadra con la suma de sus piezas.
-- `supabase-js` no da transacciones; una función plpgsql sí.
--
-- La función NO calcula. Recibe los `allocated_cost` ya resueltos por
-- `lib/domain/allocation.ts` y solo ASERTA los dos invariantes.
-- ============================================================================

create or replace function public.create_acquisition(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key             text;
  v_existing        uuid;
  v_acquisition_id  uuid;
  v_total_cost      numeric(14,4);
  v_line            jsonb;
  v_item            jsonb;
  v_item_id         uuid;
  v_item_ids        uuid[] := '{}';
  v_hammer_sum      numeric(14,4) := 0;
  v_cost_sum        numeric(14,4) := 0;
  v_has_costs       boolean := false;
  v_declared_hammer numeric(14,4);
  v_received        boolean;
begin
  if jsonb_array_length(coalesce(p_payload -> 'lines', '[]'::jsonb)) = 0 then
    raise exception 'Un lote sin líneas no se registra.' using errcode = 'P0001';
  end if;

  -- Idempotencia: dos toques en "Confirmar", o un reintento tras un timeout de
  -- red con la transacción ya comprometida, devuelven el lote que ya existe en
  -- vez de crear otro con el doble de piezas y el doble de SKU consumidos.
  v_key := nullif(p_payload ->> 'idempotency_key', '');
  if v_key is not null then
    select id into v_existing from public.acquisitions where idempotency_key = v_key;
    if found then
      return jsonb_build_object(
        'acquisition_id', v_existing,
        'item_ids', (
          select coalesce(to_jsonb(array_agg(item_id order by line_number)), '[]'::jsonb)
          from public.acquisition_lines where acquisition_id = v_existing
        ),
        'already_existed', true
      );
    end if;
  end if;

  v_received := coalesce((p_payload ->> 'received_status') = 'received', false);

  insert into public.acquisitions (
    platform, reference, purchased_at, currency,
    hammer_total, buyer_premium, card_fee, shipping_intl,
    courier_ve, customs_ve, other_costs,
    courier_ve_ves, customs_ve_ves, local_fx_rate, local_fx_rate_source,
    fx_rate, fx_rate_source, due_at,
    payment_status, received_status, notes, idempotency_key, created_by
  )
  values (
    (p_payload ->> 'platform')::public.acquisition_platform,
    nullif(p_payload ->> 'reference', ''),
    (p_payload ->> 'purchased_at')::date,
    coalesce(nullif(p_payload ->> 'currency', ''), 'USD'),
    coalesce((p_payload ->> 'hammer_total')::numeric, 0),
    coalesce((p_payload ->> 'buyer_premium')::numeric, 0),
    coalesce((p_payload ->> 'card_fee')::numeric, 0),
    coalesce((p_payload ->> 'shipping_intl')::numeric, 0),
    coalesce((p_payload ->> 'courier_ve')::numeric, 0),
    coalesce((p_payload ->> 'customs_ve')::numeric, 0),
    coalesce((p_payload ->> 'other_costs')::numeric, 0),
    (p_payload ->> 'courier_ve_ves')::numeric,
    (p_payload ->> 'customs_ve_ves')::numeric,
    (p_payload ->> 'local_fx_rate')::numeric,
    nullif(p_payload ->> 'local_fx_rate_source', '')::public.fx_source,
    (p_payload ->> 'fx_rate')::numeric,
    nullif(p_payload ->> 'fx_rate_source', '')::public.fx_source,
    (p_payload ->> 'due_at')::date,
    coalesce(nullif(p_payload ->> 'payment_status', ''), 'pending')::public.acquisition_payment_status,
    coalesce(nullif(p_payload ->> 'received_status', ''), 'pending')::public.acquisition_received_status,
    nullif(p_payload ->> 'notes', ''),
    v_key,
    auth.uid()
  )
  returning id, total_cost into v_acquisition_id, v_total_cost;

  for v_line in select * from jsonb_array_elements(p_payload -> 'lines')
  loop
    v_item := v_line -> 'item';

    insert into public.items (
      type, category, sport_or_game, player_or_character, brand, set_name, year,
      card_number, variant, serial_numbered, is_rookie, is_autograph, is_patch,
      language, grading_company, grade, grade_label, cert_number, raw_condition,
      quantity, status, location, owner_type, consignor_id, acquisition_id,
      market_value, market_value_source, market_value_at,
      list_price, min_price, created_by, received_at
    )
    values (
      (v_item ->> 'type')::public.item_type,
      (v_item ->> 'category')::public.item_category,
      nullif(v_item ->> 'sport_or_game', ''),
      nullif(v_item ->> 'player_or_character', ''),
      nullif(v_item ->> 'brand', ''),
      nullif(v_item ->> 'set_name', ''),
      (v_item ->> 'year')::int,
      nullif(v_item ->> 'card_number', ''),
      nullif(v_item ->> 'variant', ''),
      nullif(v_item ->> 'serial_numbered', ''),
      coalesce((v_item ->> 'is_rookie')::boolean, false),
      coalesce((v_item ->> 'is_autograph')::boolean, false),
      coalesce((v_item ->> 'is_patch')::boolean, false),
      nullif(v_item ->> 'language', ''),
      coalesce(nullif(v_item ->> 'grading_company', ''), 'none')::public.grading_company,
      (v_item ->> 'grade')::numeric,
      nullif(v_item ->> 'grade_label', ''),
      nullif(v_item ->> 'cert_number', ''),
      nullif(v_item ->> 'raw_condition', '')::public.raw_condition,
      coalesce((v_item ->> 'quantity')::int, 1),
      -- Si el lote ya llegó, las piezas nacen disponibles. Si no, en tránsito.
      case when v_received then 'in_stock' else 'incoming' end::public.item_status,
      nullif(v_item ->> 'location', ''),
      coalesce(nullif(v_item ->> 'owner_type', ''), 'own')::public.owner_type,
      nullif(v_item ->> 'consignor_id', '')::uuid,
      v_acquisition_id,
      (v_item ->> 'market_value')::numeric,
      case when (v_item ->> 'market_value') is not null then 'manual' end,
      case when (v_item ->> 'market_value') is not null then now() end,
      (v_item ->> 'list_price')::numeric,
      (v_item ->> 'min_price')::numeric,
      auth.uid(),
      case when v_received then now() end
    )
    returning id into v_item_id;

    v_item_ids := array_append(v_item_ids, v_item_id);

    insert into public.acquisition_lines
      (acquisition_id, item_id, line_number, hammer_price, notes, created_by)
    values (
      v_acquisition_id,
      v_item_id,
      (v_line ->> 'line_number')::int,
      (v_line ->> 'hammer_price')::numeric,
      nullif(v_line ->> 'notes', ''),
      auth.uid()
    );

    v_hammer_sum := v_hammer_sum + (v_line ->> 'hammer_price')::numeric;

    if (v_line ? 'allocated_cost') and (v_line ->> 'allocated_cost') is not null then
      v_has_costs := true;
      insert into public.item_costs (item_id, allocated_cost, created_by)
      values (v_item_id, (v_line ->> 'allocated_cost')::numeric, auth.uid());
      v_cost_sum := v_cost_sum + (v_line ->> 'allocated_cost')::numeric;
    end if;
  end loop;

  -- Invariante 1: el martillo declarado del lote es la suma de sus líneas.
  v_declared_hammer := coalesce((p_payload ->> 'hammer_total')::numeric, 0);
  if v_hammer_sum <> v_declared_hammer then
    raise exception
      'El martillo no cuadra: las líneas suman % y el lote declara %.',
      v_hammer_sum, v_declared_hammer
      using errcode = 'P0001';
  end if;

  -- Invariante 2: lo que costó cada pieza suma exactamente lo que costó el lote.
  if v_has_costs and v_cost_sum <> v_total_cost then
    raise exception
      'El prorrateo no cuadra: las piezas suman % y el lote costó %.',
      v_cost_sum, v_total_cost
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'acquisition_id', v_acquisition_id,
    'item_ids', to_jsonb(v_item_ids),
    'total_cost', v_total_cost,
    'already_existed', false
  );
end;
$$;

revoke execute on function public.create_acquisition(jsonb) from public;
grant execute on function public.create_acquisition(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Marcar un lote como recibido
--
-- Son dos cosas a la vez, y por eso va aquí y no en dos llamadas sueltas: el
-- lote cambia de estado y sus piezas pasan de 'en tránsito' a disponibles con
-- su fecha de recepción. Sin esto, el lote llegaría a Caracas y las quince
-- cartas seguirían invisibles como inventario.
-- ---------------------------------------------------------------------------
create or replace function public.set_acquisition_received(
  p_acquisition_id uuid,
  p_status public.acquisition_received_status
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated int := 0;
begin
  update public.acquisitions
  set received_status = p_status
  where id = p_acquisition_id and deleted_at is null;

  if not found then
    raise exception 'Ese lote no existe o no lo puedes ver.' using errcode = 'P0002';
  end if;

  if p_status = 'received' then
    update public.items
    set status = 'in_stock',
        received_at = coalesce(received_at, now())
    where acquisition_id = p_acquisition_id
      and status = 'incoming'
      and deleted_at is null;

    get diagnostics v_updated = row_count;
  end if;

  return jsonb_build_object('items_released', v_updated);
end;
$$;

revoke execute on function public.set_acquisition_received(uuid, public.acquisition_received_status) from public;
grant execute on function public.set_acquisition_received(uuid, public.acquisition_received_status)
  to authenticated, service_role;
