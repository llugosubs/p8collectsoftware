-- ============================================================================
-- 0016 — Permisos explícitos del service role (Fase 1)
--
-- Descubierto al correr el seed contra la base local: fallaba con "permission
-- denied for table fx_rates" usando el service role, mientras que en el
-- proyecto hospedado la misma llave funcionaba.
--
-- La causa es que los privilegios por defecto que trae cada entorno no son los
-- mismos: el proyecto en la nube concede DML a `service_role` sobre las tablas
-- nuevas, y el stack local no. Apoyarse en eso es frágil — produce el peor tipo
-- de error, el que solo aparece en un entorno y no en el otro.
--
-- Aquí se dicen los permisos en voz alta. Los dos entornos quedan idénticos y
-- dejan de depender de lo que cada uno traiga de fábrica.
-- ============================================================================

-- El service role es la llave del backend: salta RLS por diseño y necesita
-- tocar todo. Nunca llega al navegador.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Y lo mismo para las tablas que creen las fases siguientes, para no repetir
-- este descubrimiento en la Fase 2.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Los contadores de numeración siguen intocables por cualquier vía que no sea
-- `next_document_number()`. Que el backend pueda saltarse RLS no significa que
-- deba poder reescribir la secuencia de SKU a mano.
revoke all on public.document_counters from service_role, authenticated, anon;

-- Las vistas también, que no las alcanza el `on all tables`.
grant select on public.items_with_costs, public.order_lines_with_costs,
  public.receivables, public.payables to service_role;
