-- ============================================================================
-- 0008 — Breaks (Fase 1)
--
-- Abrir una caja sellada: la caja pasa a 'consumed' y nacen N items hijos que
-- apuntan a ella por `items.parent_item_id`.
--
-- La regla que no se puede romper (sección 6.9): el costo de la caja se
-- conserva íntegro en la suma de sus hijos. El reparto —en partes iguales o
-- ponderado hacia los hits— lo calcula lib/domain y se guarda en `item_costs`.
-- ============================================================================

create table public.breaks (
  id                  uuid primary key default gen_random_uuid(),
  source_item_id      uuid not null references public.items (id) on delete restrict,

  opened_at           timestamptz not null default now(),
  platform            public.sales_channel,
  revenue_from_spots  numeric(14, 4) not null default 0,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  deleted_at          timestamptz,

  constraint breaks_revenue_non_negative check (revenue_from_spots >= 0)
);

comment on column public.breaks.revenue_from_spots is
  'Lo cobrado por vender puestos del break. Es ingreso propio, no venta de item.';

-- Una caja se abre una sola vez.
create unique index breaks_source_item_idx
  on public.breaks (source_item_id)
  where deleted_at is null;

create index breaks_opened_at_idx on public.breaks (opened_at desc);

create trigger breaks_set_updated_at
  before update on public.breaks
  for each row execute function public.set_updated_at();

create trigger breaks_audit
  after insert or update or delete on public.breaks
  for each row execute function public.audit_trigger();
