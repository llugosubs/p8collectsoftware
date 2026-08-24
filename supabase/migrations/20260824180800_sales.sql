-- ============================================================================
-- 0010 — Ventas (Fase 1)
--
-- Clientes, órdenes, líneas y pagos. Igual que en inventario, el costo y el
-- margen de cada línea viven aparte, en `order_line_costs`, para que `staff`
-- pueda vender sin ver lo que costó la pieza.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  email        text,
  phone        text,
  country      text,
  city         text,
  address      text,
  id_document  text,
  is_wholesale boolean not null default false,
  tags         text[] not null default '{}',
  notes        text,
  -- Qué busca: alimenta el CRM de la Fase 3.
  wishlist     text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz
);

create index customers_name_idx on public.customers (lower(display_name)) where deleted_at is null;
create unique index customers_email_idx on public.customers (lower(email))
  where email is not null and deleted_at is null;
create index customers_tags_idx on public.customers using gin (tags);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text unique not null,

  channel            public.sales_channel not null,
  customer_id        uuid references public.customers (id) on delete restrict,
  status             public.order_status not null default 'draft',

  currency           char(3) not null default 'USD',
  fx_rate            numeric(18, 6),
  fx_rate_source     public.fx_source,

  subtotal           numeric(14, 4) not null default 0,
  discount           numeric(14, 4) not null default 0,
  shipping_charged   numeric(14, 4) not null default 0,
  tax                numeric(14, 4) not null default 0,

  -- Lo que se le queda la plataforma y el procesador de pago. No lo paga el
  -- cliente: reduce lo que entra, por eso no suma al total.
  platform_fee       numeric(14, 4) not null default 0,
  payment_fee        numeric(14, 4) not null default 0,

  -- Lo que paga el cliente.
  total              numeric(14, 4) generated always as (
                       subtotal - discount + shipping_charged + tax
                     ) stored,

  -- Lo que de verdad entra a caja después de los fees del canal.
  net_proceeds       numeric(14, 4) generated always as (
                       subtotal - discount + shipping_charged + tax
                       - platform_fee - payment_fee
                     ) stored,

  shipping_method    text,
  tracking_number    text,
  shipping_cost_real numeric(14, 4) not null default 0,
  notes              text,

  placed_at          timestamptz not null default now(),
  -- Fecha de vencimiento del cobro. El master prompt pide días de mora en
  -- cuentas pendientes (7.6) pero no define el plazo; se guarda explícito por
  -- orden en vez de asumir uno global que no aplicaría a todos los canales.
  due_at             timestamptz,
  paid_at            timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  deleted_at         timestamptz,

  constraint orders_amounts_non_negative check (
    subtotal >= 0 and discount >= 0 and shipping_charged >= 0 and tax >= 0
    and platform_fee >= 0 and payment_fee >= 0 and shipping_cost_real >= 0
  ),
  constraint orders_discount_within_subtotal check (discount <= subtotal),
  constraint orders_fx_rate_positive check (fx_rate is null or fx_rate > 0),
  constraint orders_non_usd_needs_rate check (currency = 'USD' or fx_rate is not null)
);

comment on column public.orders.net_proceeds is
  'Total menos los fees del canal. Es la cifra que importa para el margen real.';

create index orders_status_idx on public.orders (status, placed_at desc) where deleted_at is null;
create index orders_customer_idx on public.orders (customer_id);
create index orders_channel_idx on public.orders (channel, placed_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger orders_audit
  after insert or update or delete on public.orders
  for each row execute function public.audit_trigger();

create or replace function public.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := public.next_document_number('P8O');
  end if;
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.assign_order_number();

-- ---------------------------------------------------------------------------
-- order_lines
-- ---------------------------------------------------------------------------
create table public.order_lines (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete restrict,

  quantity   int not null default 1,
  unit_price numeric(14, 4) not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint order_lines_quantity_positive check (quantity > 0),
  constraint order_lines_unit_price_non_negative check (unit_price >= 0),
  constraint order_lines_unique_item unique (order_id, item_id)
);

create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_item_idx on public.order_lines (item_id);

create trigger order_lines_set_updated_at
  before update on public.order_lines
  for each row execute function public.set_updated_at();

create trigger order_lines_audit
  after insert or update or delete on public.order_lines
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- order_line_costs — costo y margen de cada línea vendida
--
-- `cost_basis_snapshot` es una foto: el costo que tenía la pieza el día que se
-- vendió. Si mañana se corrige el costo del lote, la ganancia registrada de
-- una venta pasada no debe moverse.
--
-- `gross_margin` NO es columna generada, a diferencia de otros totales del
-- esquema. Depende de `unit_price` y `quantity`, que viven en `order_lines`, y
-- una columna generada solo puede leer su propia fila; copiarlas aquí para
-- poder generarla crearía justo la duplicación que este diseño evita. La
-- escribe lib/domain al cerrar la venta.
-- ---------------------------------------------------------------------------
create table public.order_line_costs (
  order_line_id       uuid primary key references public.order_lines (id) on delete cascade,

  cost_basis_snapshot numeric(14, 4) not null default 0,
  -- Envío real y fees de la orden, repartidos entre sus líneas.
  allocated_order_cost numeric(14, 4) not null default 0,
  gross_margin        numeric(14, 4) not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,

  constraint order_line_costs_non_negative check (
    cost_basis_snapshot >= 0 and allocated_order_cost >= 0
  )
);

comment on table public.order_line_costs is
  'Tabla sensible: solo owner y admin. El margen se deduce del costo, así que se oculta igual.';

create trigger order_line_costs_set_updated_at
  before update on public.order_line_costs
  for each row execute function public.set_updated_at();

create trigger order_line_costs_audit
  after insert or update or delete on public.order_line_costs
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- payments
--
-- Sirve para los dos sentidos: cobros de una orden y pagos de un lote. Por eso
-- las dos referencias son opcionales, con la restricción de que venga
-- exactamente una.
-- ---------------------------------------------------------------------------
create table public.payments (
  id                    uuid primary key default gen_random_uuid(),

  order_id              uuid references public.orders (id) on delete cascade,
  acquisition_id        uuid references public.acquisitions (id) on delete cascade,

  direction             public.payment_direction not null,
  method                public.payment_method not null,
  account_id            uuid references public.accounts (id) on delete restrict,

  currency              char(3) not null,
  amount                numeric(14, 4) not null,
  fx_rate               numeric(18, 6),
  amount_usd_equivalent numeric(14, 4) not null,

  reference             text,
  proof_url             text,
  status                public.payment_verification_status not null default 'pending_verification',
  verified_at           timestamptz,
  verified_by           uuid references auth.users (id) on delete set null,
  notes                 text,

  paid_at               timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  deleted_at            timestamptz,

  constraint payments_amount_positive check (amount > 0),
  constraint payments_fx_rate_positive check (fx_rate is null or fx_rate > 0),
  constraint payments_non_usd_needs_rate check (currency = 'USD' or fx_rate is not null),
  constraint payments_exactly_one_reference check (
    (order_id is not null and acquisition_id is null)
    or (order_id is null and acquisition_id is not null)
  )
);

create index payments_order_idx on public.payments (order_id) where order_id is not null;
create index payments_acquisition_idx on public.payments (acquisition_id)
  where acquisition_id is not null;
create index payments_pending_idx on public.payments (status, paid_at)
  where status = 'pending_verification' and deleted_at is null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_trigger();
