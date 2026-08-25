-- ============================================================================
-- Abrir un break: atomicidad, invariante de costo y permisos.
--
-- Es la operación que más puede corromper dinero en silencio: si los hijos no
-- suman el costo de la caja, el margen de cada carta que salga de ahí es
-- mentira, y esas cartas se venden durante meses.
-- ============================================================================

begin;
select plan(9);

\ir fixtures/00_fixtures.psql

-- Una caja sellada propia, con costo, para romper.
insert into public.items
  (id, sku, type, category, player_or_character, grading_company,
   status, acquisition_id, quantity)
values ('eeeeeeee-0000-0000-0000-000000000001', 'P8-TEST-BOX1', 'sealed_box', 'tcg',
        'Caja de prueba', 'none', 'in_stock',
        'bbbbbbbb-0000-0000-0000-000000000001', 1);

insert into public.item_costs (item_id, allocated_cost)
values ('eeeeeeee-0000-0000-0000-000000000001', 100.0000);

-- Y una fila con tres cajas iguales, que NO se debe poder abrir.
insert into public.items
  (id, sku, type, category, player_or_character, grading_company, status, quantity)
values ('eeeeeeee-0000-0000-0000-000000000002', 'P8-TEST-BOX3', 'sealed_box', 'tcg',
        'Tres cajas en una fila', 'none', 'in_stock', 3);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- --- El invariante -----------------------------------------------------------
select throws_ok(
  $$select public.open_break(jsonb_build_object(
      'source_item_id', 'eeeeeeee-0000-0000-0000-000000000001',
      'children', jsonb_build_array(
        jsonb_build_object('child_number', 1, 'allocated_cost', '60.0000'),
        jsonb_build_object('child_number', 2, 'allocated_cost', '30.0000'))))$$,
  'P0001',
  null,
  'un reparto que no suma el costo de la caja se rechaza'
);

select is(
  (select count(*)::int from public.breaks
    where source_item_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  0,
  'y no deja NADA escrito: la transacción entera se revierte'
);

select is(
  (select count(*)::int from public.items where parent_item_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  0,
  'tampoco quedan cartas huérfanas del intento fallido'
);

-- --- Una fila con varias unidades -------------------------------------------
select throws_ok(
  $$select public.open_break(jsonb_build_object(
      'source_item_id', 'eeeeeeee-0000-0000-0000-000000000002',
      'children', jsonb_build_array(jsonb_build_object('child_number', 1))))$$,
  'P0001',
  null,
  'una fila con tres cajas no se abre: se perdería existencia real'
);

-- --- Algo que no es sellado --------------------------------------------------
select throws_ok(
  $$select public.open_break(jsonb_build_object(
      'source_item_id', 'dddddddd-0000-0000-0000-000000000001',
      'children', jsonb_build_array(jsonb_build_object('child_number', 1))))$$,
  'P0001',
  null,
  'una carta graduada no es una caja: no se abre'
);

-- --- El camino que sí funciona ----------------------------------------------
select lives_ok(
  $$select public.open_break(jsonb_build_object(
      'source_item_id', 'eeeeeeee-0000-0000-0000-000000000001',
      'children', jsonb_build_array(
        jsonb_build_object('child_number', 1, 'player_or_character', 'Hit', 'allocated_cost', '60.0000'),
        jsonb_build_object('child_number', 2, 'player_or_character', 'Relleno', 'allocated_cost', '40.0000'))))$$,
  'un reparto que cuadra se acepta'
);

select is(
  (select sum(c.cost_basis) from public.items i
     join public.item_costs c on c.item_id = i.id
    where i.parent_item_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  100.0000::numeric,
  'la suma de las cartas es exactamente el costo de la caja'
);

select is(
  (select status::text from public.items where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'consumed',
  'la caja queda consumida, no vendida'
);

-- --- Abrirla otra vez --------------------------------------------------------
select throws_ok(
  $$select public.open_break(jsonb_build_object(
      'source_item_id', 'eeeeeeee-0000-0000-0000-000000000001',
      'children', jsonb_build_array(jsonb_build_object('child_number', 1, 'allocated_cost', '100.0000'))))$$,
  'P0001',
  null,
  'la misma caja no se abre dos veces'
);

reset role;

select * from finish();
rollback;
