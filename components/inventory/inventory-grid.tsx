import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { InventoryRowView } from "@/lib/inventory/format";
import { cn } from "@/lib/utils";

/**
 * Una carta suelta y un slab graduado no tienen la misma forma: la carcasa de
 * PSA es más alta y estrecha. La guía de marca las separa (2.5/3.5 contra
 * 3.25/5.25) y usar una sola proporción deforma la foto de la otra.
 */
function esSlab(type: string): boolean {
  return type === "graded_card";
}

import { MoneyText } from "./money-view";

/**
 * Vista de fotos.
 *
 * Sin transformaciones de Supabase —son de plan Pro y el proyecto está en el
 * gratis—, así que la imagen se sube ya recortada desde el teléfono y aquí solo
 * se sirve. `sizes` evita que el navegador descargue la versión grande para una
 * tarjeta de 200 px.
 */
export async function InventoryGrid({
  rows,
  photos,
}: {
  rows: readonly InventoryRowView[];
  photos: ReadonlyMap<string, string>;
}) {
  const t = await getTranslations("admin.inventory");

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {rows.map((row) => {
        const foto = photos.get(row.id);
        return (
          <li key={row.id}>
            <Link
              href={`/admin/inventory/${row.id}`}
              className="group border-border hover:border-foreground block overflow-hidden rounded-lg border transition-colors"
            >
              <div
                className={cn(
                  "bg-muted relative",
                  esSlab(row.type) ? "aspect-[3.25/5.25]" : "aspect-[2.5/3.5]",
                )}
              >
                {foto ? (
                  <Image
                    src={foto}
                    alt={row.title}
                    fill
                    sizes="(min-width: 1280px) 18vw, (min-width: 640px) 30vw, 45vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1">
                    <ImageOff className="size-6" aria-hidden />
                    <span className="text-xs">{t("noPhoto")}</span>
                  </div>
                )}
                {row.isPublished && (
                  <Badge className="absolute top-2 right-2" variant="secondary">
                    {t("filter.publishedYes")}
                  </Badge>
                )}
              </div>

              <div className="space-y-1 p-2">
                <p className="truncate text-xs font-medium" title={row.title}>
                  {row.title}
                </p>
                <p className="text-muted-foreground text-xs">{row.grade}</p>
                <div className="flex items-baseline justify-between gap-1 pt-0.5">
                  <span className="text-muted-foreground font-mono text-[10px]">{row.sku}</span>
                  <MoneyText value={row.market} className="text-xs" />
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
