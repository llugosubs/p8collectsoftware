import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Check, Circle, ImageOff } from "lucide-react";

import { PublishButton } from "@/components/inventory/publish-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { canPublishItem, type ConsignmentTerms } from "@/lib/domain/inventory";
import { formatMoney } from "@/lib/domain/money";
import {
  displayMoney,
  formatDateOnly,
  formatGrade,
  formatInstant,
  itemTitle,
} from "@/lib/inventory/format";
import { readNullableNumeric } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const ROLES_CON_COSTOS = new Set(["owner", "admin"]);

export const metadata: Metadata = { title: "Pieza" };

/** Una cifra o la razón por la que no está. Versión de servidor. */
async function Cifra({ raw, hidden }: { raw: number | null | undefined; hidden: boolean }) {
  const t = await getTranslations("admin.inventory");
  const v = displayMoney(raw, hidden ? "hidden" : "empty");
  if (v.kind === "missing") {
    return (
      <span className="text-muted-foreground text-xs italic">
        {v.reason === "hidden" ? t("noAccess") : t("noComp")}
      </span>
    );
  }
  return <span className="tabular-nums">{v.text}</span>;
}

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("admin.inventory.detail");
  const tInv = await getTranslations("admin.inventory");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const canSeeCosts = ROLES_CON_COSTOS.has(profile?.role ?? "");

  const { data: item } = await supabase
    .from("items_with_costs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!item || !item.id) notFound();

  const [{ data: images }, { data: valuations }, { data: acquisition }] = await Promise.all([
    supabase
      .from("item_images")
      .select("id,url,kind,sort_order")
      .eq("item_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("item_valuations")
      .select("id,value,source,note,valued_at")
      .eq("item_id", id)
      .order("valued_at", { ascending: false })
      .limit(10),
    item.acquisition_id
      ? supabase
          .from("acquisitions")
          .select("id,platform,reference,purchased_at")
          .eq("id", item.acquisition_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Igual que en la acción: no poder leer el acuerdo no es "sin mínimo".
  let terms: ConsignmentTerms | null = null;
  if (item.owner_type === "consignment") {
    const { data: agreement, error } = await supabase
      .from("consignment_agreements")
      .select("agreed_min_price")
      .eq("item_id", id)
      .eq("status", "active")
      .maybeSingle();
    terms =
      error || !agreement
        ? "unknown"
        : { agreedMinPrice: readNullableNumeric(agreement.agreed_min_price) };
  }

  const check = canPublishItem(
    {
      status: item.status ?? "in_stock",
      ownerType: item.owner_type ?? "own",
      listPrice: readNullableNumeric(item.list_price),
      photoCount: images?.length ?? 0,
    },
    terms,
  );

  const titulo = itemTitle(item);
  const grado = formatGrade(item.grading_company, item.grade, item.raw_condition);

  const ficha: readonly (readonly [string, string | number | null])[] = [
    ["sku", item.sku],
    ["type", item.type ? tInv(`type.${item.type}`) : null],
    ["category", item.category ? tInv(`category.${item.category}`) : null],
    ["game", item.sport_or_game],
    ["player", item.player_or_character],
    ["brand", item.brand],
    ["set", item.set_name],
    ["year", item.year],
    ["number", item.card_number],
    ["variant", item.variant],
    ["serial", item.serial_numbered],
    ["grading", grado],
    ["cert", item.cert_number],
    ["language", item.language],
    ["quantity", item.quantity],
    ["location", item.location],
    ["owner", item.owner_type ? tInv(`owner.${item.owner_type}`) : null],
    ["status", item.status ? tInv(`status.${item.status}`) : null],
  ];

  // `purchased_at` es un `date` y los otros tres son `timestamptz`. No se
  // formatean igual: el primero no tiene zona, y convertirlo retrocedería un
  // día en Caracas.
  const eventos = [
    { key: "purchased", at: formatDateOnly(acquisition?.purchased_at) },
    { key: "received", at: formatInstant(item.received_at) },
    { key: "listed", at: formatInstant(item.listed_at) },
    { key: "sold", at: formatInstant(item.sold_at) },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <Link
        href="/admin/inventory"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{titulo}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{item.sku}</span>
          <Badge variant="secondary" className="font-normal">
            {grado}
          </Badge>
          {item.status && (
            <Badge variant="outline" className="font-normal">
              {tInv(`status.${item.status}`)}
            </Badge>
          )}
          {item.is_published && <Badge className="font-normal">{t("published")}</Badge>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="space-y-4">
          <section aria-label={t("photos")}>
            {images && images.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="border-border bg-muted relative aspect-[5/7] overflow-hidden rounded border"
                  >
                    <Image
                      src={image.url}
                      alt={`${titulo} — ${image.kind}`}
                      fill
                      sizes="(min-width: 1024px) 10rem, 45vw"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-border text-muted-foreground flex aspect-[5/7] flex-col items-center justify-center gap-2 rounded border border-dashed">
                <ImageOff className="size-8" aria-hidden />
                <span className="text-sm">{t("noPhotos")}</span>
              </div>
            )}
          </section>

          <PublishButton
            itemId={item.id}
            isPublished={item.is_published ?? false}
            blockedReason={check.ok ? null : check.reason}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-medium">{t("money")}</h2>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {canSeeCosts && (
                  <>
                    <div className="flex justify-between gap-2 text-sm">
                      <dt className="text-muted-foreground">{t("moneyFields.allocated")}</dt>
                      <dd>
                        <Cifra raw={item.allocated_cost} hidden={false} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 text-sm">
                      <dt className="text-muted-foreground">{t("moneyFields.grading")}</dt>
                      <dd>
                        <Cifra raw={item.grading_cost} hidden={false} />
                      </dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between gap-2 text-sm font-medium">
                  <dt>{t("moneyFields.cost")}</dt>
                  <dd>
                    <Cifra raw={item.cost_basis} hidden={!canSeeCosts} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2 text-sm">
                  <dt className="text-muted-foreground">{t("moneyFields.market")}</dt>
                  <dd>
                    <Cifra raw={item.market_value} hidden={false} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2 text-sm">
                  <dt className="text-muted-foreground">{t("moneyFields.list")}</dt>
                  <dd>
                    <Cifra raw={item.list_price} hidden={false} />
                  </dd>
                </div>
                {canSeeCosts && (
                  <div className="flex justify-between gap-2 text-sm">
                    <dt className="text-muted-foreground">{t("moneyFields.min")}</dt>
                    <dd>
                      <Cifra raw={item.min_price} hidden={false} />
                    </dd>
                  </div>
                )}
                <div className="border-border flex justify-between gap-2 border-t pt-2 text-sm font-medium sm:col-span-2">
                  <dt>{t("moneyFields.gain")}</dt>
                  <dd
                    className={cn(
                      "tabular-nums",
                      (item.unrealized_gain ?? 0) > 0 && "text-[#0F7B3F]",
                      (item.unrealized_gain ?? 0) < 0 && "text-[#B91C1C]",
                    )}
                  >
                    <Cifra raw={item.unrealized_gain} hidden={!canSeeCosts} />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-medium">{t("timeline")}</h2>
              <ol className="space-y-2">
                {eventos.map((evento) => (
                  <li key={evento.key} className="flex items-center gap-3 text-sm">
                    {evento.at ? (
                      <Check className="text-foreground size-4 shrink-0" aria-hidden />
                    ) : (
                      <Circle className="text-muted-foreground/40 size-4 shrink-0" aria-hidden />
                    )}
                    <span className={cn(!evento.at && "text-muted-foreground")}>
                      {t(`events.${evento.key}`)}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                      {evento.at ?? t("events.pending")}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-medium">{t("data")}</h2>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {ficha
                  .filter(([, valor]) => valor !== null && valor !== "")
                  .map(([clave, valor]) => (
                    <div key={clave} className="flex justify-between gap-2 text-sm">
                      <dt className="text-muted-foreground">{t(`fields.${clave}`)}</dt>
                      <dd className="text-right">{valor}</dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-medium">{t("valuations")}</h2>
              {valuations && valuations.length > 0 ? (
                <ol className="space-y-2">
                  {valuations.map((v) => (
                    <li key={v.id} className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {formatInstant(v.valued_at)} · {v.source}
                      </span>
                      <span className="tabular-nums">{formatMoney(String(v.value))}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">{t("noValuations")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
