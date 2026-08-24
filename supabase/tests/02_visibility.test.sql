-- ============================================================================
-- Quién ve qué filas, y quién puede escribir.
-- ============================================================================

begin;
select plan(9);

\ir fixtures/00_fixtures.psql

-- --- Visitante anónimo ------------------------------------------------------
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select is(
  (select count(*)::int from public.items where sku like 'P8-TEST-%'),
  1,
  'de los items de prueba, el anónimo solo ve el publicado'
);

select is(
  (select sku from public.items where sku like 'P8-TEST-%'),
  'P8-TEST-0001',
  'y es exactamente el que está publicado'
);

select throws_ok(
  $$select min_price from public.items where sku like 'P8-TEST-%'$$,
  '42501',
  null,
  'el anónimo no tiene permiso sobre min_price'
);

select lives_ok(
  $$select list_price from public.items where sku like 'P8-TEST-%'$$,
  'el anónimo sí ve el precio de lista'
);

-- --- viewer no escribe ------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$insert into public.items (sku, type, category, grading_company)
    values ('P8-TEST-9999', 'raw_card', 'tcg', 'none')$$,
  '42501',
  null,
  'viewer no puede crear inventario'
);

-- --- staff sí escribe -------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$insert into public.items (sku, type, category, grading_company)
    values ('P8-TEST-9998', 'raw_card', 'tcg', 'none')$$,
  'staff sí puede crear inventario'
);

-- --- consignante ------------------------------------------------------------
set local "request.jwt.claims" to '{"sub":"aaaaaaaa-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.items where sku like 'P8-TEST-%'),
  1,
  'el consignante ve un solo item: el suyo'
);

select is(
  (select sku from public.items where sku like 'P8-TEST-%'),
  'P8-TEST-0003',
  'y es el que le pertenece, no el del otro consignante'
);

-- --- nadie se asciende ------------------------------------------------------
select throws_ok(
  $$update public.profiles set role = 'owner'
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$$,
  '42501',
  null,
  'nadie puede cambiarse el rol a sí mismo'
);

reset role;

select * from finish();
rollback;
