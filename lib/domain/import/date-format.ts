/**
 * Interpretación de fechas escritas como texto.
 *
 * El mismo peligro que los números, con otra cara: `08/09/2026` es 8 de
 * septiembre en Venezuela y 9 de agosto en Estados Unidos. Una fecha de compra
 * movida un mes descuadra el corte contable y el aging del inventario, y nadie
 * lo nota porque la fecha SÍ existe — no revienta nada.
 *
 * La regla es la misma que en number-format.ts y por el mismo motivo: no se
 * adivina por celda, se deduce mirando la COLUMNA COMPLETA. Basta con que un
 * solo valor tenga un primer número mayor que doce para saber que el archivo
 * escribe día primero. Si toda la columna es ambigua, se pregunta.
 */

export type DateConvention = "dmy" | "mdy";

export type DateConventionInference =
  | { convention: DateConvention; confident: true; evidence: string }
  | { convention: null; confident: false; ambiguousSamples: string[] };

export class DateFormatError extends Error {
  constructor(
    public readonly code: "NOT_A_DATE" | "OUT_OF_RANGE",
    public readonly raw: string,
  ) {
    super(`${code}: ${raw}`);
    this.name = "DateFormatError";
  }
}

/** Fechas plausibles para una compra de cartas. Fuera de aquí, es un error. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

type Piezas = { a: number; b: number; year: number };

/** `2026-08-14`: el ISO no tiene ambigüedad posible y se resuelve aparte. */
function comoIso(texto: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto);
  if (!m) return null;
  const [, y, mo, d] = m;
  return armar(Number(y), Number(mo), Number(d), texto);
}

/** Las dos primeras cifras sin decidir todavía cuál es el día. */
function separar(texto: string): Piezas | null {
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(texto);
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);

  // Un año de dos cifras: 26 es 2026, no 1926. Nadie compra cartas con fecha
  // de hace un siglo en un Excel semanal.
  if (year < 100) year += year < 70 ? 2000 : 1900;

  return { a, b, year };
}

function armar(year: number, month: number, day: number, raw: string): string {
  if (year < MIN_YEAR || year > MAX_YEAR) throw new DateFormatError("OUT_OF_RANGE", raw);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new DateFormatError("NOT_A_DATE", raw);
  }

  // Que el 31 de febrero no pase de largo.
  const fecha = new Date(Date.UTC(year, month - 1, day));
  if (fecha.getUTCFullYear() !== year || fecha.getUTCMonth() !== month - 1) {
    throw new DateFormatError("NOT_A_DATE", raw);
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Deduce si la columna escribe día primero o mes primero.
 *
 * Un primer número mayor que doce solo puede ser un día; un segundo número
 * mayor que doce solo puede serlo si el mes va primero. Una sola celda así
 * resuelve la columna entera.
 */
export function inferDateConvention(valores: readonly string[]): DateConventionInference {
  const ambiguos: string[] = [];

  for (const valor of valores) {
    const texto = valor.trim();
    if (texto === "") continue;

    // El ISO no aporta evidencia sobre las demás: se lee solo y ya.
    if (comoIso(texto) !== null) continue;

    const piezas = separar(texto);
    if (piezas === null) continue;

    if (piezas.a > 12 && piezas.b <= 12) {
      return { convention: "dmy", confident: true, evidence: valor };
    }
    if (piezas.b > 12 && piezas.a <= 12) {
      return { convention: "mdy", confident: true, evidence: valor };
    }

    ambiguos.push(valor);
  }

  if (ambiguos.length === 0) {
    // O no hay fechas ambiguas, o todas venían en ISO. Cualquier convención da
    // el mismo resultado.
    return { convention: "dmy", confident: true, evidence: "sin ambigüedad" };
  }

  return { convention: null, confident: false, ambiguousSamples: ambiguos.slice(0, 5) };
}

/** Convierte a `YYYY-MM-DD`, que es lo que espera una columna `date`. */
export function parseDateText(raw: string, convention: DateConvention): string {
  const texto = raw.trim();
  if (texto === "") throw new DateFormatError("NOT_A_DATE", raw);

  const iso = comoIso(texto);
  if (iso !== null) return iso;

  const piezas = separar(texto);
  if (piezas === null) throw new DateFormatError("NOT_A_DATE", raw);

  // Lo inequívoco manda sobre la convención: si el primer número es 25, es un
  // día aunque la columna se haya deducido como mes primero.
  const diaPrimero = piezas.a > 12 ? true : piezas.b > 12 ? false : convention === "dmy";

  const day = diaPrimero ? piezas.a : piezas.b;
  const month = diaPrimero ? piezas.b : piezas.a;

  return armar(piezas.year, month, day, raw);
}

/**
 * El número que Excel guarda cuando una celda tiene formato de fecha.
 *
 * Cuenta días desde el 30 de diciembre de 1899 — no desde el 1 de enero de
 * 1900, porque Excel cree que 1900 fue bisiesto y ese error de 1985 sigue en
 * el formato por compatibilidad. Los seriales por debajo de 61 caen en la zona
 * donde ese error importa; también son enero de 1900, así que no son la fecha
 * de compra de una carta y se rechazan.
 */
export function excelSerialToDate(serial: number): string {
  if (!Number.isFinite(serial) || serial < 61) {
    throw new DateFormatError("OUT_OF_RANGE", String(serial));
  }

  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const fecha = new Date(ms);

  return armar(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth() + 1,
    fecha.getUTCDate(),
    String(serial),
  );
}

/**
 * La fecha que ya vino resuelta como `Date` (SheetJS con `cellDates`).
 *
 * Se leen los componentes en UTC a propósito. SheetJS construye la fecha en el
 * huso local, y en Caracas convertirla con `toISOString()` la correría un día
 * hacia atrás — el mismo error de zona horaria que ya apareció en la ficha de
 * inventario.
 */
export function dateCellToDateOnly(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new DateFormatError("NOT_A_DATE", "Invalid Date");
  return armar(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
    value.toISOString(),
  );
}
