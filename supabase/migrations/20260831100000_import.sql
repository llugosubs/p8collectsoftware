-- ============================================================================
-- 0020 — Importador semanal de Excel (Fase 2, Entrega C)
--
-- Tres tablas y dos funciones. La promesa del módulo es doble y las dos mitades
-- viven aquí:
--
--  · Confirmar un archivo es TODO O NADA. Un lote a medio escribir dejaría
--    cientos de items sin costo y un total de compra que no cuadra con sus
--    piezas — la clase de daño que no se nota hasta que un margen sale raro
--    tres meses después.
--
--  · Y se puede DESHACER. Por eso `import_batch_rows.item_id` se escribe
--    dentro de la MISMA transacción que crea el item: si el enlace se guardara
--    después, un fallo entre las dos escrituras dejaría un lote irreversible,
--    que es justo lo que la reversión promete que no pasa.
--
-- El importador NO inventa un camino de escritura propio: llama a
-- `create_acquisition`, la misma función que usa el wizard de Compras. El
-- prorrateo se calcula en un solo sitio (lib/domain/allocation.ts) y se asserta
-- en un solo sitio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
--
-- Tres, y cada uno responde una pregunta distinta:
--
--   import_batch_status  ¿en qué punto está el archivo?     (lo pide §7.12)
--   import_row_state     ¿qué DECIDIMOS sobre esta fila?    (antes de confirmar)
--   import_row_result    ¿qué PASÓ con esta fila?           (después)
--
-- Los dos últimos parecen el mismo y no lo son. "duplicada en base" es una
-- decisión de la previsualización; "omitida" es lo que ocurrió. Mezclarlos
-- obligaría a borrar el motivo para escribir el desenlace, y el motivo es lo
-- único que explica por qué una carta que estaba en el archivo no está en el
-- inventario.
-- ---------------------------------------------------------------------------
create type public.import_batch_status as enum ('previewed', 'committed', 'reverted');

create type public.import_row_state as enum (
  'new',                -- se crea
  'duplicate_in_file',  -- otra fila del MISMO archivo ya trae este cert
  'duplicate_in_db',    -- ya existe en el inventario
  'update_existing',    -- existe, y el dueño eligió actualizarla
  'error'               -- no se puede cargar: falta el nombre, el hammer no es número...
);

create type public.import_row_result as enum ('created', 'updated', 'skipped', 'error');

-- ---------------------------------------------------------------------------
-- import_templates — el mapeo que no hay que volver a hacer
--
-- El valor del módulo está aquí: la primera semana se mapean 27 columnas, y
-- las siguientes no se mapea nada.
-- ---------------------------------------------------------------------------
create table public.import_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,

  -- { "Jugador / Personaje": "playerOrCharacter", ... } — encabezado → campo.
  column_mapping     jsonb not null,

  default_platform   public.acquisition_platform,

  -- Si el archivo del dueño siempre trae números venezolanos, recordarlo evita
  -- que una columna ambigua ("1.234") pregunte todas las semanas. NULL = se
  -- deduce del archivo, que es lo que hace lib/domain/import/number-format.ts.
  decimal_convention text,

  last_used_at       timestamptz,
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  deleted_at         timestamptz,

  constraint import_templates_name_not_blank check (btrim(name) <> ''),
  constraint import_templates_mapping_is_object check (jsonb_typeof(column_mapping) = 'object'),
  constraint import_templates_convention_known check (
    decimal_convention is null or decimal_convention in ('es', 'us')
  )
);

-- Dos plantillas con el mismo nombre son una trampa: la semana que viene se
-- elige la equivocada del selector y el mapeo sale movido una columna.
create unique index import_templates_name_idx
  on public.import_templates (lower(btrim(name)))
  where deleted_at is null;

create trigger import_templates_set_updated_at
  before update on public.import_templates
  for each row execute function public.set_updated_at();

create trigger import_templates_audit
  after insert or update or delete on public.import_templates
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- import_batches — un archivo subido
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid references public.import_templates (id) on delete set null,

  -- Ruta dentro del bucket `docs`, no una URL firmada: las firmas caducan y
  -- guardar una caducada es guardar nada.
  file_url      text,
  file_name     text,
  sheet_name    text,
  header_row    int,

  status        public.import_batch_status not null default 'previewed',

  rows_total    int not null default 0,
  rows_created  int not null default 0,
  rows_updated  int not null default 0,
  rows_skipped  int not null default 0,
  rows_error    int not null default 0,

  -- El reporte final de §7.12: lotes creados, total invertido, fotos pendientes.
  summary       jsonb not null default '{}'::jsonb,

  committed_at  timestamptz,
  reverted_at   timestamptz,
  reverted_by   uuid references auth.users (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  deleted_at    timestamptz,

  -- El estado y las marcas de tiempo no pueden contarse historias distintas.
  constraint import_batches_status_timestamps check (
    (status = 'previewed' and committed_at is null and reverted_at is null)
    or (status = 'committed' and committed_at is not null and reverted_at is null)
    or (status = 'reverted' and committed_at is not null and reverted_at is not null)
  ),
  constraint import_batches_counts_non_negative check (
    rows_total >= 0 and rows_created >= 0 and rows_updated >= 0
    and rows_skipped >= 0 and rows_error >= 0
  ),
  constraint import_batches_header_row_positive check (header_row is null or header_row > 0)
);

create index import_batches_status_idx on public.import_batches (status)
  where deleted_at is null;
create index import_batches_created_at_idx on public.import_batches (created_at desc);

create trigger import_batches_set_updated_at
  before update on public.import_batches
  for each row execute function public.set_updated_at();

create trigger import_batches_audit
  after insert or update or delete on public.import_batches
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- import_batch_rows — cada fila del archivo, con su desenlace
--
-- `raw_data` se guarda tal como vino. Es lo que permite, meses después,
-- responder "¿y qué decía el Excel exactamente?" sin depender de que el
-- archivo original siga en Storage.
-- ---------------------------------------------------------------------------
create table public.import_batch_rows (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references public.import_batches (id) on delete cascade,

  -- La fila del archivo, 1-based y contando los encabezados: es el número que
  -- el dueño ve en Excel cuando va a corregir.
  row_number           int not null,

  raw_data             jsonb not null,
  mapped_data          jsonb,

  state                public.import_row_state not null,
  result               public.import_row_result,

  -- plataforma + referencia + fecha: el lote al que va esta fila.
  group_key            text,

  item_id              uuid references public.items (id) on delete set null,
  acquisition_id       uuid references public.acquisitions (id) on delete set null,
  duplicate_of_item_id uuid references public.items (id) on delete set null,
  error_message        text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint import_batch_rows_unique_row unique (batch_id, row_number),
  constraint import_batch_rows_row_number_positive check (row_number > 0),
  -- Una fila marcada como error sin decir cuál es un error inútil.
  constraint import_batch_rows_error_has_message check (
    state <> 'error' or error_message is not null
  ),
  -- Sin este enlace no hay reversión posible, así que se exige.
  constraint import_batch_rows_created_has_item check (
    result is distinct from 'created' or item_id is not null
  ),
  constraint import_batch_rows_updated_has_item check (
    result is distinct from 'updated' or item_id is not null
  )
);

create index import_batch_rows_batch_idx on public.import_batch_rows (batch_id, row_number);
create index import_batch_rows_item_idx on public.import_batch_rows (item_id)
  where item_id is not null;

create trigger import_batch_rows_set_updated_at
  before update on public.import_batch_rows
  for each row execute function public.set_updated_at();

create trigger import_batch_rows_audit
  after insert or update or delete on public.import_batch_rows
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS
--
-- El importador crea `acquisitions`, y esa tabla es de admin para arriba. Un
-- `staff` que pudiera preparar un lote llegaría hasta el último botón y ahí
-- rebotaría con un error de permisos, después de mapear 27 columnas. Mejor que
-- el módulo entero sea de admin y se diga desde la puerta.
-- ---------------------------------------------------------------------------
alter table public.import_templates  enable row level security;
alter table public.import_batches    enable row level security;
alter table public.import_batch_rows enable row level security;

create policy "import_templates: solo admin" on public.import_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "import_batches: solo admin" on public.import_batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "import_batch_rows: solo admin" on public.import_batch_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- La ventana de reversión de §7.12, como ajuste y no como número clavado en el
-- código: el día que sean 14 no hace falta una migración.
insert into public.settings (key, value, description, is_public) values
  ('import_revert_window_days', '7'::jsonb,
   'Días durante los que se puede revertir un lote importado', false)
on conflict (key) do nothing;
