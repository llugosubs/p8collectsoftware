-- ============================================================================
-- Quién ve los costos.
--
-- Es la regla del master prompt (§9) que más consecuencias tiene: si `staff`
-- ve lo que costó una carta, ve el margen del negocio entero.
-- ============================================================================

begin;
select plan(10);

\ir fixtures/00_fixtures.psql

-- --- owner ------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.item_costs c
     join public.items i on i.id = c.item_id
    where i.sku like 'P8-TEST-%'),
  2,
  'owner ve los costos de los items'
);

select is(
  (select cost_basis from public.items_with_costs where sku = 'P8-TEST-0001'),
  420.5000::numeric,
  'owner ve el costo a través de la vista'
);

select is(
  (select count(*)::int from public.acquisitions where reference = 'TEST-001'),
  1,
  'owner ve los lotes de compra'
);

select is(
  (select count(*)::int from public.transactions
    where description = 'Compra del lote de prueba'),
  1,
  'owner ve los movimientos de dinero'
);

-- --- staff ------------------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.item_costs),
  0,
  'staff no ve ni una fila de costos, ni de la prueba ni de ninguna'
);

select is(
  (select count(*)::int from public.items where sku like 'P8-TEST-%'),
  4,
  'staff sí ve el inventario'
);

select is(
  (select cost_basis from public.items_with_costs where sku = 'P8-TEST-0001'),
  null,
  'staff consulta la vista y el costo le llega en NULL'
);

select is(
  (select count(*)::int from public.acquisitions),
  0,
  'staff no ve ningún lote de compra'
);

select is(
  (select count(*)::int from public.transactions),
  0,
  'staff no ve ningún movimiento de dinero'
);

-- --- viewer -----------------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.item_costs),
  0,
  'viewer tampoco ve costos'
);

reset role;

select * from finish();
rollback;
