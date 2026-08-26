"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { createAcquisition, findCertConflicts } from "@/app/(admin)/admin/purchases/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allocateAcquisitionCost, sharedCostsTotal } from "@/lib/domain/allocation";
import { formatMoney, toDbNumeric } from "@/lib/domain/money";
import { suggestCardFee } from "@/lib/domain/purchases";
import { ACQUISITION_PLATFORMS } from "@/lib/validations/purchases";
import { cn } from "@/lib/utils";

/**
 * Wizard de compra.
 *
 * Es un BORRADOR LOCAL: no toca la base hasta el último paso. Así se puede
 * teclear quince cartas a las 2 a.m., cerrar la pestaña sin querer y volver
 * donde ibas — el borrador se guarda solo.
 *
 * La previsualización del prorrateo se calcula aquí con la misma función pura
 * que usa el servidor, pero los números que se envían son los martillos y los
 * costos comunes: el reparto lo recalcula el servidor y lo de esta pantalla es
 * pintura.
 */

const BORRADOR_KEY = "p8:purchase-draft:v1";

const TIPOS = ["graded_card", "raw_card", "sealed_box", "sealed_pack", "lot", "supply"] as const;
const CATEGORIAS = ["sports", "tcg", "other"] as const;
const GRADADORAS = ["none", "PSA", "BGS", "CGC", "SGC", "TAG"] as const;

type LineaBorrador = {
  hammerPrice: string;
  type: (typeof TIPOS)[number];
  category: (typeof CATEGORIAS)[number];
  sportOrGame: string;
  playerOrCharacter: string;
  brand: string;
  setName: string;
  year: string;
  cardNumber: string;
  variant: string;
  gradingCompany: (typeof GRADADORAS)[number];
  grade: string;
  certNumber: string;
  marketValue: string;
};

type Borrador = {
  idempotencyKey: string;
  platform: (typeof ACQUISITION_PLATFORMS)[number];
  reference: string;
  purchasedAt: string;
  currency: string;
  paymentStatus: "pending" | "partial" | "paid";
  receivedStatus: "pending" | "in_transit" | "received" | "partial";
  dueAt: string;
  notes: string;
  buyerPremium: string;
  cardFee: string;
  cardFeeTouched: boolean;
  paidWithCard: boolean;
  shippingIntl: string;
  courierVe: string;
  customsVe: string;
  otherCosts: string;
  courierVeVes: string;
  customsVeVes: string;
  localFxRate: string;
  lines: LineaBorrador[];
};

function lineaVacia(): LineaBorrador {
  return {
    hammerPrice: "",
    type: "graded_card",
    category: "sports",
    sportOrGame: "",
    playerOrCharacter: "",
    brand: "",
    setName: "",
    year: "",
    cardNumber: "",
    variant: "",
    gradingCompany: "PSA",
    grade: "",
    certNumber: "",
    marketValue: "",
  };
}

function borradorVacio(): Borrador {
  return {
    idempotencyKey: crypto.randomUUID(),
    platform: "alt",
    reference: "",
    purchasedAt: new Date().toISOString().slice(0, 10),
    currency: "USD",
    paymentStatus: "pending",
    receivedStatus: "pending",
    dueAt: "",
    notes: "",
    buyerPremium: "",
    cardFee: "",
    cardFeeTouched: false,
    paidWithCard: false,
    shippingIntl: "",
    courierVe: "",
    customsVe: "",
    otherCosts: "",
    courierVeVes: "",
    customsVeVes: "",
    localFxRate: "",
    lines: [lineaVacia()],
  };
}

/** Un monto vacío o mal escrito vale cero para la previsualización. */
function monto(valor: string): string {
  const limpio = valor.trim();
  return /^\d{1,10}(\.\d{1,4})?$/.test(limpio) ? limpio : "0";
}

export function PurchaseWizard({ cardFeePercent }: { cardFeePercent: string }) {
  const t = useTranslations("admin.purchases.wizard");
  const tp = useTranslations("admin.purchases");
  const tInv = useTranslations("admin.inventory");
  const router = useRouter();

  const [paso, setPaso] = useState(1);
  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [cargado, setCargado] = useState(false);
  const [conflictos, setConflictos] = useState<readonly string[]>([]);
  const [revisando, setRevisando] = useState(false);
  const [isPending, startTransition] = useTransition();

  // --- Borrador local -------------------------------------------------------
  useEffect(() => {
    const guardado = window.localStorage.getItem(BORRADOR_KEY);
    if (guardado) {
      try {
        setBorrador({ ...borradorVacio(), ...(JSON.parse(guardado) as Borrador) });
        toast.info(t("draftRestored"));
      } catch {
        window.localStorage.removeItem(BORRADOR_KEY);
      }
    }
    setCargado(true);
    // Solo al montar: recuperar el borrador es una acción de arranque.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cargado) return;
    window.localStorage.setItem(BORRADOR_KEY, JSON.stringify(borrador));
  }, [borrador, cargado]);

  const actualizar = useCallback((cambios: Partial<Borrador>) => {
    setBorrador((b) => ({ ...b, ...cambios }));
  }, []);

  const actualizarLinea = useCallback((index: number, cambios: Partial<LineaBorrador>) => {
    setBorrador((b) => ({
      ...b,
      lines: b.lines.map((l, i) => (i === index ? { ...l, ...cambios } : l)),
    }));
  }, []);

  // --- Cálculo en vivo ------------------------------------------------------
  const costos = useMemo(
    () => ({
      buyerPremium: monto(borrador.buyerPremium),
      cardFee: monto(borrador.cardFee),
      shippingIntl: monto(borrador.shippingIntl),
      courierVe: monto(borrador.courierVe),
      customsVe: monto(borrador.customsVe),
      otherCosts: monto(borrador.otherCosts),
    }),
    [borrador],
  );

  const reparto = useMemo(() => {
    try {
      return allocateAcquisitionCost(
        borrador.lines.map((l, i) => ({
          id: String(i),
          lineNumber: i + 1,
          hammerPrice: monto(l.hammerPrice),
        })),
        costos,
      );
    } catch {
      return null;
    }
  }, [borrador.lines, costos]);

  // El fee sugerido deja de recalcularse en cuanto el dueño lo toca: el número
  // que manda es el de su estado de cuenta, no el nuestro.
  useEffect(() => {
    if (!borrador.paidWithCard || borrador.cardFeeTouched || !reparto) return;
    const sugerido = suggestCardFee({
      hammerTotal: reparto.hammerTotal,
      buyerPremium: monto(borrador.buyerPremium),
      percent: cardFeePercent,
    });
    const texto = toDbNumeric(sugerido);
    if (texto !== borrador.cardFee) setBorrador((b) => ({ ...b, cardFee: texto }));
  }, [
    borrador.paidWithCard,
    borrador.cardFeeTouched,
    borrador.buyerPremium,
    borrador.cardFee,
    reparto,
    cardFeePercent,
  ]);

  const certsRepetidos = useMemo(() => {
    const vistos = new Map<string, number>();
    const repetidos = new Set<number>();
    borrador.lines.forEach((l, i) => {
      const cert = l.certNumber.trim().toUpperCase();
      if (!cert || l.gradingCompany === "none") return;
      const clave = `${l.gradingCompany}:${cert}`;
      if (vistos.has(clave)) repetidos.add(i);
      else vistos.set(clave, i);
    });
    return repetidos;
  }, [borrador.lines]);

  const lineasValidas = borrador.lines.every((l) =>
    /^\d{1,10}(\.\d{1,4})?$/.test(l.hammerPrice.trim()),
  );

  // --- Pre-vuelo de certs ---------------------------------------------------
  useEffect(() => {
    if (paso !== 4) return;
    const certs = borrador.lines
      .filter((l) => l.certNumber.trim() !== "" && l.gradingCompany !== "none")
      .map((l) => ({ gradingCompany: l.gradingCompany, certNumber: l.certNumber.trim() }));

    if (certs.length === 0) {
      setConflictos([]);
      return;
    }

    let cancelado = false;
    setRevisando(true);
    void findCertConflicts(certs)
      .then((r) => {
        if (!cancelado) setConflictos(r);
      })
      .finally(() => {
        if (!cancelado) setRevisando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [paso, borrador.lines]);

  function enviar() {
    startTransition(async () => {
      const result = await createAcquisition({
        idempotencyKey: borrador.idempotencyKey,
        platform: borrador.platform,
        reference: borrador.reference.trim() || undefined,
        purchasedAt: borrador.purchasedAt,
        currency: borrador.currency,
        buyerPremium: costos.buyerPremium,
        cardFee: costos.cardFee,
        shippingIntl: costos.shippingIntl,
        courierVe: costos.courierVe,
        customsVe: costos.customsVe,
        otherCosts: costos.otherCosts,
        courierVeVes: borrador.courierVeVes.trim() || undefined,
        customsVeVes: borrador.customsVeVes.trim() || undefined,
        localFxRate: borrador.localFxRate.trim() || undefined,
        dueAt: borrador.dueAt || undefined,
        paymentStatus: borrador.paymentStatus,
        receivedStatus: borrador.receivedStatus,
        notes: borrador.notes.trim() || undefined,
        lines: borrador.lines.map((l, i) => ({
          lineNumber: i + 1,
          hammerPrice: monto(l.hammerPrice),
          item: {
            type: l.type,
            category: l.category,
            sportOrGame: l.sportOrGame.trim() || undefined,
            playerOrCharacter: l.playerOrCharacter.trim() || undefined,
            brand: l.brand.trim() || undefined,
            setName: l.setName.trim() || undefined,
            year: l.year.trim() ? Number(l.year) : undefined,
            cardNumber: l.cardNumber.trim() || undefined,
            variant: l.variant.trim() || undefined,
            gradingCompany: l.gradingCompany,
            grade: l.grade.trim() ? Number(l.grade) : undefined,
            certNumber: l.certNumber.trim() || undefined,
            quantity: 1,
            marketValue: l.marketValue.trim() || undefined,
          },
        })),
      });

      if (!result.ok) {
        toast.error(
          t.has(`errors.${result.reason}`) ? t(`errors.${result.reason}`) : t("errors.FAILED"),
        );
        return;
      }

      window.localStorage.removeItem(BORRADOR_KEY);
      toast.success(
        result.alreadyExisted ? t("alreadyExisted") : t("created", { count: result.items }),
      );
      router.push(`/admin/purchases/${result.acquisitionId}`);
    });
  }

  const pasos = [t("step1"), t("step2"), t("step3"), t("step4")];

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-sm">
        {pasos.map((etiqueta, i) => (
          <li key={etiqueta}>
            <button
              type="button"
              onClick={() => setPaso(i + 1)}
              className={cn(
                "rounded border px-3 py-1.5 transition-colors",
                paso === i + 1
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {etiqueta}
            </button>
          </li>
        ))}
      </ol>

      {/* ---------------------------------------------------------------- */}
      {paso === 1 && (
        <Card>
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="platform">{tp("platform")}</Label>
              <select
                id="platform"
                className="border-border bg-background h-9 rounded border px-2 text-sm"
                value={borrador.platform}
                onChange={(e) =>
                  actualizar({ platform: e.currentTarget.value as Borrador["platform"] })
                }
              >
                {ACQUISITION_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {tp(`platformName.${p}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="reference">{tp("reference")}</Label>
              <Input
                id="reference"
                value={borrador.reference}
                onChange={(e) => actualizar({ reference: e.currentTarget.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="purchasedAt">{tp("purchasedAt")}</Label>
              <Input
                id="purchasedAt"
                type="date"
                value={borrador.purchasedAt}
                onChange={(e) => actualizar({ purchasedAt: e.currentTarget.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="dueAt">{t("dueAt")}</Label>
              <Input
                id="dueAt"
                type="date"
                value={borrador.dueAt}
                onChange={(e) => actualizar({ dueAt: e.currentTarget.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="paymentStatus">{tp("paymentStatus")}</Label>
              <select
                id="paymentStatus"
                className="border-border bg-background h-9 rounded border px-2 text-sm"
                value={borrador.paymentStatus}
                onChange={(e) =>
                  actualizar({ paymentStatus: e.currentTarget.value as Borrador["paymentStatus"] })
                }
              >
                {(["pending", "partial", "paid"] as const).map((s) => (
                  <option key={s} value={s}>
                    {tp(`payment.${s}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="receivedStatus">{tp("receivedStatus")}</Label>
              <select
                id="receivedStatus"
                className="border-border bg-background h-9 rounded border px-2 text-sm"
                value={borrador.receivedStatus}
                onChange={(e) =>
                  actualizar({
                    receivedStatus: e.currentTarget.value as Borrador["receivedStatus"],
                  })
                }
              >
                {(["pending", "in_transit", "received", "partial"] as const).map((s) => (
                  <option key={s} value={s}>
                    {tp(`received.${s}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Input
                id="notes"
                value={borrador.notes}
                onChange={(e) => actualizar({ notes: e.currentTarget.value })}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {paso === 2 && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("minimum")}</p>

          {borrador.lines.map((linea, index) => (
            <Card key={index}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t("lineTitle", { n: index + 1 })}</h3>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setBorrador((b) => ({
                          ...b,
                          lines: [
                            ...b.lines.slice(0, index + 1),
                            { ...linea, certNumber: "", playerOrCharacter: "", cardNumber: "" },
                            ...b.lines.slice(index + 1),
                          ],
                        }))
                      }
                    >
                      <Copy className="size-4" aria-hidden />
                      <span className="sr-only sm:not-sr-only">{t("duplicateLine")}</span>
                    </Button>
                    {borrador.lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setBorrador((b) => ({
                            ...b,
                            lines: b.lines.filter((_, i) => i !== index),
                          }))
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                        <span className="sr-only">{t("removeLine")}</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`hammer-${index}`}>{t("hammer")}</Label>
                    <Input
                      id={`hammer-${index}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={linea.hammerPrice}
                      onChange={(e) =>
                        actualizarLinea(index, { hammerPrice: e.currentTarget.value })
                      }
                      aria-invalid={
                        linea.hammerPrice.trim() !== "" &&
                        !/^\d{1,10}(\.\d{1,4})?$/.test(linea.hammerPrice.trim())
                      }
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`type-${index}`}>{tInv("filter.type")}</Label>
                    <select
                      id={`type-${index}`}
                      className="border-border bg-background h-9 rounded border px-2 text-sm"
                      value={linea.type}
                      onChange={(e) =>
                        actualizarLinea(index, {
                          type: e.currentTarget.value as LineaBorrador["type"],
                        })
                      }
                    >
                      {TIPOS.map((tipo) => (
                        <option key={tipo} value={tipo}>
                          {tInv(`type.${tipo}`)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`category-${index}`}>{tInv("filter.category")}</Label>
                    <select
                      id={`category-${index}`}
                      className="border-border bg-background h-9 rounded border px-2 text-sm"
                      value={linea.category}
                      onChange={(e) =>
                        actualizarLinea(index, {
                          category: e.currentTarget.value as LineaBorrador["category"],
                        })
                      }
                    >
                      {CATEGORIAS.map((c) => (
                        <option key={c} value={c}>
                          {tInv(`category.${c}`)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor={`player-${index}`}>{tInv("detail.fields.player")}</Label>
                    <Input
                      id={`player-${index}`}
                      value={linea.playerOrCharacter}
                      onChange={(e) =>
                        actualizarLinea(index, { playerOrCharacter: e.currentTarget.value })
                      }
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`game-${index}`}>{tInv("filter.game")}</Label>
                    <Input
                      id={`game-${index}`}
                      value={linea.sportOrGame}
                      onChange={(e) =>
                        actualizarLinea(index, { sportOrGame: e.currentTarget.value })
                      }
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`set-${index}`}>{tInv("detail.fields.set")}</Label>
                    <Input
                      id={`set-${index}`}
                      value={linea.setName}
                      onChange={(e) => actualizarLinea(index, { setName: e.currentTarget.value })}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`year-${index}`}>{tInv("detail.fields.year")}</Label>
                    <Input
                      id={`year-${index}`}
                      inputMode="numeric"
                      value={linea.year}
                      onChange={(e) => actualizarLinea(index, { year: e.currentTarget.value })}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`number-${index}`}>{tInv("detail.fields.number")}</Label>
                    <Input
                      id={`number-${index}`}
                      value={linea.cardNumber}
                      onChange={(e) =>
                        actualizarLinea(index, { cardNumber: e.currentTarget.value })
                      }
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`grading-${index}`}>{tInv("filter.grading")}</Label>
                    <select
                      id={`grading-${index}`}
                      className="border-border bg-background h-9 rounded border px-2 text-sm"
                      value={linea.gradingCompany}
                      onChange={(e) =>
                        actualizarLinea(index, {
                          gradingCompany: e.currentTarget.value as LineaBorrador["gradingCompany"],
                        })
                      }
                    >
                      {GRADADORAS.map((g) => (
                        <option key={g} value={g}>
                          {g === "none" ? tInv("type.raw_card") : g}
                        </option>
                      ))}
                    </select>
                  </div>

                  {linea.gradingCompany !== "none" && (
                    <>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`grade-${index}`}>{tInv("filter.grade")}</Label>
                        <Input
                          id={`grade-${index}`}
                          inputMode="decimal"
                          value={linea.grade}
                          onChange={(e) => actualizarLinea(index, { grade: e.currentTarget.value })}
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <Label htmlFor={`cert-${index}`}>{tInv("detail.fields.cert")}</Label>
                        <Input
                          id={`cert-${index}`}
                          value={linea.certNumber}
                          aria-invalid={certsRepetidos.has(index)}
                          onChange={(e) =>
                            actualizarLinea(index, { certNumber: e.currentTarget.value })
                          }
                        />
                        {certsRepetidos.has(index) && (
                          <p className="text-destructive text-xs">{t("certDuplicateInForm")}</p>
                        )}
                      </div>
                    </>
                  )}

                  <div className="grid gap-1.5">
                    <Label htmlFor={`market-${index}`}>{tInv("columns.market")}</Label>
                    <Input
                      id={`market-${index}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={linea.marketValue}
                      onChange={(e) =>
                        actualizarLinea(index, { marketValue: e.currentTarget.value })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBorrador((b) => ({ ...b, lines: [...b.lines, lineaVacia()] }))}
            >
              <Plus className="size-4" aria-hidden />
              {t("addLine")}
            </Button>

            {reparto && (
              <p className="text-muted-foreground text-sm">
                {t("hammerTotal")}:{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {formatMoney(reparto.hammerTotal)}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {paso === 3 && (
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="premium">{tp("detail.premium")}</Label>
                <Input
                  id="premium"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={borrador.buyerPremium}
                  onChange={(e) => actualizar({ buyerPremium: e.currentTarget.value })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="shipping">{tp("detail.shipping")}</Label>
                <Input
                  id="shipping"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={borrador.shippingIntl}
                  onChange={(e) => actualizar({ shippingIntl: e.currentTarget.value })}
                />
              </div>
            </div>

            <div className="border-border space-y-2 rounded border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="paidWithCard"
                  checked={borrador.paidWithCard}
                  onCheckedChange={(v) => actualizar({ paidWithCard: v === true })}
                />
                <Label htmlFor="paidWithCard">{t("paidWithCard")}</Label>
              </div>

              {borrador.paidWithCard && (
                <div className="grid gap-1.5">
                  <Label htmlFor="cardFee">{tp("detail.cardFee")}</Label>
                  <Input
                    id="cardFee"
                    inputMode="decimal"
                    value={borrador.cardFee}
                    onChange={(e) =>
                      actualizar({ cardFee: e.currentTarget.value, cardFeeTouched: true })
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    {borrador.cardFeeTouched
                      ? t("cardFeeTouched")
                      : t("cardFeeSuggested", { pct: cardFeePercent })}
                  </p>
                </div>
              )}
            </div>

            <div className="border-border space-y-3 rounded border p-3">
              <div>
                <h3 className="text-sm font-medium">{t("localExpenses")}</h3>
                <p className="text-muted-foreground text-xs">{t("localHelp")}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="courierVe">{tp("detail.courier")} (USD)</Label>
                  <Input
                    id="courierVe"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={borrador.courierVe}
                    onChange={(e) => actualizar({ courierVe: e.currentTarget.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="customsVe">{tp("detail.customs")} (USD)</Label>
                  <Input
                    id="customsVe"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={borrador.customsVe}
                    onChange={(e) => actualizar({ customsVe: e.currentTarget.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="localFxRate">{t("rate")}</Label>
                  <Input
                    id="localFxRate"
                    inputMode="decimal"
                    placeholder="36.7412"
                    value={borrador.localFxRate}
                    onChange={(e) => actualizar({ localFxRate: e.currentTarget.value })}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="otherCosts">{tp("detail.other")}</Label>
              <Input
                id="otherCosts"
                inputMode="decimal"
                placeholder="0.00"
                value={borrador.otherCosts}
                onChange={(e) => actualizar({ otherCosts: e.currentTarget.value })}
              />
            </div>

            <dl className="border-border space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("sharedTotal")}</dt>
                <dd className="tabular-nums">{formatMoney(sharedCostsTotal(costos))}</dd>
              </div>
              {reparto && (
                <div className="flex justify-between gap-2 font-medium">
                  <dt>{t("grandTotal")}</dt>
                  <dd className="tabular-nums">{formatMoney(reparto.grandTotal)}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {paso === 4 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4">
              <h3 className="text-sm font-medium">{t("allocation")}</h3>
              <p className="text-muted-foreground mt-1 text-xs">{t("allocationHelp")}</p>

              {reparto ? (
                <ul className="mt-3 space-y-1.5">
                  {reparto.lines.map((linea, i) => {
                    const carta = borrador.lines[i]!;
                    const conflicto =
                      carta.certNumber.trim() !== "" &&
                      conflictos.includes(carta.certNumber.trim());
                    return (
                      <li
                        key={linea.lineNumber}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-muted-foreground tabular-nums">
                            {linea.lineNumber}.
                          </span>{" "}
                          {carta.playerOrCharacter || t("lineTitle", { n: linea.lineNumber })}
                          {conflicto && (
                            <Badge variant="destructive" className="ml-2 font-normal">
                              {t("certConflict")}
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {formatMoney(linea.hammerPrice)} + {formatMoney(linea.sharedShare)}
                        </span>
                        <span className="w-24 text-right font-medium tabular-nums">
                          {formatMoney(linea.allocatedCost)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-destructive mt-3 text-sm">{t("errors.ALLOCATION_MISMATCH")}</p>
              )}

              {reparto && (
                <dl className="border-border mt-3 space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t("hammerTotal")}</dt>
                    <dd className="tabular-nums">{formatMoney(reparto.hammerTotal)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t("sharedTotal")}</dt>
                    <dd className="tabular-nums">{formatMoney(reparto.sharedTotal)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 font-medium">
                    <dt>{t("grandTotal")}</dt>
                    <dd className="tabular-nums">{formatMoney(reparto.grandTotal)}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>

          {revisando && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("checking")}
            </p>
          )}

          {conflictos.length > 0 && (
            <p className="border-destructive/40 text-destructive flex items-start gap-2 rounded border p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("errors.CERT_CONFLICT")}
            </p>
          )}

          <Button
            type="button"
            onClick={enviar}
            disabled={
              isPending ||
              !reparto ||
              !lineasValidas ||
              conflictos.length > 0 ||
              certsRepetidos.size > 0
            }
            className="w-full"
          >
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isPending ? t("saving") : t("confirm")}
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={paso === 1}
          onClick={() => setPaso((p) => Math.max(1, p - 1))}
        >
          {t("back")}
        </Button>

        <span className="text-muted-foreground text-xs">{t("step", { n: paso })}</span>

        {paso < 4 ? (
          <Button type="button" onClick={() => setPaso((p) => Math.min(4, p + 1))}>
            {t("next")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              window.localStorage.removeItem(BORRADOR_KEY);
              setBorrador(borradorVacio());
              setPaso(1);
            }}
          >
            {t("discardDraft")}
          </Button>
        )}
      </div>
    </div>
  );
}
