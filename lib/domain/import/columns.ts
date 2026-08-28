import { fold } from "./normalize";

/**
 * Reconocimiento de encabezados.
 *
 * El dueño arma su tabla como le da la gana: "Jugador", "Player", "PLAYER /
 * CHARACTER", "jugador o personaje". Esto propone el mapeo y él corrige lo que
 * haga falta; después se guarda como plantilla y la semana siguiente ya no hay
 * nada que mapear.
 *
 * La propuesta NUNCA se aplica sola sin que se vea: un encabezado mal
 * entendido mete el martillo en la columna del valor de mercado, y eso no se
 * nota hasta que el margen sale raro tres meses después.
 */

export const IMPORT_FIELDS = [
  "purchasedAt",
  "platform",
  "reference",
  "type",
  "category",
  "sportOrGame",
  "playerOrCharacter",
  "brand",
  "setName",
  "year",
  "cardNumber",
  "variant",
  "serialNumbered",
  "gradingCompany",
  "grade",
  "certNumber",
  "rawCondition",
  "quantity",
  "hammerPrice",
  "buyerPremium",
  "cardFeePct",
  "shippingIntl",
  "courierVe",
  "customsVe",
  "marketValue",
  "received",
  "location",
  "notes",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Sinónimos por campo, en español e inglés. El primero es el de la plantilla. */
const SINONIMOS: Readonly<Record<ImportField, readonly string[]>> = {
  purchasedAt: ["fecha compra", "fecha de compra", "fecha", "purchase date", "date", "comprado"],
  platform: ["plataforma", "platform", "casa", "fuente", "source", "marketplace"],
  reference: [
    "referencia subasta",
    "referencia",
    "reference",
    "auction",
    "auction id",
    "lote",
    "orden",
    "order",
  ],
  type: ["tipo", "type", "item type", "tipo de pieza"],
  category: ["categoria", "category"],
  sportOrGame: ["deporte o juego", "deporte", "juego", "sport", "game", "sport or game", "liga"],
  playerOrCharacter: [
    "jugador o personaje",
    "jugador",
    "personaje",
    "player",
    "character",
    "player or character",
    "nombre",
    "name",
    "carta",
    "card",
  ],
  brand: ["marca", "brand", "fabricante", "manufacturer"],
  setName: ["set", "set name", "coleccion", "collection", "producto"],
  year: ["ano", "anio", "year", "temporada", "season"],
  cardNumber: ["numero", "num", "number", "card number", "card no", "no"],
  variant: ["variante", "variant", "parallel", "paralelo", "insert", "refractor"],
  serialNumbered: ["serial", "serial numbered", "numerada", "numbered", "serie"],
  gradingCompany: ["gradadora", "grading", "grading company", "grader", "empresa", "company"],
  grade: ["grado", "grade", "nota", "calificacion"],
  certNumber: ["cert", "cert number", "certificado", "certificate", "certification"],
  rawCondition: ["condicion raw", "condicion", "condition", "estado carta", "raw condition"],
  quantity: ["cantidad", "quantity", "qty", "unidades", "units"],
  hammerPrice: ["hammer usd", "hammer", "martillo", "precio", "price", "hammer price", "bid"],
  buyerPremium: [
    "premium usd",
    "premium",
    "comision",
    "buyer premium",
    "buyers premium",
    "bp",
    "comision casa",
  ],
  cardFeePct: ["fee tarjeta pct", "fee tarjeta", "card fee", "fee", "cc fee", "comision tarjeta"],
  shippingIntl: ["envio usd", "envio", "shipping", "shipping usd", "flete"],
  courierVe: ["courier ve usd", "courier", "courier usd", "mensajeria"],
  customsVe: ["aduana usd", "aduana", "customs", "customs usd", "impuestos", "arancel"],
  marketValue: [
    "valor mercado usd",
    "valor mercado",
    "valor de mercado",
    "market value",
    "market",
    "comp",
    "comps",
  ],
  received: ["recibido", "received", "en mano", "in hand", "llego"],
  location: ["ubicacion", "location", "donde", "bodega", "vault"],
  notes: ["notas", "nota", "notes", "note", "comentarios", "comments", "observaciones"],
};

export type ColumnMatch = {
  /** Índice de la columna en la hoja. */
  index: number;
  header: string;
  field: ImportField | null;
  /** 1 = coincidencia exacta con un sinónimo; menos = parecido. */
  score: number;
};

/** Cuántas palabras comparten dos textos, sobre el total del sinónimo. */
function similitud(encabezado: string, sinonimo: string): number {
  if (encabezado === sinonimo) return 1;

  const a = new Set(encabezado.split(" ").filter(Boolean));
  const b = sinonimo.split(" ").filter(Boolean);
  if (b.length === 0) return 0;

  const compartidas = b.filter((palabra) => a.has(palabra)).length;
  if (compartidas === 0) return 0;

  // Se penaliza que el encabezado traiga muchas palabras de más, para que
  // "notas del envío" no gane contra "notas".
  const exceso = Math.max(0, a.size - b.length);
  return (compartidas / b.length) * (1 - Math.min(0.5, exceso * 0.15));
}

/** El umbral por debajo del cual preferimos no proponer nada. */
export const MATCH_THRESHOLD = 0.6;

/**
 * Propone un campo para cada encabezado.
 *
 * Un campo no se propone dos veces: si dos columnas se parecen al mismo campo,
 * gana la que se parece más y la otra queda sin proponer, para que el dueño
 * decida. Es preferible a repartir el mismo dato en dos sitios.
 */
export function matchColumns(headers: readonly string[]): ColumnMatch[] {
  const candidatos: { index: number; field: ImportField; score: number }[] = [];

  headers.forEach((header, index) => {
    const limpio = fold(header);
    if (limpio === "") return;

    for (const field of IMPORT_FIELDS) {
      let mejor = 0;
      for (const sinonimo of SINONIMOS[field]) {
        mejor = Math.max(mejor, similitud(limpio, fold(sinonimo)));
      }
      if (mejor >= MATCH_THRESHOLD) candidatos.push({ index, field, score: mejor });
    }
  });

  candidatos.sort((a, b) => b.score - a.score);

  const camposUsados = new Set<ImportField>();
  const columnasUsadas = new Set<number>();
  const asignado = new Map<number, { field: ImportField; score: number }>();

  for (const c of candidatos) {
    if (camposUsados.has(c.field) || columnasUsadas.has(c.index)) continue;
    camposUsados.add(c.field);
    columnasUsadas.add(c.index);
    asignado.set(c.index, { field: c.field, score: c.score });
  }

  return headers.map((header, index) => ({
    index,
    header,
    field: asignado.get(index)?.field ?? null,
    score: asignado.get(index)?.score ?? 0,
  }));
}

/**
 * La fila de encabezados de una hoja con basura arriba.
 *
 * Los Excel de verdad traen el nombre del lote, una fila vacía y a veces un
 * logo antes de la tabla. Se busca la primera fila que reconozca al menos tres
 * campos: menos que eso puede ser un título con palabras sueltas.
 */
export function findHeaderRow(
  rows: readonly (readonly string[])[],
  maxRowsToScan = 20,
): { index: number; headers: string[] } | null {
  let mejor: { index: number; headers: string[]; reconocidos: number } | null = null;

  for (let i = 0; i < Math.min(rows.length, maxRowsToScan); i += 1) {
    const fila = rows[i] ?? [];
    const noVacias = fila.filter((c) => fold(String(c ?? "")) !== "").length;
    if (noVacias < 3) continue;

    const reconocidos = matchColumns(fila.map(String)).filter((m) => m.field !== null).length;
    if (reconocidos >= 3 && (mejor === null || reconocidos > mejor.reconocidos)) {
      mejor = { index: i, headers: fila.map(String), reconocidos };
    }
  }

  return mejor === null ? null : { index: mejor.index, headers: mejor.headers };
}
