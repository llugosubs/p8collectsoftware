-- ============================================================================
-- 0013 — Row Level Security (Fase 1)
--
-- Dos mecanismos distintos, cada uno donde funciona:
--
--  · Entre roles de la aplicación (owner, admin, staff, viewer, consignor) todos
--    entran a Postgres como el mismo rol `authenticated`, así que los permisos
--    por columna no los distinguen. Ahí la separación es por FILA: lo sensible
--    vive en su propia tabla (item_costs, order_line_costs, account_details) y
--    el RLS hace lo que sabe hacer.
--
--  · El visitante anónimo SÍ es un rol distinto (`anon`), así que ahí sí sirve
--    el permiso por columna: la tienda ve el precio de lista y nunca el precio
--    mínimo, que es el piso que aceptaríamos en una negociación.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper que faltaba: quién puede escribir. `viewer` no.
-- ---------------------------------------------------------------------------
create or replace function public.is_staff_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner', 'admin', 'staff'), false);
$$;

-- ---------------------------------------------------------------------------
-- RLS activo en todo. Sin excepción.
-- ---------------------------------------------------------------------------
alter table public.audit_log             enable row level security;
alter table public.settings              enable row level security;
alter table public.notifications         enable row level security;
alter table public.document_counters     enable row level security;
alter table public.consignors            enable row level security;
alter table public.acquisitions          enable row level security;
alter table public.items                 enable row level security;
alter table public.item_costs            enable row level security;
alter table public.item_images           enable row level security;
alter table public.item_valuations       enable row level security;
alter table public.acquisition_lines     enable row level security;
alter table public.breaks                enable row level security;
alter table public.accounts              enable row level security;
alter table public.account_details       enable row level security;
alter table public.expense_categories    enable row level security;
alter table public.fx_rates              enable row level security;
alter table public.transactions          enable row level security;
alter table public.customers             enable row level security;
alter table public.orders                enable row level security;
alter table public.order_lines           enable row level security;
alter table public.order_line_costs      enable row level security;
alter table public.payments              enable row level security;
alter table public.consignment_agreements enable row level security;
alter table public.consignor_payouts     enable row level security;

-- ===========================================================================
-- INVENTARIO
-- ===========================================================================

create policy "items: el equipo lee" on public.items for select to authenticated
  using (public.can_access_admin() and (deleted_at is null or public.is_admin()));

create policy "items: el consignante lee los suyos" on public.items for select to authenticated
  using (
    consignor_id is not null
    and consignor_id = public.current_consignor_id()
    and deleted_at is null
  );

create policy "items: la tienda lee lo publicado" on public.items for select to anon
  using (is_published and deleted_at is null);

create policy "items: el equipo crea" on public.items for insert to authenticated
  with check (public.is_staff_or_above());

create policy "items: el equipo edita" on public.items for update to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

create policy "items: solo admin borra" on public.items for delete to authenticated
  using (public.is_admin());

-- El costo: solo owner y admin, en las cuatro operaciones.
create policy "item_costs: solo admin" on public.item_costs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "item_images: el equipo lee" on public.item_images for select to authenticated
  using (public.can_access_admin());

create policy "item_images: la tienda lee las de items publicados"
  on public.item_images for select to anon
  using (exists (
    select 1 from public.items i
    where i.id = item_id and i.is_published and i.deleted_at is null
  ));

create policy "item_images: el equipo escribe" on public.item_images for all to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

create policy "item_valuations: el equipo lee" on public.item_valuations
  for select to authenticated using (public.can_access_admin());

create policy "item_valuations: el equipo escribe" on public.item_valuations
  for all to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

create policy "breaks: el equipo lee" on public.breaks for select to authenticated
  using (public.can_access_admin());

create policy "breaks: el equipo escribe" on public.breaks for all to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

-- ===========================================================================
-- COMPRAS — enteras fuera del alcance de staff y viewer
-- ===========================================================================

create policy "acquisitions: solo admin" on public.acquisitions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "acquisition_lines: solo admin" on public.acquisition_lines
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- VENTAS
-- ===========================================================================

create policy "customers: el equipo lee" on public.customers for select to authenticated
  using (public.can_access_admin() and (deleted_at is null or public.is_admin()));

create policy "customers: el equipo escribe" on public.customers for all to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

create policy "orders: el equipo lee" on public.orders for select to authenticated
  using (public.can_access_admin() and (deleted_at is null or public.is_admin()));

create policy "orders: el equipo escribe" on public.orders for all to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

create policy "order_lines: el equipo lee" on public.order_lines for select to authenticated
  using (public.can_access_admin());

create policy "order_lines: el equipo escribe" on public.order_lines for all to authenticated
  using (public.is_staff_or_above()) with check (public.is_staff_or_above());

create policy "order_line_costs: solo admin" on public.order_line_costs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Los pagos de un LOTE dicen cuánto se pagó por él: son un costo disfrazado.
-- staff y viewer solo ven los cobros de órdenes.
create policy "payments: admin ve todos" on public.payments for select to authenticated
  using (public.is_admin());

create policy "payments: el equipo ve los cobros de órdenes"
  on public.payments for select to authenticated
  using (public.can_access_admin() and order_id is not null and deleted_at is null);

create policy "payments: el equipo registra cobros de órdenes"
  on public.payments for insert to authenticated
  with check (public.is_admin() or (public.is_staff_or_above() and order_id is not null));

create policy "payments: el equipo actualiza cobros de órdenes"
  on public.payments for update to authenticated
  using (public.is_admin() or (public.is_staff_or_above() and order_id is not null))
  with check (public.is_admin() or (public.is_staff_or_above() and order_id is not null));

create policy "payments: solo admin borra" on public.payments for delete to authenticated
  using (public.is_admin());

-- ===========================================================================
-- FINANZAS
-- ===========================================================================

-- El nombre de la cuenta sí: staff tiene que elegir una al registrar un pago.
create policy "accounts: el equipo lee" on public.accounts for select to authenticated
  using (public.can_access_admin() and (deleted_at is null or public.is_admin()));

create policy "accounts: solo admin escribe" on public.accounts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- El saldo y los datos de cobro, no.
create policy "account_details: solo admin" on public.account_details for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "expense_categories: el equipo lee" on public.expense_categories
  for select to authenticated using (public.can_access_admin());

create policy "expense_categories: solo admin escribe" on public.expense_categories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "transactions: solo admin" on public.transactions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- La tasa del día es pública: la tienda muestra el equivalente en bolívares.
create policy "fx_rates: lectura abierta" on public.fx_rates for select to anon, authenticated
  using (true);

create policy "fx_rates: solo admin escribe" on public.fx_rates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- CONSIGNACIÓN
-- ===========================================================================

create policy "consignors: solo admin" on public.consignors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "consignors: cada consignante se ve a sí mismo"
  on public.consignors for select to authenticated
  using (user_id = auth.uid() and deleted_at is null);

create policy "consignment_agreements: solo admin" on public.consignment_agreements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "consignment_agreements: el consignante ve los suyos"
  on public.consignment_agreements for select to authenticated
  using (consignor_id = public.current_consignor_id() and deleted_at is null);

create policy "consignor_payouts: solo admin" on public.consignor_payouts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "consignor_payouts: el consignante ve los suyos"
  on public.consignor_payouts for select to authenticated
  using (consignor_id = public.current_consignor_id());

-- ===========================================================================
-- SISTEMA
-- ===========================================================================

-- El rastro de auditoría se lee, no se escribe: lo pone el trigger, que corre
-- como definer. No hay política de insert, update ni delete a propósito.
create policy "audit_log: solo admin lee" on public.audit_log for select to authenticated
  using (public.is_admin());

create policy "settings: el equipo lee" on public.settings for select to authenticated
  using (public.can_access_admin() or is_public);

create policy "settings: la tienda lee las públicas" on public.settings
  for select to anon using (is_public);

create policy "settings: solo admin escribe" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "notifications: cada quien ve las suyas" on public.notifications
  for select to authenticated
  using (public.can_access_admin() and (user_id = auth.uid() or user_id is null));

create policy "notifications: cada quien marca las suyas como leídas"
  on public.notifications for update to authenticated
  using (public.can_access_admin() and (user_id = auth.uid() or user_id is null))
  with check (public.can_access_admin() and (user_id = auth.uid() or user_id is null));

create policy "notifications: el equipo crea" on public.notifications
  for insert to authenticated with check (public.is_staff_or_above());

-- Los contadores de numeración no se tocan a mano: sin política, nadie los ve.
-- Solo `next_document_number()`, que es security definer, los mueve.

-- ===========================================================================
-- PERMISOS DE TABLA
--
-- El RLS filtra filas, pero antes hay que poder tocar la tabla. Aquí se define
-- qué toca cada rol de base de datos, y para el anónimo, qué COLUMNAS.
-- ===========================================================================

-- El anónimo no tiene nada que hacer en el resto del esquema.
revoke all on all tables in schema public from anon;

-- De items, la tienda ve la ficha de la carta y el precio de lista.
-- Fuera quedan `min_price` (el piso de negociación) y `market_value` (una
-- valoración interna que no es un precio de venta).
grant select (
  id, sku, type, category, sport_or_game, player_or_character, brand, set_name,
  year, card_number, variant, serial_numbered, is_rookie, is_autograph, is_patch,
  language, grading_company, grade, grade_label, cert_number, raw_condition,
  quantity, status, list_price, is_published, slug, description_es, description_en,
  tags, created_at, updated_at
) on public.items to anon;

grant select (id, item_id, url, kind, sort_order) on public.item_images to anon;
grant select (id, rate_date, source, rate) on public.fx_rates to anon;
grant select (key, value, description, is_public) on public.settings to anon;

-- El rol autenticado sí toca las tablas; quién ve qué lo deciden las políticas.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Salvo estas dos, que no se manipulan a mano nunca.
revoke insert, update, delete on public.audit_log from authenticated;
revoke all on public.document_counters from authenticated, anon;

-- Las vistas heredan el RLS de sus tablas por `security_invoker`, pero exponen
-- columnas que el anónimo no debe ver.
revoke all on public.items_with_costs, public.order_lines_with_costs,
  public.receivables, public.payables from anon;

grant select on public.items_with_costs, public.order_lines_with_costs,
  public.receivables, public.payables to authenticated;
