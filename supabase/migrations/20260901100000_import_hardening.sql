-- ============================================================================
-- 0022 — Deuda de la Entrega C, encontrada con crítica adversarial
--
-- El camino de ACTUALIZAR del importador comprobaba el estado DESTINO de la
-- pieza pero no el ACTUAL. Una carta vendida en septiembre que siguiera en el
-- Excel con "recibido = sí" volvía a `in_stock` en la siguiente importación:
-- reaparecía como disponible en el inventario y en la tienda.
--
-- `set_acquisition_received` sí tiene la guardia correcta (`and status =
-- 'incoming'`), lo que demuestra que aquí fue un descuido y no una decisión.
--
-- Se arregla en dos capas, no en una:
--
--  · El cambio de estado solo se aplica a una pieza que está `incoming`. Es la
--    única transición que un Excel tiene derecho a hacer: "ya llegó".
--
--  · Y una pieza que ya salió del inventario —vendida, reservada, consumida en
--    un break, perdida, devuelta, consignada afuera— no se actualiza en
--    absoluto: se levanta el error con su SKU. Abortar el lote entero es duro,
--    pero lo alternativo es escribir en silencio sobre una carta que ya no es
--    del negocio, y eso no se descubre nunca.
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
  v_actual       public.items%rowtype;
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

    select * into v_actual
    from public.items
    where id = v_item_id and deleted_at is null
    for update;

    if not found then
      raise exception 'La pieza % ya no existe o no la puedes editar.', v_item_id
        using errcode = 'P0002';
    end if;

    -- La guardia que faltaba. Una pieza que ya salió del inventario no se
    -- actualiza desde una hoja de cálculo: la hoja está vieja, no la carta.
    if v_actual.status not in ('incoming', 'in_stock', 'listed') then
      raise exception
        'La pieza % está en estado "%": el archivo viene desactualizado. Quítala de la hoja o corrígela a mano.',
        v_actual.sku, v_actual.status
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
        -- "Ya llegó" es la ÚNICA transición de estado que un Excel tiene
        -- derecho a hacer, y solo sobre una pieza que estaba en tránsito. Una
        -- que ya está disponible o publicada se queda como está.
        status           = case when v_status = 'in_stock' and i.status = 'incoming'
                                then 'in_stock'::public.item_status else i.status end,
        received_at      = case when v_status = 'in_stock' and i.status = 'incoming'
                                then coalesce(i.received_at, now()) else i.received_at end
    where i.id = v_item_id and i.deleted_at is null;

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
-- El mapeo de una plantilla se guarda por ENCABEZADO, no por posición
--
-- El comentario de la migración 0020 ya prometía { "Jugador / Personaje":
-- "playerOrCharacter" } mientras el código guardaba { "5": "playerOrCharacter" }.
-- Gana el comentario, porque tiene razón: una plantilla existe para reusarse la
-- semana siguiente, y basta que el dueño inserte una columna para que un mapeo
-- posicional lea la aduana donde está el valor de mercado — dos montos válidos,
-- ninguna restricción que salte, y el error aparece meses después en un margen
-- que no cuadra.
--
-- Las plantillas guardadas hasta ahora quedan marcadas para volver a mapear:
-- son de un formato que ya no se puede interpretar sin adivinar.
-- ---------------------------------------------------------------------------
update public.import_templates
set column_mapping = '{}'::jsonb,
    notes = coalesce(notes || ' · ', '') ||
      'El mapeo guardado era por posición de columna y se descartó: vuelve a mapear una vez.'
where column_mapping <> '{}'::jsonb
  and exists (
    select 1 from jsonb_object_keys(column_mapping) k where k ~ '^\d+$'
  );

comment on column public.import_templates.column_mapping is
  'Encabezado normalizado → campo del sistema. NUNCA por índice de columna: el dueño inserta columnas y un mapeo posicional leería los montos corridos, sin que nada falle.';
