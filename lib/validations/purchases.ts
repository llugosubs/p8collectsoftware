import { z } from "zod";

/**
 * Validación de un lote de compra.
 *
 * El dinero viaja SIEMPRE como string decimal, nunca como número: un `number`
 * de JavaScript ya perdió precisión antes de salir del navegador, y que
 * Postgres guarde `numeric` exacto no rescata un valor que llegó roto.
 */

/** Hasta 10 dígitos enteros y 4 decimales: lo que cabe en `numeric(14,4)`. */
export const decimalString = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,4})?$/, "Debe ser un monto con hasta 4 decimales");

const decimalOpcional = decimalString.optional().or(z.literal("").transform(() => undefined));

export const ACQUISITION_PLATFORMS = [
  "alt",
  "goldin",
  "ebay",
  "whatnot",
  "fanatics",
  "pwcc",
  "private",
  "retail",
  "other",
] as const;

export const purchaseLineSchema = z.object({
  lineNumber: z.number().int().min(1),
  hammerPrice: decimalString,
  item: z.object({
    type: z.enum(["graded_card", "raw_card", "sealed_box", "sealed_pack", "lot", "supply"]),
    category: z.enum(["sports", "tcg", "other"]),
    sportOrGame: z.string().trim().max(60).optional(),
    playerOrCharacter: z.string().trim().max(160).optional(),
    brand: z.string().trim().max(80).optional(),
    setName: z.string().trim().max(120).optional(),
    year: z.number().int().min(1800).max(2200).optional(),
    cardNumber: z.string().trim().max(40).optional(),
    variant: z.string().trim().max(80).optional(),
    serialNumbered: z.string().trim().max(40).optional(),
    language: z.string().trim().max(20).optional(),
    gradingCompany: z.enum(["PSA", "BGS", "CGC", "SGC", "TAG", "none"]).default("none"),
    grade: z.number().min(0).max(10).optional(),
    certNumber: z.string().trim().max(40).optional(),
    rawCondition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).optional(),
    quantity: z.number().int().min(1).max(9999).default(1),
    location: z.string().trim().max(60).optional(),
    marketValue: decimalOpcional,
    listPrice: decimalOpcional,
    minPrice: decimalOpcional,
  }),
});

export const purchaseDraftSchema = z
  .object({
    idempotencyKey: z.uuid(),
    platform: z.enum(ACQUISITION_PLATFORMS),
    reference: z.string().trim().max(120).optional(),
    purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().length(3).default("USD"),

    buyerPremium: decimalOpcional,
    cardFee: decimalOpcional,
    shippingIntl: decimalOpcional,
    courierVe: decimalOpcional,
    customsVe: decimalOpcional,
    otherCosts: decimalOpcional,

    courierVeVes: decimalOpcional,
    customsVeVes: decimalOpcional,
    localFxRate: decimalOpcional,

    dueAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    paymentStatus: z.enum(["pending", "partial", "paid"]).default("pending"),
    receivedStatus: z.enum(["pending", "in_transit", "received", "partial"]).default("pending"),
    notes: z.string().trim().max(2000).optional(),

    lines: z.array(purchaseLineSchema).min(1).max(500),
  })
  .superRefine((draft, ctx) => {
    // Un cert es único en el mundo. Repetido dentro del mismo lote no lo atrapa
    // ningún índice —las dos filas son nuevas—, así que se atrapa aquí.
    const vistos = new Map<string, number>();
    draft.lines.forEach((line, index) => {
      const cert = line.item.certNumber?.trim();
      if (!cert) return;
      const clave = `${line.item.gradingCompany}:${cert.toUpperCase()}`;
      const anterior = vistos.get(clave);
      if (anterior !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "item", "certNumber"],
          message: `Ese cert está repetido: ya aparece en la carta ${anterior + 1}`,
        });
        return;
      }
      vistos.set(clave, index);
    });
  });

export type PurchaseDraft = z.infer<typeof purchaseDraftSchema>;
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;
