-- ============================================================================
-- 0007 — Líneas del lote de compra (Fase 1)
--
-- Enlaza cada item con el lote del que vino y con lo que se pagó por él en
-- martillo. Va después de `items` porque referencia las dos tablas.
--
-- SE APARTA DEL MASTER PROMPT: la sección 5.2 pone también `allocated_cost` en
-- esta tabla. No se guarda aquí. Ese número ya vive en `item_costs`, y dos
-- copias del mismo monto en un sistema de dinero terminan divergiendo — basta
-- que alguien corrija una y olvide la otra. El prorrateo del lote sigue siendo
-- auditable: la suma de `item_costs.allocated_cost` de los items del lote tiene
-- que dar exactamente `acquisitions.total_cost`.
-- ============================================================================

create table public.acquisition_lines (
  id             uuid primary key default gen_random_uuid(),
  acquisition_id uuid not null references public.acquisitions (id) on delete cascade,
  item_id        uuid not null references public.items (id) on delete restrict,

  hammer_price   numeric(14, 4) not null,
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,

  constraint acquisition_lines_hammer_non_negative check (hammer_price >= 0),
  constraint acquisition_lines_unique_item unique (acquisition_id, item_id)
);

comment on table public.acquisition_lines is
  'Tabla sensible: expone el precio de compra. Solo owner y admin.';

create index acquisition_lines_acquisition_idx on public.acquisition_lines (acquisition_id);
create index acquisition_lines_item_idx on public.acquisition_lines (item_id);

create trigger acquisition_lines_set_updated_at
  before update on public.acquisition_lines
  for each row execute function public.set_updated_at();

create trigger acquisition_lines_audit
  after insert or update or delete on public.acquisition_lines
  for each row execute function public.audit_trigger();
