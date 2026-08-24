-- ============================================================================
-- 0009 — Finanzas (Fase 1)
--
-- Cuentas de dinero, categorías de gasto, tasas de cambio y el libro de
-- movimientos. Va antes que ventas porque `payments` referencia `accounts`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       public.account_type not null,
  currency   char(3) not null,
  is_active  boolean not null default true,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);

comment on table public.accounts is
  'Solo la identidad de la cuenta. El saldo y los datos de cobro van en account_details.';

-- ---------------------------------------------------------------------------
-- account_details — la parte sensible de una cuenta
--
-- `staff` necesita elegir una cuenta al registrar un pago, así que tiene que
-- ver los nombres. Lo que no puede ver es cuánto hay ni el titular de Zelle.
-- Misma solución que con los costos: el secreto en su propia fila, con su
-- propio RLS.
-- ---------------------------------------------------------------------------
create table public.account_details (
  account_id      uuid primary key references public.accounts (id) on delete cascade,
  opening_balance numeric(14, 4) not null default 0,
  -- Titular, teléfono de Pago Móvil, wallet. Nunca en el repositorio.
  details         jsonb not null default '{}'::jsonb,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null
);

create trigger account_details_set_updated_at
  before update on public.account_details
  for each row execute function public.set_updated_at();

create trigger account_details_audit
  after insert or update or delete on public.account_details
  for each row execute function public.audit_trigger();

create unique index accounts_name_idx on public.accounts (lower(name)) where deleted_at is null;

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

create trigger accounts_audit
  after insert or update or delete on public.accounts
  for each row execute function public.audit_trigger();

-- Toda cuenta nace con su fila de detalle, para que el uno-a-uno no dependa de
-- que alguien se acuerde de crearla.
create or replace function public.create_account_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_details (account_id) values (new.id)
  on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger accounts_create_details
  after insert on public.accounts
  for each row execute function public.create_account_details();

-- Cuentas iniciales de la sección 13. Van en la migración y no en el seed
-- porque producción también las necesita: son las cuentas reales del negocio,
-- no datos de prueba. Los datos de cobro se llenan desde Configuración.
insert into public.accounts (name, type, currency, sort_order) values
  ('Zelle',        'zelle',   'USD', 1),
  ('Banco VE',     'bank_ve', 'VES', 2),
  ('Binance',      'binance', 'USD', 3),
  ('Efectivo $',   'cash',    'USD', 4),
  ('Tarjeta',      'card',    'USD', 5)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- expense_categories
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

insert into public.expense_categories (slug, name) values
  ('supplies',      'Insumos'),
  ('shipping',      'Envíos'),
  ('subscriptions', 'Suscripciones'),
  ('marketing',     'Marketing'),
  ('grading',       'Grading'),
  ('customs',       'Aduana'),
  ('platform_fees', 'Comisiones de plataforma'),
  ('other',         'Otros')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- fx_rates
--
-- La tasa es bolívares por dólar, como la publica el BCV. Se guarda una por
-- día y fuente; el cron que la consulta llega en la Fase 3.
-- ---------------------------------------------------------------------------
create table public.fx_rates (
  id         uuid primary key default gen_random_uuid(),
  rate_date  date not null,
  source     public.fx_source not null,
  rate       numeric(18, 6) not null,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint fx_rates_rate_positive check (rate > 0),
  constraint fx_rates_unique_day_source unique (rate_date, source)
);

create index fx_rates_lookup_idx on public.fx_rates (source, rate_date desc);

-- La tasa vigente de una fuente: la más reciente que no sea del futuro.
create or replace function public.current_fx_rate(p_source public.fx_source default 'bcv')
returns numeric
language sql
stable
as $$
  select rate
  from public.fx_rates
  where source = p_source and rate_date <= current_date
  order by rate_date desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- transactions — el libro de movimientos
--
-- `reference_type` / `reference_id` apuntan a la orden, el lote o la
-- liquidación que originó el movimiento. Es polimórfico a propósito: una clave
-- foránea por tipo de origen obligaría a una columna nueva cada vez que aparece
-- un origen nuevo.
-- ---------------------------------------------------------------------------
create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete restrict,
  type           public.transaction_type not null,

  amount         numeric(14, 4) not null,
  currency       char(3) not null,
  fx_rate        numeric(18, 6),
  -- Equivalente en la moneda base, a la tasa del día del movimiento. Se guarda
  -- calculado, no se recalcula después: la tasa de hoy no reescribe el pasado.
  amount_usd     numeric(14, 4) not null,

  reference_type text,
  reference_id   uuid,
  category_id    uuid references public.expense_categories (id) on delete set null,
  description    text,
  occurred_at    timestamptz not null default now(),
  reconciled     boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,
  deleted_at     timestamptz,

  constraint transactions_fx_rate_positive check (fx_rate is null or fx_rate > 0),
  -- Si el movimiento no es en la moneda base, la tasa usada es obligatoria:
  -- sin ella el equivalente en dólares no es auditable.
  constraint transactions_non_usd_needs_rate check (currency = 'USD' or fx_rate is not null)
);

comment on table public.transactions is
  'Tabla sensible: solo owner y admin. Ver migración de RLS.';

create index transactions_account_idx on public.transactions (account_id, occurred_at desc);
create index transactions_reference_idx on public.transactions (reference_type, reference_id);
create index transactions_unreconciled_idx on public.transactions (account_id, occurred_at)
  where not reconciled and deleted_at is null;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function public.audit_trigger();
