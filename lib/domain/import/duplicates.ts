import { fold } from "./normalize";

/**
 * Detección de filas repetidas (§7.12, paso 3).
 *
 * Dos reglas, la del master prompt:
 *
 *  · Mismo cert ⇒ es la misma carta. Un cert es único en el mundo y la base
 *    tiene un índice único sobre (gradadora, cert) que lo respalda.
 *
 *  · Misma plataforma + referencia + número de carta + grado ⇒ probablemente
 *    la misma línea de la misma subasta cargada dos veces.
 *
 * La segunda regla es una SOSPECHA, no un hecho: un lote raw puede traer de
 * verdad dos copias del número 150. Por eso el veredicto se muestra y se puede
 * desmarcar, y por eso no existe ningún índice único que la imponga.
 *
 * Y hay un duplicado que ningún índice de la base puede atrapar: el que está
 * dentro del MISMO archivo, porque las dos filas son nuevas y el choque solo
 * aparecería a mitad de la transacción, con quince cartas ya escritas.
 */

export type MatchKind = "sku" | "cert" | "lot_position";

/** Lo que hace falta de una fila —o de un item ya guardado— para compararla. */
export type DuplicateKeys = {
  /** Solo lo trae un archivo que salió de este sistema. */
  sku?: string | null;
  gradingCompany: string | null;
  certNumber: string | null;
  platform: string | null;
  reference: string | null;
  cardNumber: string | null;
  grade: string | number | null;
};

export type ExistingItem = DuplicateKeys & {
  id: string;
  sku: string;
  /** Estado actual. Decide si esta pieza se puede actualizar desde una hoja. */
  status?: string | null;
};

export type ImportRowKeys = DuplicateKeys & { rowNumber: number };

export type DuplicateVerdict =
  | { kind: "new" }
  | { kind: "duplicate_in_file"; matchedBy: MatchKind; firstRowNumber: number }
  | {
      kind: "duplicate_in_db";
      matchedBy: MatchKind;
      itemId: string;
      sku: string;
      status?: string | null;
    };

/**
 * La clave del SKU.
 *
 * Es la única coincidencia que no es una heurística: un SKU solo puede haber
 * salido de este sistema, así que no hay nada que interpretar. Por eso gana
 * sobre el cert y sobre la posición en el lote, y por eso una fila que coincide
 * por SKU se marca para ACTUALIZAR y no para omitir — es exactamente lo que el
 * dueño quiso al bajar el inventario, editarlo en Excel y volverlo a subir.
 */
export function skuKey(keys: DuplicateKeys): string | null {
  const sku = keys.sku?.trim();
  return sku ? sku.toUpperCase() : null;
}

/**
 * La clave del cert, idéntica a la del índice único de la base.
 *
 * Si aquí se calculara distinto, el importador diría "nueva" y el insert
 * moriría con 23505 en medio de la transacción.
 */
export function certKey(keys: DuplicateKeys): string | null {
  const cert = keys.certNumber?.trim();
  if (!cert) return null;
  const company = keys.gradingCompany?.trim() || "none";
  return `${company}|${cert.toUpperCase()}`;
}

/**
 * La clave de posición dentro del lote.
 *
 * Necesita plataforma, referencia y número de carta. Sin referencia no hay
 * subasta que comparar, y sin número no hay línea: una compra `private` sin
 * referencia nunca es duplicada por esta vía, que es lo correcto.
 */
export function lotPositionKey(keys: DuplicateKeys): string | null {
  const platform = keys.platform?.trim();
  const reference = keys.reference?.trim();
  const cardNumber = keys.cardNumber?.trim();
  if (!platform || !reference || !cardNumber) return null;

  // El grado se canoniza como número: la base devuelve 10.0 y el archivo dice
  // 10. Comparados como texto serían cartas distintas.
  const crudo = keys.grade === null || keys.grade === undefined ? "" : String(keys.grade).trim();
  const numero = crudo === "" ? Number.NaN : Number(crudo);
  const grade = Number.isNaN(numero) ? crudo : String(numero);

  return [fold(platform), fold(reference), fold(cardNumber), grade].join("|");
}

/**
 * El veredicto de cada fila, en el orden en que vienen.
 *
 * La primera aparición de una carta repetida es "nueva": es la que se carga.
 * Las siguientes quedan marcadas contra ella, con su número de fila, para que
 * el dueño pueda ir a mirar la de arriba.
 *
 * La base gana sobre el archivo: si la carta ya está en el inventario, da igual
 * cuántas veces aparezca en la hoja.
 */
export function findDuplicates(
  rows: readonly ImportRowKeys[],
  existing: readonly ExistingItem[],
): Map<number, DuplicateVerdict> {
  const skuEnBase = new Map<string, ExistingItem>();
  const certEnBase = new Map<string, ExistingItem>();
  const loteEnBase = new Map<string, ExistingItem>();

  for (const item of existing) {
    const sku = skuKey(item);
    if (sku !== null && !skuEnBase.has(sku)) skuEnBase.set(sku, item);
    const cert = certKey(item);
    if (cert !== null && !certEnBase.has(cert)) certEnBase.set(cert, item);
    const lote = lotPositionKey(item);
    if (lote !== null && !loteEnBase.has(lote)) loteEnBase.set(lote, item);
  }

  const skuEnArchivo = new Map<string, number>();
  const certEnArchivo = new Map<string, number>();
  const loteEnArchivo = new Map<string, number>();
  const veredictos = new Map<number, DuplicateVerdict>();

  for (const row of rows) {
    const sku = skuKey(row);
    const cert = certKey(row);
    const lote = lotPositionKey(row);

    // El SKU manda: es identidad, no parecido.
    const enBase =
      (sku !== null ? skuEnBase.get(sku) : undefined) ??
      (cert !== null ? certEnBase.get(cert) : undefined) ??
      (lote !== null ? loteEnBase.get(lote) : undefined);

    if (enBase !== undefined) {
      const matchedBy: MatchKind =
        sku !== null && skuEnBase.has(sku)
          ? "sku"
          : cert !== null && certEnBase.has(cert)
            ? "cert"
            : "lot_position";
      veredictos.set(row.rowNumber, {
        kind: "duplicate_in_db",
        matchedBy,
        itemId: enBase.id,
        sku: enBase.sku,
        status: enBase.status ?? null,
      });
      continue;
    }

    const antesSku = sku !== null ? skuEnArchivo.get(sku) : undefined;
    if (antesSku !== undefined) {
      veredictos.set(row.rowNumber, {
        kind: "duplicate_in_file",
        matchedBy: "sku",
        firstRowNumber: antesSku,
      });
      continue;
    }

    const antesCert = cert !== null ? certEnArchivo.get(cert) : undefined;
    if (antesCert !== undefined) {
      veredictos.set(row.rowNumber, {
        kind: "duplicate_in_file",
        matchedBy: "cert",
        firstRowNumber: antesCert,
      });
      continue;
    }

    const antesLote = lote !== null ? loteEnArchivo.get(lote) : undefined;
    if (antesLote !== undefined) {
      veredictos.set(row.rowNumber, {
        kind: "duplicate_in_file",
        matchedBy: "lot_position",
        firstRowNumber: antesLote,
      });
      continue;
    }

    if (sku !== null) skuEnArchivo.set(sku, row.rowNumber);
    if (cert !== null) certEnArchivo.set(cert, row.rowNumber);
    if (lote !== null) loteEnArchivo.set(lote, row.rowNumber);
    veredictos.set(row.rowNumber, { kind: "new" });
  }

  return veredictos;
}

/**
 * Las claves que hay que ir a buscar a la base antes de validar.
 *
 * Se consulta por estas dos listas y no item por item: un archivo de doscientas
 * filas serían doscientas consultas, y el paso de validación tardaría más que
 * cargar las cartas a mano.
 */
export function lookupKeys(rows: readonly ImportRowKeys[]): {
  skus: string[];
  certNumbers: string[];
  references: string[];
} {
  const skus = new Set<string>();
  const certs = new Set<string>();
  const referencias = new Set<string>();

  for (const row of rows) {
    const sku = row.sku?.trim();
    if (sku) skus.add(sku);
    const cert = row.certNumber?.trim();
    if (cert) certs.add(cert);
    const referencia = row.reference?.trim();
    if (referencia) referencias.add(referencia);
  }

  return { skus: [...skus], certNumbers: [...certs], references: [...referencias] };
}
