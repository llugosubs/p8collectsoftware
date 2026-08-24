-- ============================================================================
-- 0004 — Consignantes (Fase 1)
--
-- El modelo de consignación entra completo desde ahora aunque su interfaz sea
-- de la Fase 6: si `items.owner_type` puede valer 'consignment', la tabla que
-- referencia tiene que existir antes que `items`.
-- ============================================================================

create table public.consignors (
  id              uuid primary key default gen_random_uuid(),

  -- Un consignante puede tener cuenta en el sistema (rol 'consignor') para ver
  -- su portal, o no tenerla y existir solo como registro.
  user_id         uuid unique references auth.users (id) on delete set null,

  display_name    text not null,
  email           text,
  phone           text,
  country         text,
  city            text,
  id_document     text,

  commission_pct  numeric(6, 4) not null default 15,
  payout_method   public.payment_method,
  payout_details  jsonb not null default '{}'::jsonb,
  agreement_url   text,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,

  constraint consignors_commission_range check (commission_pct >= 0 and commission_pct <= 100)
);

comment on column public.consignors.commission_pct is
  'Comisión por defecto de este consignante. Un acuerdo puede sobreescribirla.';

create index consignors_active_idx on public.consignors (display_name) where deleted_at is null;
create index consignors_user_idx on public.consignors (user_id) where user_id is not null;

create trigger consignors_set_updated_at
  before update on public.consignors
  for each row execute function public.set_updated_at();

create trigger consignors_audit
  after insert or update or delete on public.consignors
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Helper para las políticas del portal de consignante: el id de consignante
-- que corresponde a quien consulta, o null si no es uno.
--
-- SECURITY DEFINER por lo mismo que `current_user_role()`: si una política
-- sobre una tabla de consignación consultara esa tabla con RLS activo, se
-- llamaría a sí misma sin fin.
-- ---------------------------------------------------------------------------
create or replace function public.current_consignor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.consignors where user_id = auth.uid() and deleted_at is null;
$$;
