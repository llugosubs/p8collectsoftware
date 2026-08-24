-- ============================================================================
-- 0015 — La numeración como DEFAULT de columna (Fase 1)
--
-- El SKU y el número de orden los ponía un trigger BEFORE INSERT. Funciona,
-- pero deja la columna como `not null` sin default, y entonces
-- `supabase gen types` la declara obligatoria al insertar: el generador no
-- puede saber que hay un trigger que la llena.
--
-- Un DEFAULT de columna hace lo mismo, se lee de un vistazo en el esquema, y
-- los tipos generados quedan correctos. El trigger se conserva por si alguien
-- manda la columna explícitamente en null o vacía, caso en que el DEFAULT no
-- se aplica. Un solo número se consume: el DEFAULT llena la columna antes de
-- que el trigger corra, y el trigger solo actúa si está vacía.
-- ============================================================================

alter table public.items
  alter column sku set default public.next_document_number('P8');

alter table public.orders
  alter column order_number set default public.next_document_number('P8O');
