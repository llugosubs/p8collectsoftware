-- ============================================================================
-- 0005 — Adquisiciones (Fase 1)
--
-- La cabecera del lote de compra. Las líneas van en la 0007, después de
-- `items`, porque enlazan las dos.
-- ============================================================================

create table public.acquisitions (
  id              uuid primary key default gen_random_uuid(),

  platform        public.acquisition_platform not null,
  reference       text,
  purchased_at    date not null,
  currency        char(3) not null default 'USD',

  -- Componentes del costo. Todos obligatorios con cero por defecto: así el
  -- total generado nunca queda nulo por un campo sin llenar.
  hammer_total    numeric(14, 4) not null default 0,
  buyer_premium   numeric(14, 4) not null default 0,
  card_fee        numeric(14, 4) not null default 0,
  shipping_intl   numeric(14, 4) not null default 0,
  courier_ve      numeric(14, 4) not null default 0,
  customs_ve      numeric(14, 4) not null default 0,
  other_costs     numeric(14, 4) not null default 0,

  -- Generada: nadie puede guardar un total que no cuadre con sus partes.
  total_cost      numeric(14, 4) generated always as (
                    hammer_total + buyer_premium + card_fee + shipping_intl
                    + courier_ve + customs_ve + other_costs
                  ) stored,

  -- Los gastos en bolívares (courier, aduana) se convierten a la tasa del día
  -- del gasto y esa tasa se guarda aquí, no se recalcula después.
  fx_rate         numeric(18, 6),
  fx_rate_source  public.fx_source,

  -- Fecha límite de pago del lote, para el aging de cuentas por pagar (7.6).
  due_at          date,
  payment_status  public.acquisition_payment_status not null default 'pending',
  received_status public.acquisition_received_status not null default 'pending',
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,

  constraint acquisitions_costs_non_negative check (
    hammer_total >= 0 and buyer_premium >= 0 and card_fee >= 0
    and shipping_intl >= 0 and courier_ve >= 0 and customs_ve >= 0 and other_costs >= 0
  ),
  constraint acquisitions_fx_rate_positive check (fx_rate is null or fx_rate > 0)
);

comment on table public.acquisitions is
  'Un lote de compra. Tabla sensible: solo owner y admin la ven (ver migración de RLS).';

create unique index acquisitions_platform_reference_idx
  on public.acquisitions (platform, reference)
  where reference is not null and deleted_at is null;

create index acquisitions_purchased_at_idx on public.acquisitions (purchased_at desc);
create index acquisitions_pending_receipt_idx
  on public.acquisitions (received_status, purchased_at)
  where received_status <> 'received' and deleted_at is null;

create trigger acquisitions_set_updated_at
  before update on public.acquisitions
  for each row execute function public.set_updated_at();

create trigger acquisitions_audit
  after insert or update or delete on public.acquisitions
  for each row execute function public.audit_trigger();
