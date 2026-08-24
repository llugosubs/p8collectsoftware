-- ============================================================================
-- 0006 — Inventario (Fase 1)
--
-- `items` es la unidad de inventario: una carta, una caja, un lote, un insumo.
--
-- El costo NO vive aquí. Va en `item_costs`, su propia tabla con su propio RLS,
-- porque el master prompt exige que `staff` no vea costos y el RLS de Postgres
-- filtra filas, no columnas. Separando la fila, la regla la impone la base y no
-- una convención del código.
-- ============================================================================

create table public.items (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text unique not null,

  type                public.item_type not null,
  category            public.item_category not null,

  sport_or_game       text,
  player_or_character text,
  brand               text,
  set_name            text,
  year                int,
  card_number         text,
  variant             text,
  serial_numbered     text,
  is_rookie           boolean not null default false,
  is_autograph        boolean not null default false,
  is_patch            boolean not null default false,
  language            text,

  grading_company     public.grading_company not null default 'none',
  grade               numeric(3, 1),
  grade_label         text,
  cert_number         text,
  raw_condition       public.raw_condition,

  quantity            int not null default 1,
  status              public.item_status not null default 'incoming',
  location            text,

  owner_type          public.owner_type not null default 'own',
  consignor_id        uuid references public.consignors (id) on delete restrict,

  acquisition_id      uuid references public.acquisitions (id) on delete set null,
  -- Cartas que salieron de un break: apuntan a la caja de la que vinieron.
  parent_item_id      uuid references public.items (id) on delete set null,

  -- El valor de mercado no es un costo: el equipo puede verlo.
  market_value        numeric(14, 4),
  market_value_source text,
  market_value_at     timestamptz,

  list_price          numeric(14, 4),
  min_price           numeric(14, 4),

  is_published        boolean not null default false,
  slug                text unique,
  description_es      text,
  description_en      text,
  tags                text[] not null default '{}',

  -- Configuración 'simple': los nombres de jugadores y personajes son propios,
  -- y un stemmer en español los destrozaría ("Wembanyama" no tiene raíz).
  search_vector       tsvector generated always as (
                        to_tsvector('simple',
                          coalesce(sku, '') || ' ' ||
                          coalesce(player_or_character, '') || ' ' ||
                          coalesce(brand, '') || ' ' ||
                          coalesce(set_name, '') || ' ' ||
                          coalesce(sport_or_game, '') || ' ' ||
                          coalesce(card_number, '') || ' ' ||
                          coalesce(variant, '') || ' ' ||
                          coalesce(cert_number, '') || ' ' ||
                          coalesce(serial_numbered, '')
                        )
                      ) stored,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  deleted_at          timestamptz,

  constraint items_quantity_positive check (quantity > 0),
  -- Cantidad mayor que uno solo tiene sentido en sellados e insumos: una carta
  -- graduada es una pieza única y confundirlas rompería el costo por unidad.
  constraint items_quantity_only_for_bulk check (
    quantity = 1 or type in ('sealed_box', 'sealed_pack', 'supply', 'lot')
  ),
  constraint items_grade_range check (grade is null or (grade >= 0 and grade <= 10)),
  constraint items_graded_needs_grade check (
    grading_company = 'none' or grade is not null
  ),
  constraint items_consignment_needs_consignor check (
    (owner_type = 'own' and consignor_id is null)
    or (owner_type = 'consignment' and consignor_id is not null)
  ),
  constraint items_published_needs_slug check (not is_published or slug is not null),
  constraint items_prices_non_negative check (
    (market_value is null or market_value >= 0)
    and (list_price is null or list_price >= 0)
    and (min_price is null or min_price >= 0)
  ),
  constraint items_not_its_own_parent check (parent_item_id is distinct from id)
);

comment on column public.items.search_vector is
  'Búsqueda por texto libre sobre los campos que uno teclea buscando una carta.';

-- Un cert es único en el mundo: dos filas con el mismo cert son la misma carta
-- cargada dos veces. Es la regla que usa el importador para detectar duplicados.
create unique index items_cert_number_idx
  on public.items (grading_company, cert_number)
  where cert_number is not null and deleted_at is null;

create index items_search_idx on public.items using gin (search_vector);
create index items_status_idx on public.items (status) where deleted_at is null;
create index items_acquisition_idx on public.items (acquisition_id);
create index items_parent_idx on public.items (parent_item_id) where parent_item_id is not null;
create index items_consignor_idx on public.items (consignor_id) where consignor_id is not null;
create index items_published_idx on public.items (is_published, category)
  where is_published and deleted_at is null;
create index items_tags_idx on public.items using gin (tags);

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

create trigger items_audit
  after insert or update or delete on public.items
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- SKU automático
-- ---------------------------------------------------------------------------
create or replace function public.assign_item_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sku is null or new.sku = '' then
    new.sku := public.next_document_number('P8');
  end if;
  return new;
end;
$$;

create trigger items_assign_sku
  before insert on public.items
  for each row execute function public.assign_item_sku();

-- ---------------------------------------------------------------------------
-- item_costs — la parte sensible, en su propia fila
--
-- Uno a uno con `items`. `allocated_cost` es lo que devolvió el prorrateo del
-- lote (ver lib/domain/allocation.ts); los demás campos son costos que se
-- suman después: grading, reparación, envío interno.
-- ---------------------------------------------------------------------------
create table public.item_costs (
  item_id         uuid primary key references public.items (id) on delete cascade,

  allocated_cost  numeric(14, 4) not null default 0,
  grading_cost    numeric(14, 4) not null default 0,
  other_cost      numeric(14, 4) not null default 0,

  -- El costo total de la pieza. Generada para que no pueda desviarse de sus
  -- partes: es la cifra que decide si una venta gana o pierde dinero.
  cost_basis      numeric(14, 4) generated always as (
                    allocated_cost + grading_cost + other_cost
                  ) stored,

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,

  constraint item_costs_non_negative check (
    allocated_cost >= 0 and grading_cost >= 0 and other_cost >= 0
  )
);

comment on table public.item_costs is
  'Costo de cada item. Tabla sensible: solo owner y admin. Ver migración de RLS.';

create trigger item_costs_set_updated_at
  before update on public.item_costs
  for each row execute function public.set_updated_at();

create trigger item_costs_audit
  after insert or update or delete on public.item_costs
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- item_images
-- ---------------------------------------------------------------------------
create table public.item_images (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items (id) on delete cascade,
  url        text not null,
  kind       public.image_kind not null default 'front',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index item_images_item_idx on public.item_images (item_id, sort_order);

create trigger item_images_set_updated_at
  before update on public.item_images
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- item_valuations — historial de valor de mercado
--
-- `items.market_value` guarda el último; aquí queda el rastro completo, que es
-- lo que permite ver si una pieza subió o bajó desde que se compró.
-- ---------------------------------------------------------------------------
create table public.item_valuations (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items (id) on delete cascade,
  value      numeric(14, 4) not null,
  source     public.valuation_source not null default 'manual',
  source_url text,
  note       text,
  valued_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint item_valuations_value_non_negative check (value >= 0)
);

create index item_valuations_item_idx on public.item_valuations (item_id, valued_at desc);
