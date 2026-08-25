"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  GRADING_COMPANIES,
  ITEM_CATEGORIES,
  ITEM_STATUSES,
  ITEM_TYPES,
  OWNER_TYPES,
  VALUE_FIELDS,
} from "@/lib/inventory/params";
import { cn } from "@/lib/utils";

/**
 * Los filtros escriben en la URL, no en un estado de React.
 *
 * Así una vista filtrada se comparte por enlace, sobrevive a una recarga y
 * responde al gesto de volver atrás del teléfono — que en móvil es la forma
 * natural de deshacer.
 */

type Multi = "type" | "category" | "grading" | "status";

const MULTIS: readonly { key: Multi; valores: readonly string[] }[] = [
  { key: "type", valores: ITEM_TYPES },
  { key: "category", valores: ITEM_CATEGORIES },
  { key: "grading", valores: GRADING_COMPANIES },
  { key: "status", valores: ITEM_STATUSES },
];

/** Claves que cuentan como "filtro puesto" para el contador del botón. */
const CLAVES_FILTRO = [
  "q",
  "type",
  "category",
  "grading",
  "status",
  "owner",
  "game",
  "location",
  "gradeMin",
  "gradeMax",
  "valueMin",
  "valueMax",
  "published",
] as const;

export function InventoryFilters({ canSeeCosts }: { canSeeCosts: boolean }) {
  const t = useTranslations("admin.inventory");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);

  const activos = useMemo(
    () => CLAVES_FILTRO.filter((k) => searchParams.get(k)).length,
    [searchParams],
  );

  const escribir = useCallback(
    (cambios: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(cambios)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Cualquier cambio de filtro devuelve a la primera página: quedarse en la
      // página 7 de un resultado que ahora tiene 2 muestra una tabla vacía.
      next.delete("page");
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const alternarEnLista = useCallback(
    (key: Multi, valor: string) => {
      const actuales = (searchParams.get(key) ?? "").split(",").filter(Boolean);
      const siguiente = actuales.includes(valor)
        ? actuales.filter((v) => v !== valor)
        : [...actuales, valor];
      escribir({ [key]: siguiente.length ? siguiente.join(",") : null });
    },
    [escribir, searchParams],
  );

  const campoValor = searchParams.get("valueField") ?? "market_value";
  const camposValorVisibles = canSeeCosts
    ? VALUE_FIELDS
    : VALUE_FIELDS.filter((f) => f !== "cost_basis");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-0 flex-1 sm:max-w-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const valor = new FormData(event.currentTarget).get("q");
          escribir({ q: typeof valor === "string" && valor.trim() ? valor.trim() : null });
        }}
      >
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          name="q"
          type="search"
          defaultValue={searchParams.get("q") ?? ""}
          placeholder={t("search")}
          aria-label={t("search")}
          className="pl-9"
        />
      </form>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetTrigger className="border-border hover:bg-accent inline-flex h-9 shrink-0 items-center gap-2 rounded border px-3 text-sm font-medium transition-colors">
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("filters")}
          {activos > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {activos}
            </Badge>
          )}
        </SheetTrigger>

        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("filters")}</SheetTitle>
          </SheetHeader>

          <div className="space-y-6 px-4 pb-8">
            {MULTIS.map(({ key, valores }) => {
              const puestos = (searchParams.get(key) ?? "").split(",").filter(Boolean);
              return (
                <fieldset key={key} className="space-y-2">
                  <legend className="text-sm font-medium">{t(`filter.${key}`)}</legend>
                  <div className="flex flex-wrap gap-2">
                    {valores.map((valor) => {
                      const activo = puestos.includes(valor);
                      const etiqueta =
                        key === "grading"
                          ? valor
                          : t(`${key === "category" ? "category" : key}.${valor}`);
                      return (
                        <button
                          key={valor}
                          type="button"
                          aria-pressed={activo}
                          onClick={() => alternarEnLista(key, valor)}
                          className={cn(
                            "rounded border px-3 py-1.5 text-sm transition-colors",
                            activo
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {etiqueta}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("filter.owner")}</legend>
              <div className="flex flex-wrap gap-2">
                {OWNER_TYPES.map((valor) => {
                  const activo = searchParams.get("owner") === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={activo}
                      onClick={() => escribir({ owner: activo ? null : valor })}
                      className={cn(
                        "rounded border px-3 py-1.5 text-sm transition-colors",
                        activo
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(`owner.${valor}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("filter.published")}</legend>
              <div className="flex flex-wrap gap-2">
                {(["yes", "no"] as const).map((valor) => {
                  const activo = searchParams.get("published") === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={activo}
                      onClick={() => escribir({ published: activo ? null : valor })}
                      className={cn(
                        "rounded border px-3 py-1.5 text-sm transition-colors",
                        activo
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(valor === "yes" ? "filter.publishedYes" : "filter.publishedNo")}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("filter.grade")}</legend>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10}
                  step={0.5}
                  aria-label={t("filter.min")}
                  placeholder={t("filter.min")}
                  defaultValue={searchParams.get("gradeMin") ?? ""}
                  onBlur={(e) => escribir({ gradeMin: e.currentTarget.value || null })}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10}
                  step={0.5}
                  aria-label={t("filter.max")}
                  placeholder={t("filter.max")}
                  defaultValue={searchParams.get("gradeMax") ?? ""}
                  onBlur={(e) => escribir({ gradeMax: e.currentTarget.value || null })}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("filter.value")}</legend>
              <div className="flex flex-wrap gap-2">
                {camposValorVisibles.map((campo) => (
                  <button
                    key={campo}
                    type="button"
                    aria-pressed={campoValor === campo}
                    onClick={() => escribir({ valueField: campo })}
                    className={cn(
                      "rounded border px-3 py-1.5 text-sm transition-colors",
                      campoValor === campo
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(
                      campo === "market_value"
                        ? "filter.valueMarket"
                        : campo === "list_price"
                          ? "filter.valueList"
                          : "filter.valueCost",
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label={t("filter.min")}
                  placeholder={t("filter.min")}
                  defaultValue={searchParams.get("valueMin") ?? ""}
                  onBlur={(e) => escribir({ valueMin: e.currentTarget.value || null })}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label={t("filter.max")}
                  placeholder={t("filter.max")}
                  defaultValue={searchParams.get("valueMax") ?? ""}
                  onBlur={(e) => escribir({ valueMax: e.currentTarget.value || null })}
                />
              </div>
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor="filtro-ubicacion">{t("filter.location")}</Label>
              <Input
                id="filtro-ubicacion"
                defaultValue={searchParams.get("location") ?? ""}
                onBlur={(e) => escribir({ location: e.currentTarget.value.trim() || null })}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {activos > 0 && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() =>
            escribir(
              Object.fromEntries(CLAVES_FILTRO.map((k) => [k, null])) as Record<string, null>,
            )
          }
        >
          <X className="size-4" aria-hidden />
          {t("clearFilters")}
        </Button>
      )}
    </div>
  );
}
