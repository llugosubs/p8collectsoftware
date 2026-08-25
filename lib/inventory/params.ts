import { z } from "zod";

/**
 * El estado de la tabla de inventario vive en la URL: filtros, orden, página y
 * modo de vista. Así una vista filtrada se puede compartir, recargar y volver
 * atrás con el gesto del teléfono, y el servidor puede pre-cargar exactamente
 * lo mismo que va a pedir el cliente.
 *
 * Este schema es la única puerta de entrada. Lo usan igual el Server Component,
 * el hook del cliente y la exportación.
 */

export const ITEM_TYPES = [
  "graded_card",
  "raw_card",
  "sealed_box",
  "sealed_pack",
  "lot",
  "supply",
] as const;

export const ITEM_CATEGORIES = ["sports", "tcg", "other"] as const;

export const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "none"] as const;

export const ITEM_STATUSES = [
  "incoming",
  "in_stock",
  "listed",
  "reserved",
  "sold",
  "consigned_out",
  "returned",
  "lost",
  "consumed",
] as const;

export const OWNER_TYPES = ["own", "consignment"] as const;

/** Columnas por las que se puede ordenar. Lista cerrada: entra en el SQL. */
export const SORT_FIELDS = [
  "created_at",
  "sku",
  "player_or_character",
  "year",
  "grade",
  "market_value",
  "list_price",
  "status",
  "cost_basis",
] as const;

/** Sobre qué cifra aplica el filtro de rango de valor. */
export const VALUE_FIELDS = ["market_value", "list_price", "cost_basis"] as const;

export type SortField = (typeof SORT_FIELDS)[number];
export type ValueField = (typeof VALUE_FIELDS)[number];

/** Columnas que solo existen para quien puede ver costos. */
export const ADMIN_ONLY_FIELDS: ReadonlySet<string> = new Set(["cost_basis"]);

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

/** Lista separada por comas en la URL → arreglo validado. */
function listaDe<T extends readonly [string, ...string[]]>(valores: T) {
  return z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(valores)).max(valores.length))
    .optional();
}

const numeroDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Debe ser un número")
  .optional();

export const inventoryParamsSchema = z.object({
  q: z.string().trim().max(120).optional(),

  type: listaDe(ITEM_TYPES),
  category: listaDe(ITEM_CATEGORIES),
  grading: listaDe(GRADING_COMPANIES),
  status: listaDe(ITEM_STATUSES),
  owner: z.enum(OWNER_TYPES).optional(),

  game: z.string().trim().max(60).optional(),
  location: z.string().trim().max(60).optional(),

  gradeMin: z.coerce.number().min(0).max(10).optional(),
  gradeMax: z.coerce.number().min(0).max(10).optional(),

  valueField: z.enum(VALUE_FIELDS).default("market_value"),
  valueMin: numeroDecimal,
  valueMax: numeroDecimal,

  /** Solo lo publicado, solo lo no publicado, o todo. */
  published: z.enum(["yes", "no"]).optional(),

  sort: z.enum(SORT_FIELDS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),

  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce
    .number()
    .int()
    .refine(
      (n): n is (typeof PER_PAGE_OPTIONS)[number] =>
        (PER_PAGE_OPTIONS as readonly number[]).includes(n),
      "Tamaño de página no permitido",
    )
    .default(50),

  view: z.enum(["list", "grid"]).default("list"),
});

export type InventoryParams = z.infer<typeof inventoryParamsSchema>;

/**
 * Parsea lo que venga de la URL sin fallar nunca: un filtro corrupto en un
 * enlace compartido no debe tumbar la pantalla. Lo inválido se descarta y se
 * cae en los valores por defecto.
 */
export function parseInventoryParams(
  input: Record<string, string | string[] | undefined>,
): InventoryParams {
  const plano: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    plano[key] = Array.isArray(value) ? value.join(",") : value;
  }

  const parsed = inventoryParamsSchema.safeParse(plano);
  if (parsed.success) return parsed.data;

  // Se reintenta quitando solo los campos que fallaron, para no perder el
  // resto del filtro por culpa de uno malo.
  const malos = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  for (const campo of malos) delete plano[campo];

  const segundo = inventoryParamsSchema.safeParse(plano);
  return segundo.success ? segundo.data : inventoryParamsSchema.parse({});
}

/** El inverso: del objeto a la query string, omitiendo lo que es default. */
export function inventoryParamsToSearch(params: Partial<InventoryParams>): string {
  const search = new URLSearchParams();
  const defaults = inventoryParamsSchema.parse({});

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(","));
      continue;
    }
    if (defaults[key as keyof InventoryParams] === value) continue;
    search.set(key, String(value));
  }

  search.delete("page");
  if (params.page && params.page > 1) search.set("page", String(params.page));

  return search.toString();
}
