-- ============================================================================
-- 0017 — Endurecimiento previo a la Fase 2
--
-- Nueve defectos encontrados al diseñar Inventario, Compras e Importador con
-- crítica adversarial, y verificados uno por uno contra este esquema. Se pagan
-- antes de construir encima, porque los tres módulos se apoyan en ellos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fechas del timeline del item
--
-- El master prompt (§7.2) pide un timeline compra → recepción → listado →
-- venta. La compra ya existe: `acquisitions.purchased_at`. Los otros tres
-- eventos no estaban en ninguna parte.
--
-- No se agrega `acquired_at`: sería copiar `purchased_at`, y este proyecto ya
-- rechazó dos veces duplicar un dato derivado.
-- ---------------------------------------------------------------------------
alter table public.items
  add column received_at timestamptz,
  add column listed_at   timestamptz,
  add column sold_at     timestamptz;

comment on column public.items.received_at is
  'Cuándo llegó físicamente. Alimenta el aging y la rotación de inventario (§7.8).';

create index items_received_at_idx on public.items (received_at)
  where received_at is not null;

-- ---------------------------------------------------------------------------
-- 2. La tasa de cambio de los gastos locales, separada
--
-- `acquisitions.fx_rate` significaba dos cosas a la vez: la tasa Bs./USD con
-- que se pagaron courier y aduana, y el divisor que la vista `payables` usa
-- para convertir un lote comprado en otra moneda. Sobrecargar una columna de
-- dinero es pedir que un día se use la equivocada.
--
-- Y §6.6 exige guardar el monto ORIGINAL en su moneda, no solo el equivalente.
-- ---------------------------------------------------------------------------
alter table public.acquisitions
  add column local_fx_rate        numeric(18, 6),
  add column local_fx_rate_source public.fx_source,
  add column courier_ve_ves       numeric(14, 4),
  add column customs_ve_ves       numeric(14, 4),
  add constraint acquisitions_local_fx_rate_positive
    check (local_fx_rate is null or local_fx_rate > 0),
  add constraint acquisitions_local_amounts_non_negative
    check ((courier_ve_ves is null or courier_ve_ves >= 0)
       and (customs_ve_ves is null or customs_ve_ves >= 0));

comment on column public.acquisitions.local_fx_rate is
  'Tasa Bs./USD del día en que se pagaron courier y aduana. No se recalcula después.';
comment on column public.acquisitions.fx_rate is
  'Tasa de la moneda del LOTE contra USD. Distinta de local_fx_rate.';

-- ---------------------------------------------------------------------------
-- 3. Orden estable de las líneas del lote
--
-- El prorrateo deja el residuo del redondeo en la última línea. Sin un orden
-- garantizado, recalcular el mismo lote dos veces puede dejar ese residuo en
-- una pieza distinta: el cuadre global sigue en verde y el costo de dos cartas
-- cambió sin que nadie pueda explicar por qué.
-- ---------------------------------------------------------------------------
alter table public.acquisition_lines add column line_number int;

update public.acquisition_lines l
set line_number = orden.n
from (
  select id, row_number() over (partition by acquisition_id order by created_at, id) as n
  from public.acquisition_lines
) orden
where orden.id = l.id;

alter table public.acquisition_lines
  alter column line_number set not null,
  add constraint acquisition_lines_line_number_positive check (line_number > 0),
  add constraint acquisition_lines_unique_line_number unique (acquisition_id, line_number);

comment on column public.acquisition_lines.line_number is
  'Orden de la línea dentro del lote. El prorrateo lo usa para que el residuo del redondeo caiga siempre en la misma pieza.';

-- ---------------------------------------------------------------------------
-- 4. Doble envío del wizard
--
-- El índice único de (platform, reference) es PARCIAL: solo aplica cuando hay
-- referencia. Una compra `private` o `retail` no trae número de subasta, así
-- que dos toques en "Confirmar" crearían dos lotes completos con el doble de
-- items y el doble de SKU consumidos.
--
-- La clave de idempotencia la genera el cliente una vez por formulario abierto.
-- ---------------------------------------------------------------------------
alter table public.acquisitions add column idempotency_key text;

create unique index acquisitions_idempotency_key_idx
  on public.acquisitions (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 5. El slug chocaba entre años
--
-- `next_document_number` reinicia el contador cada año, así que P8-2026-0001 y
-- P8-2027-0001 comparten sufijo. Y el `unique` de columna no era parcial: un
-- item borrado reservaba su slug para siempre.
-- ---------------------------------------------------------------------------
alter table public.items drop constraint items_slug_key;

create unique index items_slug_idx
  on public.items (slug)
  where slug is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 6. Auditoría en las dos tablas que se quedaron sin ella
--
-- Una valuación mueve `items.market_value`, que es la mitad de la cifra de
-- valor de inventario de §6.5. Quedaba sin rastro de quién la puso.
-- ---------------------------------------------------------------------------
create trigger item_images_audit
  after insert or update or delete on public.item_images
  for each row execute function public.audit_trigger();

create trigger item_valuations_audit
  after insert or update or delete on public.item_valuations
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 7. La vista de inventario mostraba items borrados
--
-- La política de lectura deja pasar las filas borradas cuando quien consulta
-- es admin (`deleted_at is null or is_admin()`), y la vista no filtraba. El
-- conteo, los totales y la exportación del dueño incluían basura, y el staff
-- veía un número distinto sobre el mismo filtro.
--
-- Se recrea en vez de reemplazarse porque `items` ganó columnas y `select i.*`
-- las insertaría en medio de la lista, que es justo lo que CREATE OR REPLACE
-- VIEW no permite.
-- ---------------------------------------------------------------------------
drop view if exists public.items_with_costs;

create view public.items_with_costs with (security_invoker = true) as
select
  i.*,
  c.allocated_cost,
  c.grading_cost,
  c.other_cost,
  c.cost_basis,
  case
    when c.cost_basis is not null and i.market_value is not null
      then i.market_value - c.cost_basis
  end as unrealized_gain
from public.items i
left join public.item_costs c on c.item_id = i.id
where i.deleted_at is null;

comment on view public.items_with_costs is
  'Inventario vivo con su costo. Quien no puede ver costos recibe NULL, por RLS. Lo borrado no aparece: para eso está items_deleted.';

-- La papelera, explícita. Que el dueño quiera ver lo borrado es legítimo; lo
-- que no puede pasar es que se cuele en un total sin que lo haya pedido.
create view public.items_deleted with (security_invoker = true) as
select i.*, c.cost_basis
from public.items i
left join public.item_costs c on c.item_id = i.id
where i.deleted_at is not null;

grant select on public.items_with_costs, public.items_deleted to authenticated, service_role;
revoke all on public.items_with_costs, public.items_deleted from anon;

-- ---------------------------------------------------------------------------
-- 8. Fotos: un viewer podía subirlas y un staff dejaba huérfanos
--
-- `can_access_admin()` incluye a `viewer`, así que el rol de solo lectura
-- podía escribir en un bucket PÚBLICO. Y borrar exigía `is_admin()`, mientras
-- que borrar la fila de `item_images` solo pedía `is_staff_or_above()`: un
-- staff quitaba la foto de la ficha y el archivo seguía servido en su URL para
-- siempre.
--
-- Ahora los tres verbos piden lo mismo que la tabla: is_staff_or_above().
-- ---------------------------------------------------------------------------
drop policy "cards: escritura del equipo" on storage.objects;
drop policy "cards: actualización del equipo" on storage.objects;
drop policy "cards: borrado de owner y admin" on storage.objects;

create policy "cards: el equipo escribe"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'cards' and public.is_staff_or_above());

create policy "cards: el equipo actualiza"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'cards' and public.is_staff_or_above())
  with check (bucket_id = 'cards' and public.is_staff_or_above());

create policy "cards: el equipo borra"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cards' and public.is_staff_or_above());

-- ---------------------------------------------------------------------------
-- 9. El bucket `docs` rechazaba el Excel del importador
--
-- Solo admitía imágenes y PDF, y no tenía política de UPDATE — así que un
-- reintento de subida tras un fallo de red moría con 42501.
-- ---------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  -- .xlsx
  'application/vnd.ms-excel',                                           -- .xls
  'text/csv',
  'text/plain'                                                          -- pegado del portapapeles
]
where id = 'docs';

create policy "docs: actualización de owner y admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'docs' and public.is_admin())
  with check (bucket_id = 'docs' and public.is_admin());
