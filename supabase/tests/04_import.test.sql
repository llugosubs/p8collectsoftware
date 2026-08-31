-- ============================================================================
-- Importador: confirmar y revertir.
--
-- Las dos mitades de la promesa del módulo. Confirmar tiene que ser todo o
-- nada y dejar cada fila del archivo enlazada con la pieza que produjo;
-- revertir tiene que negarse en cuanto una de esas piezas tomó vida propia.
-- ============================================================================

begin;
select plan(17);

\ir fixtures/00_fixtures.psql

-- --- Un archivo subido, con tres filas ---------------------------------------
insert into public.import_batches (id, file_name, sheet_name, header_row, rows_total)
values ('ffffffff-0000-0000-0000-000000000001', 'compras-semana-35.xlsx', 'Hoja1', 3, 3);

insert into public.import_batch_rows (id, batch_id, row_number, raw_data, state) values
  ('ffffffff-1111-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 4,
   '{"jugador":"Wembanyama","hammer_usd":"100"}'::jsonb, 'new'),
  ('ffffffff-1111-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 5,
   '{"jugador":"Luffy","hammer_usd":"200"}'::jsonb, 'new'),
  ('ffffffff-1111-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000001', 6,
   '{"jugador":"Wembanyama","hammer_usd":"100"}'::jsonb, 'duplicate_in_file');

-- --- Un staff no entra al módulo --------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.import_batches
    where id = 'ffffffff-0000-0000-0000-000000000001'),
  0,
  'un staff no ve los lotes de importación: el módulo crea compras'
);

-- --- El dueño confirma -------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.commit_import_batch(
      'ffffffff-0000-0000-0000-000000000001',
      jsonb_build_object(
        'groups', jsonb_build_array(jsonb_build_object(
          'group_key', 'alt|IMP-1|2026-08-24',
          'platform', 'alt',
          'reference', 'IMP-1',
          'purchased_at', '2026-08-24',
          'hammer_total', '300',
          'buyer_premium', '30',
          'received_status', 'received',
          'lines', jsonb_build_array(
            jsonb_build_object(
              'row_id', 'ffffffff-1111-0000-0000-000000000001',
              'line_number', 1,
              'hammer_price', '100',
              'allocated_cost', '110',
              'item', jsonb_build_object('type','graded_card','category','sports',
                'player_or_character','Wembanyama','grading_company','PSA','grade',10)),
            jsonb_build_object(
              'row_id', 'ffffffff-1111-0000-0000-000000000002',
              'line_number', 2,
              'hammer_price', '200',
              'allocated_cost', '220',
              'item', jsonb_build_object('type','raw_card','category','tcg',
                'player_or_character','Luffy'))))))) $$,
  'el dueño confirma el archivo'
);

select is(
  (select count(*)::int from public.import_batch_rows
    where batch_id = 'ffffffff-0000-0000-0000-000000000001'
      and result = 'created' and item_id is not null),
  2,
  'cada fila queda enlazada con la pieza que produjo, dentro de la transacción'
);

select is(
  (select result::text from public.import_batch_rows
    where id = 'ffffffff-1111-0000-0000-000000000003'),
  'skipped',
  'la fila duplicada queda omitida, no creada'
);

select is(
  (select rows_created || '/' || rows_skipped || '/' || rows_error
     from public.import_batches where id = 'ffffffff-0000-0000-0000-000000000001'),
  '2/1/0',
  'los contadores se cuentan contra la tabla, no contra lo que dijo el navegador'
);

select is(
  (select sum(c.allocated_cost) from public.item_costs c
    join public.import_batch_rows r on r.item_id = c.item_id
   where r.batch_id = 'ffffffff-0000-0000-0000-000000000001'),
  330.0000::numeric,
  'el prorrateo importado suma exactamente lo que costó el lote'
);

select is(
  (select count(distinct acquisition_id)::int from public.import_batch_rows
    where batch_id = 'ffffffff-0000-0000-0000-000000000001' and acquisition_id is not null),
  1,
  'las filas del mismo grupo formaron un solo lote de compra'
);

select is(
  (select count(*)::int from public.items i
    join public.import_batch_rows r on r.item_id = i.id
   where r.batch_id = 'ffffffff-0000-0000-0000-000000000001' and i.status = 'in_stock'),
  2,
  'el archivo decía recibido, así que las piezas nacen disponibles y no en tránsito'
);

-- --- Confirmar dos veces ------------------------------------------------------
select is(
  (public.commit_import_batch('ffffffff-0000-0000-0000-000000000001', '{}'::jsonb)
     ->> 'already_committed')::boolean,
  true,
  'el segundo toque en Confirmar devuelve lo que ya pasó'
);

select is(
  (select count(*)::int from public.items i
    join public.import_batch_rows r on r.item_id = i.id
   where r.batch_id = 'ffffffff-0000-0000-0000-000000000001'),
  2,
  'y no importa el archivo dos veces'
);

-- --- Revertir con una pieza publicada ----------------------------------------
update public.items set is_published = true, slug = 'importada-publicada'
where id = (select item_id from public.import_batch_rows
            where id = 'ffffffff-1111-0000-0000-000000000001');

select throws_ok(
  $$select public.revert_import_batch('ffffffff-0000-0000-0000-000000000001')$$,
  'P0001',
  null,
  'no se revierte un lote con una pieza ya publicada en la tienda'
);

select is(
  (select count(*)::int from public.items i
    join public.import_batch_rows r on r.item_id = i.id
   where r.batch_id = 'ffffffff-0000-0000-0000-000000000001' and i.deleted_at is not null),
  0,
  'y el intento fallido no borra nada'
);

-- --- Fuera de la ventana de 7 días -------------------------------------------
update public.items set is_published = false, slug = null
where id = (select item_id from public.import_batch_rows
            where id = 'ffffffff-1111-0000-0000-000000000001');

update public.import_batches set committed_at = now() - interval '30 days'
where id = 'ffffffff-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.revert_import_batch('ffffffff-0000-0000-0000-000000000001')$$,
  'P0001',
  null,
  'pasada la ventana de reversión, se niega'
);

-- --- Reversión limpia ---------------------------------------------------------
update public.import_batches set committed_at = now()
where id = 'ffffffff-0000-0000-0000-000000000001';

select is(
  (public.revert_import_batch('ffffffff-0000-0000-0000-000000000001') ->> 'items_deleted')::int,
  2,
  'un lote donde nada se movió sí se revierte'
);

select is(
  (select count(*)::int from public.items_with_costs i
    join public.import_batch_rows r on r.item_id = i.id
   where r.batch_id = 'ffffffff-0000-0000-0000-000000000001'),
  0,
  'las piezas revertidas desaparecen del inventario vivo'
);

select is(
  (select count(*)::int from public.acquisitions a
    where a.id in (select acquisition_id from public.import_batch_rows
                   where batch_id = 'ffffffff-0000-0000-0000-000000000001')
      and a.deleted_at is not null),
  1,
  'y el lote de compra que creó el archivo también se deshace'
);

select throws_ok(
  $$select public.revert_import_batch('ffffffff-0000-0000-0000-000000000001')$$,
  'P0001',
  null,
  'un lote ya revertido no se revierte otra vez'
);

reset role;

select * from finish();
rollback;
