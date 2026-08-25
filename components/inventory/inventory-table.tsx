"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InventoryRowView } from "@/lib/inventory/format";
import type { SortField } from "@/lib/inventory/params";
import { cn } from "@/lib/utils";

import { BulkActions } from "./bulk-actions";
import { MoneyText } from "./money-view";

/**
 * La tabla del inventario.
 *
 * El orden y la paginación son del servidor y viajan por la URL; lo único que
 * vive en el cliente es la selección de filas, que es lo que las acciones
 * masivas necesitan.
 */

type Columna = {
  key: SortField | null;
  label: string;
  align?: "right";
  /** Solo tiene sentido para quien ve costos. */
  costOnly?: boolean;
};

export function InventoryTable({
  rows,
  canSeeCosts,
}: {
  rows: readonly InventoryRowView[];
  canSeeCosts: boolean;
}) {
  const t = useTranslations("admin.inventory");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());

  const sortActual = searchParams.get("sort") ?? "created_at";
  const dirActual = searchParams.get("dir") ?? "desc";

  const columnas: Columna[] = [
    { key: "sku", label: t("columns.sku") },
    { key: "player_or_character", label: t("columns.item") },
    { key: "grade", label: t("columns.grade") },
    { key: "status", label: t("columns.status") },
    { key: "cost_basis", label: t("columns.cost"), align: "right", costOnly: true },
    { key: "market_value", label: t("columns.market"), align: "right" },
    { key: "list_price", label: t("columns.list"), align: "right" },
    { key: null, label: t("columns.gain"), align: "right", costOnly: true },
  ];

  const visibles = columnas.filter((c) => !c.costOnly || canSeeCosts);

  function ordenarPor(campo: SortField) {
    const next = new URLSearchParams(searchParams.toString());
    const mismaColumna = sortActual === campo;
    next.set("sort", campo);
    next.set("dir", mismaColumna && dirActual === "asc" ? "desc" : "asc");
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function alternarTodo(marcado: boolean) {
    setSeleccion(marcado ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function alternarUno(id: string) {
    setSeleccion((actual) => {
      const next = new Set(actual);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const todasMarcadas = rows.length > 0 && seleccion.size === rows.length;

  return (
    <>
      {/* Móvil: tarjetas.
          Una tabla de nueve columnas en 375 px obliga a desplazar de lado para
          ver el precio, que es lo primero que uno quiere saber. La tarjeta
          pone al frente lo que se mira y deja el resto en segunda línea. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="border-border flex items-start gap-3 rounded border p-3">
              <Checkbox
                checked={seleccion.has(row.id)}
                onCheckedChange={() => alternarUno(row.id)}
                aria-label={`Seleccionar ${row.sku}`}
                className="mt-1 shrink-0"
              />
              <Link href={`/admin/inventory/${row.id}`} className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{row.title}</p>

                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground font-mono text-[11px]">{row.sku}</span>
                  <Badge variant="secondary" className="font-normal">
                    {row.grade}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {t(`status.${row.status}`)}
                  </Badge>
                  {row.ownerType === "consignment" && (
                    <Badge variant="outline" className="font-normal">
                      {t("owner.consignment")}
                    </Badge>
                  )}
                  {row.quantity > 1 && (
                    <Badge variant="outline" className="font-normal tabular-nums">
                      ×{row.quantity}
                    </Badge>
                  )}
                </div>

                <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                  <div className="flex items-baseline gap-1">
                    <dt className="text-muted-foreground text-xs">{t("columns.market")}</dt>
                    <dd>
                      <MoneyText value={row.market} />
                    </dd>
                  </div>
                  {canSeeCosts && (
                    <>
                      <div className="flex items-baseline gap-1">
                        <dt className="text-muted-foreground text-xs">{t("columns.cost")}</dt>
                        <dd>
                          <MoneyText value={row.cost} />
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <dt className="text-muted-foreground text-xs">{t("columns.gain")}</dt>
                        <dd>
                          <MoneyText value={row.gain} signed />
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {/* Escritorio: la tabla completa, con orden por columna. */}
      <div className="border-border hidden overflow-x-auto rounded border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={todasMarcadas}
                  onCheckedChange={(v) => alternarTodo(v === true)}
                  aria-label="Seleccionar todo"
                />
              </TableHead>
              {visibles.map((col) => (
                <TableHead key={col.label} className={cn(col.align === "right" && "text-right")}>
                  {col.key ? (
                    <button
                      type="button"
                      onClick={() => ordenarPor(col.key as SortField)}
                      className="hover:text-foreground inline-flex items-center gap-1"
                    >
                      {col.label}
                      {sortActual === col.key ? (
                        dirActual === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-state={seleccion.has(row.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={seleccion.has(row.id)}
                    onCheckedChange={() => alternarUno(row.id)}
                    aria-label={`Seleccionar ${row.sku}`}
                  />
                </TableCell>

                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <Link href={`/admin/inventory/${row.id}`} className="hover:underline">
                    {row.sku}
                  </Link>
                </TableCell>

                <TableCell className="min-w-[14rem]">
                  <Link href={`/admin/inventory/${row.id}`} className="hover:underline">
                    {row.title}
                  </Link>
                </TableCell>

                <TableCell className="whitespace-nowrap">{row.grade}</TableCell>

                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="secondary" className="font-normal">
                      {t(`status.${row.status}`)}
                    </Badge>
                    {row.ownerType === "consignment" && (
                      <Badge variant="outline" className="font-normal">
                        {t("owner.consignment")}
                      </Badge>
                    )}
                    {row.quantity > 1 && (
                      <Badge variant="outline" className="font-normal tabular-nums">
                        ×{row.quantity}
                      </Badge>
                    )}
                  </div>
                </TableCell>

                {canSeeCosts && (
                  <TableCell className="text-right">
                    <MoneyText value={row.cost} />
                  </TableCell>
                )}

                <TableCell className="text-right">
                  <MoneyText value={row.market} />
                </TableCell>

                <TableCell className="text-right">
                  <MoneyText value={row.list} />
                </TableCell>

                {canSeeCosts && (
                  <TableCell className="text-right">
                    <MoneyText value={row.gain} signed />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BulkActions
        selected={[...seleccion]}
        onClear={() => setSeleccion(new Set())}
        onDone={() => {
          setSeleccion(new Set());
          router.refresh();
        }}
      />
    </>
  );
}
