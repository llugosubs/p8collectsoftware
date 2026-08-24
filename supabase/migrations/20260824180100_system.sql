-- ============================================================================
-- 0003 — Tablas de sistema (Fase 1)
--
-- Auditoría, configuración y notificaciones internas. Van antes que las tablas
-- de negocio porque el trigger de auditoría se engancha a casi todas ellas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid,
  action      public.audit_action not null,
  old_data    jsonb,
  new_data    jsonb,
  user_id     uuid references auth.users (id) on delete set null,
  at          timestamptz not null default now()
);

comment on table public.audit_log is
  'Rastro de toda mutación de dinero o inventario. Solo se escribe por trigger.';

create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_user_idx on public.audit_log (user_id);

-- ---------------------------------------------------------------------------
-- El trigger genérico de auditoría.
--
-- SECURITY DEFINER para poder escribir en audit_log aunque quien dispare la
-- mutación no tenga permiso de insertar ahí — que es justamente el caso: nadie
-- escribe el rastro a mano.
-- ---------------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload    jsonb;
  audited_id uuid;
begin
  payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  -- No todas las tablas se llaman `id`: las que guardan la parte sensible de
  -- otra entidad usan la clave de la entidad (item_id, order_line_id...). Se
  -- busca la primera que exista, y si no hay ninguna —settings, por ejemplo,
  -- que se identifica por texto— el rastro queda igual, con la fila completa
  -- en `new_data`.
  begin
    audited_id := coalesce(
      payload ->> 'id',
      payload ->> 'item_id',
      payload ->> 'order_line_id',
      payload ->> 'account_id'
    )::uuid;
  exception when others then
    audited_id := null;
  end;

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
  values (
    tg_table_name,
    audited_id,
    lower(tg_op)::public.audit_action,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- settings
--
-- Clave/valor con jsonb para no inventar una columna por ajuste. `is_public`
-- marca lo que la tienda puede leer sin sesión (políticas de envío, datos del
-- negocio); todo lo demás es interno.
-- ---------------------------------------------------------------------------
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_trigger();

-- Datos de arranque de la sección 13 del master prompt.
insert into public.settings (key, value, description, is_public) values
  ('card_fee_pct',            '3.3'::jsonb,     'Fee por pagar con tarjeta, en porcentaje', false),
  ('base_currency',           '"USD"'::jsonb,   'Moneda base de los reportes',              false),
  ('secondary_currency',      '"VES"'::jsonb,   'Segunda moneda de la operación',           false),
  ('consignment_commission_pct', '15'::jsonb,   'Comisión de consignación por defecto',     false),
  ('fx_primary_source',       '"bcv"'::jsonb,   'Fuente oficial de la tasa de cambio',      false),
  ('fx_reference_source',     '"binance"'::jsonb, 'Fuente de referencia paralela',          false),
  ('stock_reservation_hours', '24'::jsonb,      'Horas que un item queda reservado sin pago verificado', false),
  ('store_name',              '"P8 Collects"'::jsonb, 'Nombre comercial',                   true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- notifications
--
-- Alertas internas: pago sin verificar, item sin foto, lote pagado y no
-- recibido, cuenta por cobrar vencida. `user_id` nulo significa "para todo el
-- equipo administrativo".
-- ---------------------------------------------------------------------------
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users (id) on delete cascade,
  kind           text not null,
  title          text not null,
  body           text,
  link           text,
  reference_type text,
  reference_id   uuid,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Numeración de documentos: SKU de inventario (`P8-2026-0001`) y número de
-- orden (`P8O-2026-0001`).
--
-- Una secuencia de Postgres no se reinicia por año, así que la cuenta va en una
-- tabla. El `insert … on conflict do update … returning` serializa a los
-- concurrentes en la fila del contador, sin bloqueo explícito ni huecos.
-- ---------------------------------------------------------------------------
create table public.document_counters (
  prefix     text not null,
  year       int  not null,
  last_value int  not null default 0,
  primary key (prefix, year)
);

create or replace function public.next_document_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_year int := extract(year from now())::int;
  next_value  int;
begin
  insert into public.document_counters as c (prefix, year, last_value)
  values (p_prefix, target_year, 1)
  on conflict (prefix, year) do update set last_value = c.last_value + 1
  returning c.last_value into next_value;

  return p_prefix || '-' || target_year || '-' || lpad(next_value::text, 4, '0');
end;
$$;
