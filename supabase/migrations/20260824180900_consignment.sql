-- ============================================================================
-- 0011 — Consignación (Fase 1)
--
-- El modelo entra completo aunque su interfaz sea de la Fase 6. La regla del
-- master prompt (5.6) es la que manda: vender un item consignado no es ingreso
-- propio. Solo la comisión lo es; el resto es una deuda con el consignante.
-- ============================================================================

create table public.consignment_agreements (
  id               uuid primary key default gen_random_uuid(),
  consignor_id     uuid not null references public.consignors (id) on delete restrict,
  item_id          uuid not null references public.items (id) on delete restrict,

  agreed_min_price numeric(14, 4),
  -- Sobreescribe la comisión por defecto del consignante para este item.
  commission_pct   numeric(6, 4),

  received_at      timestamptz not null default now(),
  return_deadline  date,
  status           public.consignment_agreement_status not null default 'active',
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,

  constraint consignment_agreements_commission_range check (
    commission_pct is null or (commission_pct >= 0 and commission_pct <= 100)
  ),
  constraint consignment_agreements_min_price_non_negative check (
    agreed_min_price is null or agreed_min_price >= 0
  )
);

-- Un item no puede estar consignado dos veces a la vez.
create unique index consignment_agreements_active_item_idx
  on public.consignment_agreements (item_id)
  where status = 'active' and deleted_at is null;

create index consignment_agreements_consignor_idx
  on public.consignment_agreements (consignor_id, status);

create trigger consignment_agreements_set_updated_at
  before update on public.consignment_agreements
  for each row execute function public.set_updated_at();

create trigger consignment_agreements_audit
  after insert or update or delete on public.consignment_agreements
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- consignor_payouts — lo que se le debe al consignante por una venta
-- ---------------------------------------------------------------------------
create table public.consignor_payouts (
  id                uuid primary key default gen_random_uuid(),
  consignor_id      uuid not null references public.consignors (id) on delete restrict,
  order_line_id     uuid not null unique references public.order_lines (id) on delete restrict,

  sale_price        numeric(14, 4) not null,
  commission_pct    numeric(6, 4) not null,
  commission_amount numeric(14, 4) not null,

  -- Lo que hay que entregarle. Generada: no puede desviarse de sus partes.
  net_to_consignor  numeric(14, 4) generated always as (
                      sale_price - commission_amount
                    ) stored,

  status            public.consignor_payout_status not null default 'pending',
  paid_at           timestamptz,
  transaction_id    uuid references public.transactions (id) on delete set null,
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,

  constraint consignor_payouts_amounts_non_negative check (
    sale_price >= 0 and commission_amount >= 0
  ),
  constraint consignor_payouts_commission_within_sale check (commission_amount <= sale_price),
  constraint consignor_payouts_commission_range check (
    commission_pct >= 0 and commission_pct <= 100
  ),
  constraint consignor_payouts_paid_needs_date check (
    status <> 'paid' or paid_at is not null
  )
);

create index consignor_payouts_pending_idx
  on public.consignor_payouts (consignor_id, status)
  where status = 'pending';

create trigger consignor_payouts_set_updated_at
  before update on public.consignor_payouts
  for each row execute function public.set_updated_at();

create trigger consignor_payouts_audit
  after insert or update or delete on public.consignor_payouts
  for each row execute function public.audit_trigger();
