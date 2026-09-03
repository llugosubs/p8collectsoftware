/**
 * De lo que se leyó en una foto a una hoja con las columnas de la plantilla.
 *
 * El camino de la foto no tiene un pipeline propio: se materializa una hoja y
 * de ahí en adelante es un archivo como cualquier otro. Eso hace que comparta
 * el 100% de lo que hay debajo —normalización, deducción de convención,
 * validación, previsualización, transacción y reversión— en vez de abrir un
 * segundo camino donde el prorrateo pueda quedar mal.
 *
 * Y tiene un efecto secundario que vale por sí solo: el dueño puede DESCARGAR
 * la hoja que se armó con sus fotos y ver exactamente qué se leyó, celda por
 * celda, antes o después de confirmar.
 */

/** Lo que el modelo devolvió de una carta. Todo texto, todo puede faltar. */
export type CartaLeida = {
  playerOrCharacter: string | null;
  sportOrGame: string | null;
  brand: string | null;
  setName: string | null;
  year: string | null;
  cardNumber: string | null;
  variant: string | null;
  serialNumbered: string | null;
  gradingCompany: string;
  grade: string | null;
  certNumber: string | null;
  rawCondition: string;
  hammerPrice: string | null;
  notes: string | null;
};

/**
 * La cabecera del lote: lo que el modelo NO puede saber mirando una carta.
 *
 * Ninguna foto dice en qué plataforma se compró, con qué referencia, ni cuánto
 * costó el envío. Eso lo escribe el dueño una vez, y por eso el esquema de
 * extracción ni siquiera declara esos campos.
 */
export type CabeceraLote = {
  platform: string;
  purchasedAt: string;
  reference?: string;
  received: boolean;
  buyerPremium?: string;
  cardFeePct?: string;
  shippingIntl?: string;
  courierVe?: string;
  customsVe?: string;
};

export const PHOTO_SHEET_HEADERS = [
  "fecha_compra",
  "plataforma",
  "referencia_subasta",
  "tipo",
  "deporte_o_juego",
  "jugador_o_personaje",
  "marca",
  "set",
  "año",
  "numero",
  "variante",
  "serial",
  "gradadora",
  "grado",
  "cert",
  "condicion_raw",
  "hammer_usd",
  "premium_usd",
  "fee_tarjeta_pct",
  "envio_usd",
  "courier_ve_usd",
  "aduana_usd",
  "recibido",
  "notas",
] as const;

/** La gradadora, tal como la escribiría el dueño en su Excel. */
function gradadora(valor: string): string {
  if (valor === "ninguna") return "";
  // "ilegible" se escribe TAL CUAL a propósito: no lo reconoce el
  // normalizador, así que la fila se para en la validación y el dueño mira la
  // foto. Escribir "" la haría pasar como carta sin gradar —con su grado
  // puesto— y un slab PSA 10 entraría al inventario como carta suelta.
  return valor;
}

function tipoDe(valor: string): string {
  return valor === "ninguna" ? "carta raw" : "carta graduada";
}

/**
 * Arma la hoja.
 *
 * Qué va en cada fila y qué solo en la primera no es un detalle de formato:
 *
 *  · Plataforma, fecha, referencia y "recibido" van en TODAS. El agrupamiento
 *    en lotes se hace por (plataforma, referencia, fecha) fila por fila, así
 *    que dejarlas en blanco partiría el lote en pedazos. Y "recibido" solo
 *    cuenta como recibido si TODAS las filas lo dicen: escribirlo únicamente
 *    arriba dejaría el lote entero en tránsito.
 *
 *  · Los costos comunes van SOLO en la primera, que es la convención de la
 *    plantilla y lo que el planificador espera. Repetirlos haría que el aviso
 *    de "dos filas se contradicen" nunca sirviera de nada.
 */
export function buildPhotoSheet(
  cards: readonly CartaLeida[],
  lote: CabeceraLote,
): string[][] {
  const recibido = lote.received ? "sí" : "no";

  return cards.map((carta, index) => {
    const primera = index === 0;
    return [
      lote.purchasedAt,
      lote.platform,
      lote.reference ?? "",
      tipoDe(carta.gradingCompany),
      carta.sportOrGame ?? "",
      carta.playerOrCharacter ?? "",
      carta.brand ?? "",
      carta.setName ?? "",
      carta.year ?? "",
      carta.cardNumber ?? "",
      carta.variant ?? "",
      carta.serialNumbered ?? "",
      gradadora(carta.gradingCompany),
      carta.grade ?? "",
      carta.certNumber ?? "",
      carta.rawCondition === "desconocida" ? "" : carta.rawCondition,
      carta.hammerPrice ?? "",
      primera ? (lote.buyerPremium ?? "") : "",
      primera ? (lote.cardFeePct ?? "") : "",
      primera ? (lote.shippingIntl ?? "") : "",
      primera ? (lote.courierVe ?? "") : "",
      primera ? (lote.customsVe ?? "") : "",
      recibido,
      carta.notes ?? "",
    ];
  });
}
