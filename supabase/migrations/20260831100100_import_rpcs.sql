-- ============================================================================
-- 0021 — Confirmar y revertir un lote importado (Fase 2, Entrega C)
--
-- `commit_import_batch` no crea inventario por su cuenta: llama a
-- `create_acquisition` una vez por lote, la MISMA función del wizard de
-- Compras. Aquí solo se hace lo que aquella no puede hacer — enlazar cada fila
-- del archivo con el item que produjo, dentro de la misma transacción.
--
-- Ese enlace es lo que hace posible la reversión. Si se escribiera después de
-- confirmar, un fallo entre las dos escrituras dejaría cientos de items
-- creados sin registro de cuáles son.
-- ============================================================================

create or replace function public.commit_import_batch(
  p_batch_id uuid,
  p_payload  jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch        public.import_batches%rowtype;
  v_group        jsonb;
  v_lines        jsonb;
  v_result       jsonb;
  v_item_ids     jsonb;
  v_acq_id       uuid;
  v_idx          int;
  v_row_id       uuid;
  v_item_id      uuid;
  v_update       jsonb;
  v_patch        jsonb;
  v_status       text;
  v_acq_ids      uuid[] := '{}';
  v_total_cost   numeric(14,4) := 0;
  v_counts       record;
  v_summary      jsonb;
begin
  select * into v_batch
  from public.import_batches
  where id = p_batch_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Ese lote de importación no existe o no lo puedes ver.'
      using errcode = 'P0002';
  end if;

  -- Idempotencia a nivel de lote. Si la transacción se comprometió y la
  -- respuesta se perdió en el camino, el segundo toque en "Confirmar" devuelve
  -- lo que ya pasó en vez de importar el archivo dos veces.
  if v_batch.status = 'committed' then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'already_committed', true,
      'rows_created', v_batch.rows_created,
      'rows_updated', v_batch.rows_updated,
      'rows_skipped', v_batch.rows_skipped,
      'rows_error', v_batch.rows_error,
      'summary', v_batch.summary
    );
  end if;

  if v_batch.status = 'reverted' then
    raise exception 'Ese lote se revirtió. Vuelve a subir el archivo.'
      using errcode = 'P0001';
  end if;

  -- -------------------------------------------------------------------------
  -- Un lote de compra por grupo
  -- -------------------------------------------------------------------------
  for v_group in
    select * from jsonb_array_elements(coalesce(p_payload -> 'groups', '[]'::jsonb))
  loop
    v_lines := v_group -> 'lines';

    if v_lines is null or jsonb_array_length(v_lines) = 0 then
      raise exception 'Un grupo del archivo llegó sin filas.' using errcode = 'P0001';
    end if;

    v_result := public.create_acquisition(v_group);
    v_acq_id := (v_result ->> 'acquisition_id')::uuid;
    v_item_ids := v_result -> 'item_ids';

    -- Si el lote ya existía, la clave de idempotencia de este archivo chocó con
    -- la de otro: los items que devuelve no son los de estas filas y enlazarlos
    -- registraría una mentira. Se para todo.
    if coalesce((v_result ->> 'already_existed')::boolean, false) then
      raise exception
        'La clave de idempotencia del grupo % ya se había usado en otro lote.',
        coalesce(v_group ->> 'group_key', v_group ->> 'reference', '(sin referencia)')
        using errcode = 'P0001';
    end if;

    if jsonb_array_length(v_item_ids) <> jsonb_array_length(v_lines) then
      raise exception
        'El lote creó % piezas para % filas. No se puede saber cuál es cuál.',
        jsonb_array_length(v_item_ids), jsonb_array_length(v_lines)
        using errcode = 'P0001';
    end if;

    v_acq_ids := array_append(v_acq_ids, v_acq_id);
    v_total_cost := v_total_cost + coalesce((v_result ->> 'total_cost')::numeric, 0);

    -- El enlace fila → item. Aquí dentro, no después.
    for v_idx in 0 .. jsonb_array_length(v_lines) - 1
    loop
      v_row_id := nullif(v_lines -> v_idx ->> 'row_id', '')::uuid;
      v_item_id := (v_item_ids ->> v_idx)::uuid;

      if v_row_id is null then
        raise exception 'Una línea del grupo % llegó sin `row_id`.',
          coalesce(v_group ->> 'group_key', '(sin clave)')
          using errcode = 'P0001';
      end if;

      update public.import_batch_rows
      set item_id        = v_item_id,
          acquisition_id = v_acq_id,
          result         = 'created',
          error_message  = null
      where id = v_row_id and batch_id = p_batch_id;

      if not found then
        raise exception 'La fila % no pertenece a este lote de importación.', v_row_id
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- Filas que actualizan una pieza que ya existe
  --
  -- Solo se toca lo que §7.12 permite actualizar: precio, valor de mercado,
  -- ubicación y si ya llegó. El COSTO nunca — una fila duplicada no vuelve a
  -- comprar la carta, y sumarle costo otra vez inflaría la base de golpe.
  -- -------------------------------------------------------------------------
  for v_update in
    select * from jsonb_array_elements(coalesce(p_payload -> 'updates', '[]'::jsonb))
  loop
    v_row_id := nullif(v_update ->> 'row_id', '')::uuid;
    v_item_id := nullif(v_update ->> 'item_id', '')::uuid;
    v_patch := coalesce(v_update -> 'patch', '{}'::jsonb);
    v_status := nullif(v_patch ->> 'status', '');

    if v_row_id is null or v_item_id is null then
      raise exception 'Una actualización llegó sin fila o sin pieza.' using errcode = 'P0001';
    end if;

    -- El importador mueve una pieza de "en tránsito" a "disponible" y nada más.
    -- Vender, reservar o dar por perdida una carta se hace en su módulo, con su
    -- rastro; no desde una celda de un Excel.
    if v_status is not null and v_status not in ('incoming', 'in_stock') then
      raise exception 'El importador no puede poner una pieza en estado "%".', v_status
        using errcode = 'P0001';
    end if;

    update public.items i
    set market_value     = coalesce((v_patch ->> 'market_value')::numeric, i.market_value),
        market_value_at  = case when (v_patch ->> 'market_value') is not null
                                then now() else i.market_value_at end,
        market_value_source = case when (v_patch ->> 'market_value') is not null
                                then 'manual' else i.market_value_source end,
        list_price       = coalesce((v_patch ->> 'list_price')::numeric, i.list_price),
        min_price        = coalesce((v_patch ->> 'min_price')::numeric, i.min_price),
        location         = coalesce(nullif(v_patch ->> 'location', ''), i.location),
        status           = coalesce(v_status::public.item_status, i.status),
        received_at      = case when v_status = 'in_stock'
                                then coalesce(i.received_at, now()) else i.received_at end
    where i.id = v_item_id and i.deleted_at is null;

    if not found then
      raise exception 'La pieza % ya no existe o no la puedes editar.', v_item_id
        using errcode = 'P0002';
    end if;

    update public.import_batch_rows
    set item_id       = v_item_id,
        result        = 'updated',
        error_message = null
    where id = v_row_id and batch_id = p_batch_id;

    if not found then
      raise exception 'La fila % no pertenece a este lote de importación.', v_row_id
        using errcode = 'P0001';
    end if;
  end loop;

  -- Todo lo que no se creó ni se actualizó tiene un desenlace igual: o se
  -- omitió, o traía un error. El motivo sigue en `state`.
  update public.import_batch_rows
  set result = case when state = 'error' then 'error'::public.import_row_result
                    else 'skipped'::public.import_row_result end
  where batch_id = p_batch_id and result is null;

  -- Los contadores se cuentan, no se creen. Si el navegador mandó un resumen
  -- que no cuadra con las filas, manda la tabla.
  select
    count(*)::int                                            as total,
    count(*) filter (where result = 'created')::int          as created,
    count(*) filter (where result = 'updated')::int          as updated,
    count(*) filter (where result = 'skipped')::int          as skipped,
    count(*) filter (where result = 'error')::int            as errored
  into v_counts
  from public.import_batch_rows
  where batch_id = p_batch_id;

  v_summary := coalesce(p_payload -> 'summary', '{}'::jsonb)
    || jsonb_build_object(
         'acquisitions', to_jsonb(v_acq_ids),
         'acquisitions_count', coalesce(array_length(v_acq_ids, 1), 0),
         'total_invested', v_total_cost
       );

  update public.import_batches
  set status       = 'committed',
      committed_at = now(),
      rows_total   = v_counts.total,
      rows_created = v_counts.created,
      rows_updated = v_counts.updated,
      rows_skipped = v_counts.skipped,
      rows_error   = v_counts.errored,
      summary      = v_summary
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'already_committed', false,
    'rows_created', v_counts.created,
    'rows_updated', v_counts.updated,
    'rows_skipped', v_counts.skipped,
    'rows_error', v_counts.errored,
    'summary', v_summary
  );
end;
$$;

revoke execute on function public.commit_import_batch(uuid, jsonb) from public;
grant execute on function public.commit_import_batch(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Revertir un lote importado
--
-- No es un DELETE. Es borrado suave con guardias, porque el momento en que
-- alguien revierte es exactamente el momento en que está apurado y con menos
-- atención de lo normal.
--
-- La guardia NO puede bloquear por "lote recibido": un lote recibido es el
-- caso normal del archivo semanal, y bloquear ahí sería no tener reversión.
-- Lo que bloquea es que una pieza haya tomado vida propia — vendida, en un
-- pedido, publicada, fotografiada, abierta en un break o con pagos hechos.
-- ---------------------------------------------------------------------------
create or replace function public.revert_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch     public.import_batches%rowtype;
  v_window    int;
  v_days      numeric;
  v_problems  text[];
  v_items     int := 0;
  v_acqs      int := 0;
begin
  select * into v_batch
  from public.import_batches
  where id = p_batch_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Ese lote de importación no existe o no lo puedes ver.'
      using errcode = 'P0002';
  end if;

  if v_batch.status <> 'committed' then
    raise exception 'Solo se revierte un lote confirmado. Este está en "%".', v_batch.status
      using errcode = 'P0001';
  end if;

  select coalesce((value #>> '{}')::int, 7) into v_window
  from public.settings where key = 'import_revert_window_days';
  v_window := coalesce(v_window, 7);

  v_days := extract(epoch from (now() - v_batch.committed_at)) / 86400.0;
  if v_days > v_window then
    raise exception
      'Ese lote se confirmó hace % días y la ventana para revertir es de %.',
      floor(v_days), v_window
      using errcode = 'P0001';
  end if;

  -- Las piezas que ya no se pueden deshacer, cada una con su motivo. Se listan
  -- todas de una vez: descubrirlas de a una, reintentando, es insoportable.
  with lote as (
    select i.id, i.sku, i.status, i.is_published
    from public.items i
    join public.import_batch_rows r on r.item_id = i.id
    where r.batch_id = p_batch_id
      and r.result = 'created'
      and i.deleted_at is null
  )
  select array_agg(msg order by msg) into v_problems
  from (
    select l.sku || ' — está en estado "' || l.status::text || '"' as msg
      from lote l where l.status not in ('incoming', 'in_stock')
    union all
    select l.sku || ' — está publicada en la tienda'
      from lote l where l.is_published
    union all
    select l.sku || ' — ya tiene fotos cargadas'
      from lote l
      where exists (select 1 from public.item_images im where im.item_id = l.id)
    union all
    select l.sku || ' — se abrió en un break'
      from lote l
      where exists (select 1 from public.breaks b
                    where b.source_item_id = l.id and b.deleted_at is null)
    union all
    select l.sku || ' — tiene cartas que salieron de ella'
      from lote l
      where exists (select 1 from public.items c
                    where c.parent_item_id = l.id and c.deleted_at is null)
    union all
    select l.sku || ' — está en un pedido'
      from lote l
      where exists (select 1 from public.order_lines ol where ol.item_id = l.id)
  ) x;

  -- Y los lotes de compra que ya se pagaron: deshacer la compra dejaría el pago
  -- apuntando al vacío y descuadraría la tesorería.
  if exists (
    select 1
    from public.payments p
    where p.deleted_at is null
      and p.acquisition_id in (
        select distinct r.acquisition_id
        from public.import_batch_rows r
        where r.batch_id = p_batch_id and r.acquisition_id is not null
      )
  ) then
    v_problems := coalesce(v_problems, '{}') || array['Hay pagos registrados contra los lotes de compra de este archivo'];
  end if;

  if v_problems is not null and array_length(v_problems, 1) > 0 then
    -- Sin contador: en español, "1 impedimentos" delata que el mensaje lo
    -- armó una máquina, y este mensaje se lee justo cuando alguien está
    -- deshaciendo algo con prisa.
    raise exception E'No se puede revertir. Esto lo impide:\n%',
      array_to_string(v_problems[1:10], E'\n')
      using errcode = 'P0001';
  end if;

  update public.items
  set deleted_at = now()
  where deleted_at is null
    and id in (
      select r.item_id from public.import_batch_rows r
      where r.batch_id = p_batch_id and r.result = 'created' and r.item_id is not null
    );
  get diagnostics v_items = row_count;

  -- El lote de compra se borra solo si TODAS sus piezas eran de este archivo.
  -- Si alguien le agregó una línea a mano, el lote se queda: borrarlo se
  -- llevaría por delante una compra que nadie pidió deshacer.
  update public.acquisitions a
  set deleted_at = now()
  where a.deleted_at is null
    and a.id in (
      select distinct r.acquisition_id from public.import_batch_rows r
      where r.batch_id = p_batch_id and r.acquisition_id is not null
    )
    and not exists (
      select 1 from public.items i
      where i.acquisition_id = a.id and i.deleted_at is null
    );
  get diagnostics v_acqs = row_count;

  update public.import_batches
  set status      = 'reverted',
      reverted_at = now(),
      reverted_by = auth.uid()
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'items_deleted', v_items,
    'acquisitions_deleted', v_acqs
  );
end;
$$;

revoke execute on function public.revert_import_batch(uuid) from public;
grant execute on function public.revert_import_batch(uuid) to authenticated, service_role;
