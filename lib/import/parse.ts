import * as XLSX from "xlsx";

/**
 * La frontera con el archivo.
 *
 * Aquí termina lo impredecible —bytes que subió alguien— y empieza el dominio,
 * que solo ve celdas con forma conocida. Todo lo que decide dinero vive en
 * `lib/domain/import`; este módulo no interpreta nada, solo entrega la
 * cuadrícula.
 *
 * SheetJS se instala desde el CDN oficial (ver CLAUDE.md): la versión de npm
 * está congelada en 0.18.5 con dos vulnerabilidades altas sin parche.
 */

/** Una celda tal como venía: el texto que se ve y, si lo hay, el valor crudo. */
export type Cell = {
  /** Lo que se lee en la hoja. Siempre presente, aunque sea vacío. */
  text: string;
  /** El número que Excel guardó, si la celda era numérica. */
  numeric: number | null;
  /** La fecha que Excel guardó, si la celda tenía formato de fecha. */
  date: Date | null;
};

export type SheetGrid = {
  sheetName: string;
  rows: Cell[][];
  /** Si el archivo era más grande que el tope y se recortó. */
  truncated: boolean;
};

export class SheetReadError extends Error {
  constructor(
    public readonly code: "UNREADABLE" | "NO_SHEETS" | "SHEET_NOT_FOUND" | "EMPTY",
    message: string,
  ) {
    super(message);
    this.name = "SheetReadError";
  }
}

/**
 * Topes. Un archivo con un millón de filas vacías es tan fácil de producir
 * como de subir, y sin un límite el servidor se queda armando la cuadrícula
 * hasta quedarse sin memoria.
 */
export const MAX_ROWS = 5_000;
export const MAX_COLUMNS = 200;

const OPCIONES_LECTURA: XLSX.ParsingOptions = {
  type: "array",
  cellDates: true,
  // No se evalúan ni se guardan fórmulas: el archivo viene de fuera y lo único
  // que interesa es lo que la hoja MUESTRA.
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  sheetStubs: false,
};

/** Los nombres de las hojas, para que el dueño elija cuál importar. */
export function listSheets(data: ArrayBuffer): string[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(data), OPCIONES_LECTURA);
  } catch (error) {
    throw new SheetReadError(
      "UNREADABLE",
      `No se pudo abrir el archivo: ${error instanceof Error ? error.message : "formato desconocido"}`,
    );
  }

  if (workbook.SheetNames.length === 0) {
    throw new SheetReadError("NO_SHEETS", "El archivo no tiene ninguna hoja.");
  }
  return [...workbook.SheetNames];
}

function aCelda(value: unknown): Cell {
  if (value === null || value === undefined) return { text: "", numeric: null, date: null };

  if (value instanceof Date) {
    return { text: value.toISOString().slice(0, 10), numeric: null, date: value };
  }

  if (typeof value === "number") {
    // El texto de un número se deja para el dominio: aquí no se decide si
    // 1.234 son mil doscientos treinta y cuatro. `numeric` es la vía sin
    // ambigüedad y es la que se usa cuando existe.
    return { text: String(value), numeric: value, date: null };
  }

  if (typeof value === "boolean") {
    return { text: value ? "sí" : "no", numeric: null, date: null };
  }

  return { text: String(value).trim(), numeric: null, date: null };
}

/** La cuadrícula de una hoja: filas de celdas, sin interpretar nada. */
export function readSheet(data: ArrayBuffer, sheetName?: string): SheetGrid {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(data), OPCIONES_LECTURA);
  } catch (error) {
    throw new SheetReadError(
      "UNREADABLE",
      `No se pudo abrir el archivo: ${error instanceof Error ? error.message : "formato desconocido"}`,
    );
  }

  const nombre = sheetName ?? workbook.SheetNames[0];
  if (nombre === undefined) {
    throw new SheetReadError("NO_SHEETS", "El archivo no tiene ninguna hoja.");
  }

  const hoja = workbook.Sheets[nombre];
  if (hoja === undefined) {
    throw new SheetReadError("SHEET_NOT_FOUND", `El archivo no tiene una hoja "${nombre}".`);
  }

  const crudas = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const truncated = crudas.length > MAX_ROWS;
  const recortadas = truncated ? crudas.slice(0, MAX_ROWS) : crudas;

  // Las filas vienen con longitudes distintas: SheetJS omite las celdas vacías
  // del final. Sin igualarlas, la columna 12 de una fila no es la misma que la
  // columna 12 de la de abajo.
  const ancho = Math.min(
    MAX_COLUMNS,
    recortadas.reduce((max, fila) => Math.max(max, fila.length), 0),
  );

  const rows = recortadas.map((fila) =>
    Array.from({ length: ancho }, (_, i) => aCelda(fila[i])),
  );

  if (rows.length === 0) {
    throw new SheetReadError("EMPTY", `La hoja "${nombre}" está vacía.`);
  }

  return { sheetName: nombre, rows, truncated };
}

/**
 * Lo mismo para un CSV o un pegado del portapapeles.
 *
 * Va por SheetJS también, y no por un `split(",")` propio: un CSV de verdad
 * trae celdas entrecomilladas con comas y saltos de línea adentro.
 */
export function readDelimitedText(text: string): SheetGrid {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return readSheet(buffer as ArrayBuffer);
}

/** Solo el texto, que es lo que necesitan la detección de encabezados y el mapeo. */
export function textRows(grid: SheetGrid): string[][] {
  return grid.rows.map((fila) => fila.map((c) => c.text));
}
