-- ============================================================================
-- Quién ve los costos.
--
-- Es la regla del master prompt (§9) que más consecuencias tiene: si `staff`
-- ve lo que costó una carta, ve el margen del negocio entero.
-- ============================================================================

begin;
select plan(10);

\i supabase/tests/00_fixtures.sql

-- --- owner ------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.item_costs),
  2,
  'owner ve los costos de los items'
);

select is(
  (select cost_basis from public.items_with_costs where sku = 'P8-TEST-0001'),
  420.5000::numeric,
  'owner ve el costo a través de la vista'
);

select is(
  (select count(*)::int from public.acquisitions),
  1,
  'owner ve los lotes de compra'
);

select is(
  (select count(*)::int from public.transactions),
  1,
  'owner ve los movimientos de dinero'
);

-- --- staff ------------------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.item_costs),
  0,
  'staff no ve ni una fila de costos'
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
  'staff no ve los lotes de compra'
);

select is(
  (select count(*)::int from public.transactions),
  0,
  'staff no ve los movimientos de dinero'
);

-- --- viewer -----------------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.item_costs),
  0,
  'viewer tampoco ve costos'
);

select * from finish();
rollback;
