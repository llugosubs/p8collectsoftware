import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { readNullableNumeric } from "@/lib/supabase/numeric";
import type { ItemStatus, OwnerType, ValuedItem } from "@/lib/domain/inventory";

import { ADMIN_ONLY_FIELDS, type InventoryParams } from "./params";

/**
 * El único constructor de consulta del inventario.
 *
 * Lo usan la tabla, el grid, los totales y la exportación. Una sola superficie
 * que auditar, y un solo sitio donde puede colarse un filtro mal escrito.
 *
 * Siempre sobre `items_with_costs`, nunca sobre `items`: la vista ya resuelve
 * el costo por RLS —real para owner y admin, NULL para el resto— y filtra lo
 * borrado. Consultar la tabla directamente obligaría a la UI a saber quién ve
 * costos para armar la consulta, y el día que alguien lo olvide el costo se
 * filtra por la API.
 */

export type InventoryRow = Database["public"]["Views"]["items_with_costs"]["Row"];

/**
 * Una fila de la vista con `id` y `sku` ya garantizados.
 *
 * PostgREST declara anulable toda columna de una vista, porque Postgres no
 * puede probar lo contrario a través de un JOIN. En `items` las dos son NOT
 * NULL, así que el caso no ocurre — pero se estrecha aquí, una sola vez y con
 * una guardia real, en vez de repartir `!` por toda la interfaz.
 */
export type UsableInventoryRow = InventoryRow & { id: string; sku: string };

function esUsable(row: InventoryRow): row is UsableInventoryRow {
  return typeof row.id === "string" && typeof row.sku === "string";
}

export type InventoryClient = SupabaseClient<Database>;

/** Columnas que la tabla y el grid necesitan. Se piden explícitas, no `*`. */
export const INVENTORY_COLUMNS = [
  "id",
  "sku",
  "type",
  "category",
  "sport_or_game",
  "player_or_character",
  "brand",
  "set_name",
  "year",
  "card_number",
  "variant",
  "serial_numbered",
  "grading_company",
  "grade",
  "grade_label",
  "cert_number",
  "raw_condition",
  "quantity",
  "status",
  "location",
  "owner_type",
  "consignor_id",
  "acquisition_id",
  "market_value",
  "list_price",
  "min_price",
  "is_published",
  "slug",
  "tags",
  "created_at",
  "received_at",
  "listed_at",
  "sold_at",
  "cost_basis",
  "unrealized_gain",
].join(",");

export type InventoryQueryOptions = {
  /**
   * Si quien consulta puede ver costos. No es para esconder nada —de eso ya se
   * encarga el RLS— sino para no aceptar un filtro POR COSTO de alguien que no
   * lo ve: con un rango y unos cuantos intentos, un `staff` podría deducir por
   * búsqueda binaria el costo exacto de una pieza. La fuga sería por el filtro,
   * no por el dato.
   */
  canSeeCosts: boolean;
};

/**
 * Se arranca siempre por aquí para que el tipo del constructor quede atado a
 * esta vista concreta. Derivarlo de `from()` sin literal daría la unión de
 * todas las tablas del esquema, y ningún filtro tiparía.
 */
function baseQuery(supabase: InventoryClient, columns: string, exactCount: boolean) {
  return supabase
    .from("items_with_costs")
    .select(columns, exactCount ? { count: "exact" } : undefined);
}

type Builder = ReturnType<typeof baseQuery>;

/** Aplica los filtros del usuario a una consulta ya iniciada. */
function aplicarFiltros(
  query: Builder,
  params: InventoryParams,
  options: InventoryQueryOptions,
): Builder {
  let q = query;

  if (params.q) {
    // `search_vector` es una columna generada con índice GIN sobre los campos
    // que uno teclea buscando una carta.
    q = q.textSearch("search_vector", params.q, { type: "websearch", config: "simple" });
  }

  if (params.type?.length) q = q.in("type", params.type);
  if (params.category?.length) q = q.in("category", params.category);
  if (params.grading?.length) q = q.in("grading_company", params.grading);
  if (params.status?.length) q = q.in("status", params.status);
  if (params.owner) q = q.eq("owner_type", params.owner);
  if (params.game) q = q.eq("sport_or_game", params.game);
  if (params.location) q = q.eq("location", params.location);
  if (params.published) q = q.eq("is_published", params.published === "yes");

  if (params.gradeMin !== undefined) q = q.gte("grade", params.gradeMin);
  if (params.gradeMax !== undefined) q = q.lte("grade", params.gradeMax);

  const campoValor = params.valueField;
  const puedeFiltrarPorEseCampo = !ADMIN_ONLY_FIELDS.has(campoValor) || options.canSeeCosts;

  if (puedeFiltrarPorEseCampo) {
    if (params.valueMin !== undefined) q = q.gte(campoValor, params.valueMin);
    if (params.valueMax !== undefined) q = q.lte(campoValor, params.valueMax);
  }

  return q;
}

/**
 * Una página de inventario, con el total que cumple el filtro.
 *
 * El desempate por `id` no es opcional: ordenar por una columna no única
 * —estado, ubicación, valor de mercado— sin desempate deja a Postgres libre de
 * devolver la misma fila en dos páginas y omitir otra.
 */
export async function fetchInventoryPage(
  supabase: InventoryClient,
  params: InventoryParams,
  options: InventoryQueryOptions,
) {
  const desde = (params.page - 1) * params.perPage;
  const hasta = desde + params.perPage - 1;

  const ordenarPorCosto = params.sort === "cost_basis" && !options.canSeeCosts;
  const campoOrden = ordenarPorCosto ? "created_at" : params.sort;

  const query = aplicarFiltros(baseQuery(supabase, INVENTORY_COLUMNS, true), params, options)
    .order(campoOrden, { ascending: params.dir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(desde, hasta);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    rows: ((data ?? []) as unknown as InventoryRow[]).filter(esUsable),
    total: count ?? 0,
    page: params.page,
    perPage: params.perPage,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / params.perPage)),
  };
}

/**
 * Las filas que hacen falta para los totales de §6.5.
 *
 * Se piden solo cuatro columnas y sin paginar: el número que decide si el
 * negocio va bien no puede estar truncado a la primera página.
 */
export async function fetchInventoryValuation(
  supabase: InventoryClient,
  params: InventoryParams,
  options: InventoryQueryOptions,
): Promise<ValuedItem[]> {
  const query = aplicarFiltros(
    baseQuery(supabase, "status,owner_type,quantity,cost_basis,market_value", false),
    params,
    options,
  );

  const { data, error } = await query;
  if (error) throw error;

  type Fila = {
    status: ItemStatus;
    owner_type: OwnerType;
    quantity: number;
    cost_basis: number | null;
    market_value: number | null;
  };

  return ((data ?? []) as unknown as Fila[]).map((row) => ({
    status: row.status,
    ownerType: row.owner_type,
    quantity: row.quantity,
    costBasis: readNullableNumeric(row.cost_basis),
    marketValue: readNullableNumeric(row.market_value),
  }));
}
