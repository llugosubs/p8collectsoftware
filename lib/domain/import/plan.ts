import type Decimal from "decimal.js";

import { allocateAcquisitionCost, type AllocationLine } from "../allocation";
import { toDbNumeric, ZERO } from "../money";
import { suggestCardFee } from "../purchases";
import type { DuplicateVerdict } from "./duplicates";

/**
 * De filas sueltas a lotes de compra (§7.12, paso 3).
 *
 * Un archivo semanal no es una lista de cartas: son varias subastas mezcladas.
 * Las filas que comparten plataforma, referencia y fecha son un lote, y los
 * costos comunes de ese lote —comisión, fee de tarjeta, envío, courier,
 * aduana— vienen escritos una sola vez, en su primera fila.
 *
 * Todo lo que decide dinero pasa por aquí y por `allocation.ts`. Este módulo
 * no habla con la base ni con el archivo: recibe filas ya leídas y devuelve un
 * plan que se puede mirar antes de confirmar.
 */

export type PlannedItem = {
  type: string;
  category: string;
  sportOrGame: string | null;
  playerOrCharacter: string | null;
  brand: string | null;
  setName: string | null;
  year: number | null;
  cardNumber: string | null;
  variant: string | null;
  serialNumbered: string | null;
  language: string | null;
  gradingCompany: string;
  grade: number | null;
  certNumber: string | null;
  rawCondition: string | null;
  quantity: number;
  location: string | null;
  marketValue: string | null;
  listPrice: string | null;
  minPrice: string | null;
};

export type ImportRowValues = {
  rowNumber: number;
  /** Solo lo trae un archivo que salió de este sistema. */
  sku: string | null;
  purchasedAt: string | null;
  platform: string | null;
  reference: string | null;
  received: boolean | null;
  notes: string | null;

  hammerPrice: string | null;
  buyerPremium: string | null;
  cardFeePct: string | null;
  shippingIntl: string | null;
  courierVe: string | null;
  customsVe: string | null;

  item: PlannedItem;
};

export type RowState =
  | "new"
  | "duplicate_in_file"
  | "duplicate_in_db"
  | "update_existing"
  | "error";

export type PlannedRow = {
  rowNumber: number;
  state: RowState;
  /** Qué le pasa a la fila, en la lengua del dueño. Vacío si está bien. */
  errors: string[];
  groupKey: string | null;
  duplicateOfItemId: string | null;
};

export type PlannedLine = {
  rowNumber: number;
  lineNumber: number;
  hammerPrice: string;
  allocatedCost: string;
  item: PlannedItem;
};

export type PlannedGroup = {
  groupKey: string;
  platform: string;
  reference: string | null;
  purchasedAt: string;
  received: boolean;
  hammerTotal: string;
  buyerPremium: string;
  cardFee: string;
  cardFeePct: string | null;
  shippingIntl: string;
  courierVe: string;
  customsVe: string;
  otherCosts: string;
  /** hammer + comunes: lo que tiene que valer `acquisitions.total_cost`. */
  totalCost: string;
  lines: PlannedLine[];
};

export type ImportPlan = {
  groups: PlannedGroup[];
  rows: PlannedRow[];
  totals: {
    rowsTotal: number;
    rowsToCreate: number;
    rowsToUpdate: number;
    rowsSkipped: number;
    rowsWithError: number;
    grandTotal: string;
  };
  /** Cosas raras que no bloquean pero que hay que decir en voz alta. */
  warnings: string[];
};

/**
 * Estados sobre los que una hoja de cálculo puede escribir.
 *
 * Fuera de estos, la pieza ya salió del inventario —vendida, reservada,
 * consumida en un break, perdida— y la hoja es lo que está viejo, no la carta.
 * La base también lo impide, pero allá el error aborta el archivo entero: aquí
 * la fila se marca antes de confirmar y el resto se importa igual.
 */
const ESTADOS_ACTUALIZABLES = new Set(["incoming", "in_stock", "listed"]);

const GRADED_COMPANIES = new Set(["PSA", "BGS", "CGC", "SGC", "TAG"]);
const BULK_TYPES = new Set(["sealed_box", "sealed_pack", "supply", "lot"]);

type CostoComun = "buyerPremium" | "cardFeePct" | "shippingIntl" | "courierVe" | "customsVe";

const COSTOS_COMUNES: readonly CostoComun[] = [
  "buyerPremium",
  "cardFeePct",
  "shippingIntl",
  "courierVe",
  "customsVe",
];

const NOMBRE_COSTO: Readonly<Record<CostoComun, string>> = {
  buyerPremium: "la comisión de la casa",
  cardFeePct: "el fee de tarjeta",
  shippingIntl: "el envío",
  courierVe: "el courier",
  customsVe: "la aduana",
};

/**
 * Los montos de la pieza: valor de mercado y precios.
 *
 * No se reparten ni se suman, y por eso se escapaban de toda comprobación. Una
 * celda que diga "aprox 1.200" llega intacta al `::numeric` de la transacción y
 * la aborta ENTERA, con un error de Postgres en inglés en vez de "la fila 74
 * tiene un valor de mercado que no es un monto".
 */
function montosEditables(item: PlannedItem): string[] {
  const errores: string[] = [];
  const campos: readonly [keyof PlannedItem, string][] = [
    ["marketValue", "El valor de mercado"],
    ["listPrice", "El precio de lista"],
    ["minPrice", "El precio mínimo"],
  ];

  for (const [campo, nombre] of campos) {
    const valor = item[campo];
    if (typeof valor === "string" && valor !== "" && !DECIMAL_TEXTO.test(valor)) {
      errores.push(`${nombre} "${valor}" no es un monto.`);
    }
  }

  return errores;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Lo que cabe en `numeric(14,4)`. Un monto fuera de aquí no llega a la base. */
const DECIMAL_TEXTO = /^\d{1,10}(\.\d{1,4})?$/;

/**
 * Los errores que impiden cargar una fila.
 *
 * Se comprueban aquí y no en la base a propósito: una restricción que salta
 * dentro de la transacción aborta el archivo entero y llega como un mensaje de
 * Postgres. Aquí llega como "falta el grado" en la fila 12, corregible sin
 * volver a subir nada.
 */
export function validateRow(row: ImportRowValues): string[] {
  const errores: string[] = [];
  const item = row.item;

  // Una fila CON SKU es una corrección sobre una pieza existente, no una
  // compra. No se le exige nada de lo que exige una fila nueva —ni plataforma,
  // ni fecha, ni martillo— porque nada de eso se vuelve a escribir.
  if (row.sku !== null && row.sku.trim() !== "") {
    errores.push(...montosEditables(item));
    return errores;
  }

  // El nombre: de una carta es el jugador o el personaje; de una caja sellada,
  // el set. Exigir siempre "jugador" rechazaría cajas perfectamente válidas.
  if (!item.playerOrCharacter && !item.setName) {
    errores.push("Falta el nombre: pon el jugador, el personaje o el set.");
  }

  if (!row.platform) errores.push("Falta la plataforma o no se reconoce.");
  if (!row.purchasedAt) errores.push("Falta la fecha de compra o no se entiende.");
  if (!item.type) errores.push("Falta el tipo de pieza o no se reconoce.");
  if (!item.category) {
    errores.push("No se pudo deducir la categoría: elige deportes, TCG u otro.");
  }
  if (row.hammerPrice === null) {
    errores.push("El precio de martillo no es un número.");
  } else if (!DECIMAL_TEXTO.test(row.hammerPrice)) {
    errores.push(`El martillo "${row.hammerPrice}" no cabe en un monto de hasta 4 decimales.`);
  }

  errores.push(...montosEditables(item));

  // Los costos comunes viajan en la fila que los trae. Si uno llegó ilegible,
  // el error es de ESTA fila: dejarlo pasar como cero perdería plata del lote
  // en silencio, y el costo de cada carta saldría más bajo de lo que fue.
  for (const campo of COSTOS_COMUNES) {
    const valor = row[campo];
    if (valor === null || valor === undefined || valor === "") continue;
    if (!DECIMAL_TEXTO.test(valor)) {
      errores.push(`${mayuscula(NOMBRE_COSTO[campo])} dice "${valor}", que no es un monto.`);
    }
  }

  if (item.grade !== null && (item.grade < 0 || item.grade > 10)) {
    errores.push(`El grado ${item.grade} está fuera de 0 a 10.`);
  }

  // Una gradadora que no se reconoce llega aquí como cadena vacía, y eso solo
  // puede significar una cosa: la celda TRAÍA texto y no lo entendimos —una
  // celda vacía se normaliza a "none", no a "".
  //
  // Sin esta comprobación, un "PSAA" mal tecleado entra a la base como carta
  // SIN GRADAR con grado 10: un slab PSA 10 archivado como carta suelta, que
  // nadie descubre hasta que va a venderlo.
  if (item.gradingCompany === "") {
    errores.push("No se reconoce la gradadora. Usa PSA, BGS, CGC, SGC, TAG o déjala vacía.");
  }

  // La base lo exige (items_graded_needs_grade) y sin esto reventaría dentro
  // de la transacción, con las filas anteriores ya escritas.
  if (GRADED_COMPANIES.has(item.gradingCompany) && item.grade === null) {
    errores.push(`Dice ${item.gradingCompany} pero no trae grado.`);
  }

  if (item.quantity > 1 && !BULK_TYPES.has(item.type)) {
    errores.push("Solo los sellados, lotes e insumos pueden traer más de una unidad.");
  }
  if (!Number.isInteger(item.quantity) || item.quantity < 1) {
    errores.push("La cantidad tiene que ser un entero de al menos 1.");
  }

  return errores;
}

/** Filas del mismo lote: misma plataforma, misma referencia, misma fecha. */
export function groupKeyOf(row: ImportRowValues): string | null {
  if (!row.platform || !row.purchasedAt) return null;
  return `${row.platform}|${row.reference?.trim() ?? ""}|${row.purchasedAt}`;
}

/**
 * Arma el plan completo del archivo.
 *
 * Las filas duplicadas y las que tienen error quedan FUERA del lote por
 * completo: su martillo no cuenta para el total y el envío se reparte solo
 * entre las que sí entraron. Contarlas inflaría el total del lote y repartiría
 * costos entre cartas que nunca se van a crear.
 */
export function buildImportPlan(input: {
  rows: readonly ImportRowValues[];
  duplicates: ReadonlyMap<number, DuplicateVerdict>;
  /** Filas que el dueño desmarcó a mano, aunque el sistema no las vea repetidas. */
  excludedRowNumbers?: readonly number[];
  /** Duplicadas que el dueño eligió actualizar en vez de omitir. */
  updateRowNumbers?: readonly number[];
}): ImportPlan {
  const excluidas = new Set(input.excludedRowNumbers ?? []);
  const aActualizar = new Set(input.updateRowNumbers ?? []);
  const warnings: string[] = [];

  const planeadas: PlannedRow[] = [];
  const porGrupo = new Map<string, ImportRowValues[]>();

  for (const row of input.rows) {
    const errores = validateRow(row);
    const veredicto = input.duplicates.get(row.rowNumber) ?? { kind: "new" as const };
    const groupKey = groupKeyOf(row);

    const duplicateOfItemId =
      veredicto.kind === "duplicate_in_db" ? veredicto.itemId : null;

    if (errores.length > 0) {
      planeadas.push({
        rowNumber: row.rowNumber,
        state: "error",
        errors: errores,
        groupKey,
        duplicateOfItemId,
      });
      continue;
    }

    if (veredicto.kind !== "new") {
      // Actualizar solo tiene sentido contra una pieza que existe de verdad.
      // Coincidir por SKU no es parecerse: es ser la misma pieza. Una fila así
      // salió de nuestra propia exportación, y el dueño la bajó justamente
      // para editarla — así que ACTUALIZAR es lo que pidió, no algo que haya
      // que ir marcando doscientas veces. Las otras dos coincidencias son
      // heurísticas y siguen empezando en "omitir".
      const porSku =
        veredicto.kind === "duplicate_in_db" && veredicto.matchedBy === "sku";

      const quiereActualizar =
        veredicto.kind === "duplicate_in_db" &&
        (aActualizar.has(row.rowNumber) || (porSku && !excluidas.has(row.rowNumber)));

      if (
        quiereActualizar &&
        veredicto.kind === "duplicate_in_db" &&
        veredicto.status != null &&
        !ESTADOS_ACTUALIZABLES.has(veredicto.status)
      ) {
        planeadas.push({
          rowNumber: row.rowNumber,
          state: "error",
          errors: [
            `${veredicto.sku} ya no está en el inventario (${veredicto.status}). ` +
              "El archivo viene desactualizado: quita esta fila o corrige la pieza a mano.",
          ],
          groupKey,
          duplicateOfItemId,
        });
        continue;
      }

      planeadas.push({
        rowNumber: row.rowNumber,
        state: quiereActualizar ? "update_existing" : veredicto.kind,
        errors: [],
        groupKey,
        duplicateOfItemId,
      });
      continue;
    }

    if (excluidas.has(row.rowNumber)) {
      planeadas.push({
        rowNumber: row.rowNumber,
        state: "duplicate_in_file",
        errors: [],
        groupKey,
        duplicateOfItemId,
      });
      continue;
    }

    planeadas.push({
      rowNumber: row.rowNumber,
      state: "new",
      errors: [],
      groupKey,
      duplicateOfItemId,
    });

    const clave = groupKey!;
    const lista = porGrupo.get(clave);
    if (lista === undefined) porGrupo.set(clave, [row]);
    else lista.push(row);
  }

  const groups: PlannedGroup[] = [];
  let grandTotal: Decimal = ZERO;

  for (const [groupKey, filas] of porGrupo) {
    const primera = filas[0]!;

    // Los costos comunes se escriben una vez, en la primera fila del lote. Se
    // toma el primer valor que aparezca; si otra fila del mismo lote trae uno
    // distinto, se avisa en vez de quedarse callado con el que llegó primero.
    const comunes: Record<CostoComun, string | null> = {
      buyerPremium: null,
      cardFeePct: null,
      shippingIntl: null,
      courierVe: null,
      customsVe: null,
    };

    for (const campo of COSTOS_COMUNES) {
      for (const fila of filas) {
        const valor = fila[campo];
        if (valor === null || valor === undefined || valor === "") continue;
        if (comunes[campo] === null) {
          comunes[campo] = valor;
        } else if (comunes[campo] !== valor) {
          warnings.push(
            `En el lote ${groupKey}, la fila ${fila.rowNumber} trae ${NOMBRE_COSTO[campo]} ` +
              `en ${valor} y antes decía ${comunes[campo]}. Se usó el primero.`,
          );
        }
      }
    }

    const lineas: AllocationLine[] = filas.map((fila, index) => ({
      id: String(fila.rowNumber),
      lineNumber: index + 1,
      hammerPrice: fila.hammerPrice!,
    }));

    const hammerTotal = lineas.reduce<Decimal>(
      (acc, l) => acc.plus(l.hammerPrice as string),
      ZERO,
    );

    // El fee de tarjeta viene como PORCENTAJE en la plantilla, no como monto.
    const buyerPremium = toDbNumeric(comunes.buyerPremium ?? "0");
    const cardFee =
      comunes.cardFeePct === null
        ? "0"
        : toDbNumeric(
            suggestCardFee({ hammerTotal, buyerPremium, percent: comunes.cardFeePct }),
          );

    const costos = {
      buyerPremium,
      cardFee,
      shippingIntl: toDbNumeric(comunes.shippingIntl ?? "0"),
      courierVe: toDbNumeric(comunes.courierVe ?? "0"),
      customsVe: toDbNumeric(comunes.customsVe ?? "0"),
      otherCosts: toDbNumeric("0"),
    };

    const allocation = allocateAcquisitionCost(lineas, costos);
    const porLinea = new Map(allocation.lines.map((l) => [l.lineNumber, l]));

    grandTotal = grandTotal.plus(allocation.grandTotal);

    groups.push({
      groupKey,
      platform: primera.platform!,
      reference: primera.reference?.trim() || null,
      purchasedAt: primera.purchasedAt!,
      // Un lote llegó si TODAS sus filas dicen que llegó. Con una sola pendiente
      // el lote está incompleto, y darlo por recibido pondría en el inventario
      // disponible una carta que sigue en Estados Unidos.
      received: filas.every((f) => f.received === true),
      hammerTotal: toDbNumeric(allocation.hammerTotal),
      buyerPremium: costos.buyerPremium,
      cardFee: costos.cardFee,
      cardFeePct: comunes.cardFeePct,
      shippingIntl: costos.shippingIntl,
      courierVe: costos.courierVe,
      customsVe: costos.customsVe,
      otherCosts: costos.otherCosts,
      totalCost: toDbNumeric(allocation.grandTotal),
      lines: filas.map((fila, index) => {
        const alloc = porLinea.get(index + 1)!;
        return {
          rowNumber: fila.rowNumber,
          lineNumber: index + 1,
          hammerPrice: toDbNumeric(alloc.hammerPrice),
          allocatedCost: toDbNumeric(alloc.allocatedCost),
          item: fila.item,
        };
      }),
    });
  }

  const cuenta = (estado: RowState) => planeadas.filter((r) => r.state === estado).length;

  return {
    groups,
    rows: planeadas,
    totals: {
      rowsTotal: planeadas.length,
      rowsToCreate: cuenta("new"),
      rowsToUpdate: cuenta("update_existing"),
      rowsSkipped: cuenta("duplicate_in_file") + cuenta("duplicate_in_db"),
      rowsWithError: cuenta("error"),
      grandTotal: toDbNumeric(grandTotal),
    },
    warnings,
  };
}
