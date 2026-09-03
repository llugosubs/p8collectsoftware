import type { ImportField } from "@/lib/domain/import/columns";
import {
  dateCellToDateOnly,
  excelSerialToDate,
  inferDateConvention,
  parseDateText,
  type DateConvention,
} from "@/lib/domain/import/date-format";
import {
  inferDecimalConvention,
  numericCellToDecimalText,
  parseDecimalText,
  type DecimalConvention,
} from "@/lib/domain/import/number-format";
import {
  deriveCategory,
  normalizeBoolean,
  normalizeGradingCompany,
  normalizeItemType,
  normalizePlatform,
  normalizeRawCondition,
} from "@/lib/domain/import/normalize";
import type { ImportRowValues, PlannedItem } from "@/lib/domain/import/plan";

import type { Cell, SheetGrid } from "./parse";

/**
 * De la cuadrícula a filas con forma.
 *
 * Es el paso que junta las tres piezas del dominio: el mapeo de columnas dice
 * qué es cada una, la deducción de convención dice cómo leer sus números y sus
 * fechas, y la normalización lleva los valores a los enums del esquema.
 *
 * Una decisión que se toma aquí y no en `number-format.ts`: la convención se
 * deduce del ARCHIVO, no de cada columna por separado. Un Excel lo escribe una
 * sola persona con un solo teclado, así que un valor inequívoco en la columna
 * de la aduana resuelve también la del martillo. Deducir columna por columna
 * daría menos evidencia y preguntaría más veces por la misma cosa.
 */

/** Índice de la columna en la hoja → campo del sistema. */
export type ColumnMapping = ReadonlyMap<number, ImportField>;

export type ReadRowsResult = {
  rows: ImportRowValues[];
  decimalConvention: DecimalConvention;
  dateConvention: DateConvention;
  /** Muestras de lo que quedó ambiguo. Si hay algo aquí, hay que preguntar. */
  ambiguousNumbers: string[];
  ambiguousDates: string[];
};

/**
 * Columnas cuyo texto sirve como EVIDENCIA de la convención decimal.
 *
 * El grado NO está en esta lista, y su ausencia es el punto entero:
 *
 * Un grado se copia de la etiqueta del slab, y PSA la imprime a la americana:
 * "9.5". El dinero, en cambio, lo teclea el dueño desde Caracas: "1.234,56".
 * El mismo archivo puede tener las dos cosas sin contradecirse, porque vienen
 * de dos fuentes distintas.
 *
 * Si el grado contara como evidencia, un "9.5" resolvería el archivo entero
 * como gringo —con `confident: true`, así que el toggle del paso 3 ni
 * aparecería— y un martillo de "1.234" se leería como un dólar con veintitrés.
 * Comprobado: el precio se divide entre mil, en silencio.
 *
 * Y sacarlo no cuesta nada: un grado nunca tiene tres dígitos después del
 * separador, así que su forma es inequívoca y se lee igual con cualquier
 * convención.
 */
const CAMPOS_NUMERICOS: readonly ImportField[] = [
  "hammerPrice",
  "buyerPremium",
  "cardFeePct",
  "shippingIntl",
  "courierVe",
  "customsVe",
  "marketValue",
  "listPrice",
  "minPrice",
];

function celda(fila: readonly Cell[], mapping: ColumnMapping, field: ImportField): Cell | null {
  for (const [index, mapped] of mapping) {
    if (mapped === field) return fila[index] ?? null;
  }
  return null;
}

function texto(fila: readonly Cell[], mapping: ColumnMapping, field: ImportField): string | null {
  const c = celda(fila, mapping, field);
  const valor = c?.text.trim() ?? "";
  return valor === "" ? null : valor;
}

/**
 * Un monto, como texto decimal exacto.
 *
 * Si la celda trae un número, se usa ese: Excel ya resolvió el idioma al
 * guardarlo. Si trae texto ilegible, se devuelve el TEXTO CRUDO en vez de null
 * — así el error dice qué decía la celda, y un costo del lote que nadie pudo
 * leer no se convierte en cero en silencio.
 */
function monto(
  fila: readonly Cell[],
  mapping: ColumnMapping,
  field: ImportField,
  convention: DecimalConvention,
): string | null {
  const c = celda(fila, mapping, field);
  if (c === null) return null;

  if (c.numeric !== null) {
    try {
      return numericCellToDecimalText(c.numeric);
    } catch {
      return c.text;
    }
  }

  const crudo = c.text.trim();
  if (crudo === "") return null;

  try {
    return parseDecimalText(crudo, convention);
  } catch {
    return crudo;
  }
}

function entero(fila: readonly Cell[], mapping: ColumnMapping, field: ImportField): number | null {
  const c = celda(fila, mapping, field);
  if (c === null) return null;
  if (c.numeric !== null) return Math.trunc(c.numeric);

  const limpio = c.text.replace(/[^\d-]/g, "");
  if (limpio === "") return null;
  const n = Number.parseInt(limpio, 10);
  return Number.isNaN(n) ? null : n;
}

function fecha(
  fila: readonly Cell[],
  mapping: ColumnMapping,
  convention: DateConvention,
): string | null {
  const c = celda(fila, mapping, "purchasedAt");
  if (c === null) return null;

  try {
    if (c.date !== null) return dateCellToDateOnly(c.date);
    // Una columna con formato de número pero contenido de fecha: pasa cuando
    // el archivo viaja por CSV y vuelve a Excel.
    if (c.numeric !== null) return excelSerialToDate(c.numeric);
    const crudo = c.text.trim();
    if (crudo === "") return null;
    return parseDateText(crudo, convention);
  } catch {
    return null;
  }
}

function filaVacia(fila: readonly Cell[]): boolean {
  return fila.every((c) => c.text.trim() === "");
}

export function readRows(
  grid: SheetGrid,
  headerRowIndex: number,
  mapping: ColumnMapping,
  forced?: { decimal?: DecimalConvention; date?: DateConvention },
): ReadRowsResult {
  const datos = grid.rows.slice(headerRowIndex + 1).filter((f) => !filaVacia(f));

  // --- Convención de los números, del archivo entero -------------------------
  const muestrasNumericas: string[] = [];
  for (const fila of datos) {
    for (const field of CAMPOS_NUMERICOS) {
      const c = celda(fila, mapping, field);
      // Solo el texto es evidencia: un número ya resuelto no dice nada del
      // idioma con que se escribió.
      if (c !== null && c.numeric === null && c.text.trim() !== "") {
        muestrasNumericas.push(c.text);
      }
    }
  }
  const inferidaNum = inferDecimalConvention(muestrasNumericas);
  const decimalConvention = forced?.decimal ?? inferidaNum.convention ?? "es";
  const ambiguousNumbers =
    forced?.decimal || inferidaNum.confident ? [] : inferidaNum.ambiguousSamples;

  // --- Convención de las fechas ----------------------------------------------
  const muestrasFecha: string[] = [];
  for (const fila of datos) {
    const c = celda(fila, mapping, "purchasedAt");
    if (c !== null && c.date === null && c.numeric === null && c.text.trim() !== "") {
      muestrasFecha.push(c.text);
    }
  }
  const inferidaFecha = inferDateConvention(muestrasFecha);
  const dateConvention = forced?.date ?? inferidaFecha.convention ?? "dmy";
  const ambiguousDates =
    forced?.date || inferidaFecha.confident ? [] : inferidaFecha.ambiguousSamples;

  // --- Las filas --------------------------------------------------------------
  const rows: ImportRowValues[] = grid.rows
    .map((fila, index) => ({ fila, index }))
    .filter(({ index, fila }) => index > headerRowIndex && !filaVacia(fila))
    .map(({ fila, index }) => {
      const sportOrGame = texto(fila, mapping, "sportOrGame");
      const gradeTexto = monto(fila, mapping, "grade", decimalConvention);
      const grade = gradeTexto === null ? null : Number.parseFloat(gradeTexto);

      const item: PlannedItem = {
        type: normalizeItemType(texto(fila, mapping, "type")) ?? "",
        category:
          deriveCategory(sportOrGame, texto(fila, mapping, "category")) ?? "",
        sportOrGame,
        playerOrCharacter: texto(fila, mapping, "playerOrCharacter"),
        brand: texto(fila, mapping, "brand"),
        setName: texto(fila, mapping, "setName"),
        year: entero(fila, mapping, "year"),
        cardNumber: texto(fila, mapping, "cardNumber"),
        variant: texto(fila, mapping, "variant"),
        serialNumbered: texto(fila, mapping, "serialNumbered"),
        language: null,
        gradingCompany: normalizeGradingCompany(texto(fila, mapping, "gradingCompany")) ?? "",
        grade: grade !== null && Number.isFinite(grade) ? grade : null,
        certNumber: texto(fila, mapping, "certNumber"),
        rawCondition: normalizeRawCondition(texto(fila, mapping, "rawCondition")),
        quantity: entero(fila, mapping, "quantity") ?? 1,
        location: texto(fila, mapping, "location"),
        marketValue: monto(fila, mapping, "marketValue", decimalConvention),
        listPrice: monto(fila, mapping, "listPrice", decimalConvention),
        minPrice: monto(fila, mapping, "minPrice", decimalConvention),
      };

      return {
        // El número de fila del archivo, 1-based: es el que se ve en Excel
        // cuando el dueño va a corregir la celda.
        rowNumber: index + 1,
        sku: texto(fila, mapping, "sku"),
        purchasedAt: fecha(fila, mapping, dateConvention),
        platform: normalizePlatform(texto(fila, mapping, "platform")),
        reference: texto(fila, mapping, "reference"),
        received: normalizeBoolean(texto(fila, mapping, "received")),
        notes: texto(fila, mapping, "notes"),
        hammerPrice: monto(fila, mapping, "hammerPrice", decimalConvention),
        buyerPremium: monto(fila, mapping, "buyerPremium", decimalConvention),
        cardFeePct: monto(fila, mapping, "cardFeePct", decimalConvention),
        shippingIntl: monto(fila, mapping, "shippingIntl", decimalConvention),
        courierVe: monto(fila, mapping, "courierVe", decimalConvention),
        customsVe: monto(fila, mapping, "customsVe", decimalConvention),
        item,
      };
    });

  return { rows, decimalConvention, dateConvention, ambiguousNumbers, ambiguousDates };
}

/** El mapeo que sale del reconocimiento de encabezados, listo para `readRows`. */
export function mappingFromMatches(
  matches: readonly { index: number; field: ImportField | null }[],
): ColumnMapping {
  const mapping = new Map<number, ImportField>();
  for (const m of matches) {
    if (m.field !== null) mapping.set(m.index, m.field);
  }
  return mapping;
}
