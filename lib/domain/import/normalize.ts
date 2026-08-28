/**
 * Normalización de los VALORES de las celdas a los enums del esquema.
 *
 * No es lo mismo que reconocer encabezados. El Excel del dueño dice "Fanatics
 * Collect", "carta graduada", "psa" y "sí"; el esquema espera `fanatics`,
 * `graded_card`, `PSA` y `true`. Sin esta capa, cada fila revienta con un cast
 * fallido a mitad de la transacción y el error que llega es ilegible.
 *
 * Detalle que se escapa fácil: `grading_company` es el ÚNICO enum del esquema
 * en mayúsculas. Un archivo que diga "psa" en minúscula no casa solo.
 */

/** Sin acentos, sin puntuación, en minúsculas: para comparar de verdad. */
export function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buscar<T extends string>(
  raw: string | null | undefined,
  mapa: Readonly<Record<string, T>>,
): T | null {
  if (raw === null || raw === undefined) return null;
  const clave = fold(raw);
  if (clave === "") return null;
  return mapa[clave] ?? null;
}

// ---------------------------------------------------------------------------
// Gradadora
// ---------------------------------------------------------------------------

const GRADADORAS: Readonly<Record<string, "PSA" | "BGS" | "CGC" | "SGC" | "TAG" | "none">> = {
  psa: "PSA",
  "psa grading": "PSA",
  bgs: "BGS",
  beckett: "BGS",
  "beckett bgs": "BGS",
  cgc: "CGC",
  sgc: "SGC",
  tag: "TAG",
  none: "none",
  raw: "none",
  "sin gradar": "none",
  cruda: "none",
  ninguna: "none",
};

export function normalizeGradingCompany(raw: string | null | undefined) {
  // Una celda vacía en ESTA columna sí significa algo: la carta no está
  // gradada. Es la única normalización donde el vacío es una respuesta y no
  // una ausencia — en plataforma o en tipo, un vacío es un dato que falta.
  if (raw === null || raw === undefined || fold(raw) === "") return "none" as const;
  return buscar(raw, GRADADORAS);
}

// ---------------------------------------------------------------------------
// Plataforma de compra
// ---------------------------------------------------------------------------

const PLATAFORMAS: Readonly<
  Record<
    string,
    "alt" | "goldin" | "ebay" | "whatnot" | "fanatics" | "pwcc" | "private" | "retail" | "other"
  >
> = {
  alt: "alt",
  "alt auctions": "alt",
  goldin: "goldin",
  "goldin auctions": "goldin",
  ebay: "ebay",
  whatnot: "whatnot",
  fanatics: "fanatics",
  "fanatics collect": "fanatics",
  pwcc: "pwcc",
  private: "private",
  particular: "private",
  privado: "private",
  "compra directa": "private",
  retail: "retail",
  tienda: "retail",
  other: "other",
  otra: "other",
  otro: "other",
};

export function normalizePlatform(raw: string | null | undefined) {
  return buscar(raw, PLATAFORMAS);
}

// ---------------------------------------------------------------------------
// Tipo de pieza
// ---------------------------------------------------------------------------

const TIPOS: Readonly<
  Record<string, "graded_card" | "raw_card" | "sealed_box" | "sealed_pack" | "lot" | "supply">
> = {
  "graded card": "graded_card",
  graded: "graded_card",
  graduada: "graded_card",
  "carta graduada": "graded_card",
  slab: "graded_card",
  "raw card": "raw_card",
  raw: "raw_card",
  cruda: "raw_card",
  "carta raw": "raw_card",
  carta: "raw_card",
  "sealed box": "sealed_box",
  box: "sealed_box",
  caja: "sealed_box",
  "caja sellada": "sealed_box",
  "sealed pack": "sealed_pack",
  pack: "sealed_pack",
  sobre: "sealed_pack",
  "sobre sellado": "sealed_pack",
  booster: "sealed_pack",
  lot: "lot",
  lote: "lot",
  supply: "supply",
  insumo: "supply",
  insumos: "supply",
  fundas: "supply",
};

export function normalizeItemType(raw: string | null | undefined) {
  return buscar(raw, TIPOS);
}

// ---------------------------------------------------------------------------
// Condición de una carta sin gradar
// ---------------------------------------------------------------------------

const CONDICIONES: Readonly<Record<string, "NM" | "LP" | "MP" | "HP" | "DMG">> = {
  nm: "NM",
  "near mint": "NM",
  mint: "NM",
  lp: "LP",
  "lightly played": "LP",
  "poco jugada": "LP",
  mp: "MP",
  "moderately played": "MP",
  hp: "HP",
  "heavily played": "HP",
  dmg: "DMG",
  damaged: "DMG",
  danada: "DMG",
};

export function normalizeRawCondition(raw: string | null | undefined) {
  return buscar(raw, CONDICIONES);
}

// ---------------------------------------------------------------------------
// Sí / no
// ---------------------------------------------------------------------------

const VERDADEROS = new Set(["si", "s", "yes", "y", "true", "1", "x", "verdadero", "ok"]);
const FALSOS = new Set(["no", "n", "false", "0", "falso", ""]);

/** Devuelve null cuando el valor no es reconocible: no asume que "quizá" es no. */
export function normalizeBoolean(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return null;
  const clave = fold(raw);
  if (VERDADEROS.has(clave)) return true;
  if (FALSOS.has(clave)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Categoría
// ---------------------------------------------------------------------------

const DEPORTES = new Set([
  "nba",
  "basketball",
  "baloncesto",
  "nfl",
  "football",
  "futbol americano",
  "mlb",
  "baseball",
  "beisbol",
  "nhl",
  "hockey",
  "soccer",
  "futbol",
  "ufc",
  "mma",
  "boxing",
  "boxeo",
  "f1",
  "formula 1",
  "golf",
  "tennis",
  "tenis",
  "wwe",
]);

const JUEGOS = new Set([
  "one piece",
  "pokemon",
  "magic",
  "magic the gathering",
  "mtg",
  "yu gi oh",
  "yugioh",
  "digimon",
  "dragon ball",
  "dragon ball super",
  "lorcana",
  "flesh and blood",
  "weiss schwarz",
  "union arena",
  "star wars unlimited",
]);

/**
 * De qué categoría es una pieza, a partir del deporte o juego.
 *
 * `items.category` es obligatorio en el esquema y la plantilla de 27 columnas
 * del master prompt NO tiene columna de categoría — así que hay que deducirla.
 * Es una regla de negocio, y por eso vive aquí y no en el parser.
 *
 * Devuelve `null` cuando no reconoce el deporte o juego: la fila se marca para
 * que el dueño elija, en vez de caer en "other" en silencio y aparecer después
 * en el sitio equivocado del inventario.
 */
export function deriveCategory(
  sportOrGame: string | null | undefined,
  explicit?: string | null,
): "sports" | "tcg" | "other" | null {
  const forzada = buscar(explicit, {
    sports: "sports",
    deportes: "sports",
    deporte: "sports",
    tcg: "tcg",
    juego: "tcg",
    cartas: "tcg",
    other: "other",
    otro: "other",
    otra: "other",
  } as const);
  if (forzada) return forzada;

  if (sportOrGame === null || sportOrGame === undefined) return null;
  const clave = fold(sportOrGame);
  if (clave === "") return null;

  if (DEPORTES.has(clave)) return "sports";
  if (JUEGOS.has(clave)) return "tcg";

  return null;
}
