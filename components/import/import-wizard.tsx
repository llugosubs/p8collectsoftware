"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Link2,
  Loader2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  analyzeImportFile,
  commitImport,
  importFromGoogleSheet,
  listImportTemplates,
  previewImport,
  revertImportBatch,
  saveImportTemplate,
  touchImportTemplate,
  type AnalyzeResult,
  type CommitResult,
  type ImportTemplate,
  type PreviewResult,
} from "@/app/(admin)/admin/import/actions";
import { PhotoSource } from "@/components/import/photo-source";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  IMPORT_FIELDS,
  mappingFromTemplate,
  mappingToHeaders,
} from "@/lib/domain/import/columns";
import type { ImportPlan, RowState } from "@/lib/domain/import/plan";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * El wizard de importación, en cuatro pasos (§7.12).
 *
 * El archivo viaja DIRECTO al bucket con la sesión del usuario, igual que las
 * fotos: el cuerpo de un Server Action son 1 MB y un Excel de doscientas filas
 * con formato no cabe.
 *
 * Y una regla que ordena toda la pantalla: aquí no se calcula ni un monto. El
 * servidor vuelve a leer el archivo en cada paso y recalcula el plan; de esta
 * pantalla solo salen DECISIONES —qué hoja, qué mapeo, qué filas se excluyen—
 * porque un Server Action es un endpoint público y un costo que llegue del
 * navegador es un costo que cualquiera con sesión puede escribir.
 */

type Analisis = Extract<AnalyzeResult, { ok: true }>;
type Preview = Extract<PreviewResult, { ok: true }>;
type Reporte = Extract<CommitResult, { ok: true }>;

const ESTADO_TONO: Record<RowState, string> = {
  new: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  update_existing: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  duplicate_in_file: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  duplicate_in_db: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
};

export function ImportWizard({ visionEnabled }: { visionEnabled: boolean }) {
  const t = useTranslations("admin.import");
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);
  const [subiendo, setSubiendo] = useState(false);

  const [archivo, setArchivo] = useState<{ path: string; name: string } | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reporte, setReporte] = useState<Reporte | null>(null);

  const [decimalConvention, setDecimal] = useState<"es" | "us" | undefined>(undefined);
  const [dateConvention, setDate] = useState<"dmy" | "mdy" | undefined>(undefined);
  const [excluidas, setExcluidas] = useState<number[]>([]);
  const [actualizar, setActualizar] = useState<number[]>([]);
  const [nombrePlantilla, setNombrePlantilla] = useState("");
  const [plantillas, setPlantillas] = useState<ImportTemplate[]>([]);
  const [enlaceHoja, setEnlaceHoja] = useState("");

  useEffect(() => {
    void listImportTemplates().then(setPlantillas);
  }, []);

  /**
   * Aplicar una plantilla guardada.
   *
   * El mapeo se guarda por ENCABEZADO, así que se reaplica contra los
   * encabezados de HOY. Si el dueño insertó una columna esta semana, el campo
   * sigue cayendo donde debe; y si un encabezado de la plantilla ya no está en
   * el archivo, se dice — callarlo dejaría un costo del lote en cero sin que
   * nadie se entere.
   */
  function aplicarPlantilla(id: string) {
    const plantilla = plantillas.find((p) => p.id === id);
    if (plantilla === undefined || analisis === null) return;

    const { mapping: nuevo, missingHeaders } = mappingFromTemplate(
      analisis.columns,
      plantilla.mapping,
    );
    setMapping(nuevo);
    if (plantilla.decimalConvention) setDecimal(plantilla.decimalConvention);

    if (missingHeaders.length > 0) {
      toast.warning(t("map.templateMissing", { headers: missingHeaders.join(", ") }));
    } else {
      toast.success(t("map.templateApplied", { name: plantilla.name }));
    }
    void touchImportTemplate(id);
  }

  function lectura() {
    return {
      storagePath: archivo?.path ?? "",
      sheetName: analisis?.sheetName,
      headerRow: analisis?.headerRow ?? 0,
      mapping,
      decimalConvention,
      dateConvention,
      excludedRowNumbers: excluidas,
      updateRowNumbers: actualizar,
    };
  }

  // --- Paso 1: subir ---------------------------------------------------------
  async function subir(file: File) {
    setSubiendo(true);
    try {
      const supabase = createClient();
      const limpio = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
      const path = `imports/${crypto.randomUUID()}-${limpio}`;

      const { error } = await supabase.storage.from("docs").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

      if (error) {
        // El 42501 de storage es el RLS diciendo que este rol no puede.
        toast.error(/42501|policy/i.test(error.message) ? t("errors.FORBIDDEN") : error.message);
        return;
      }

      const resultado = await analyzeImportFile({ storagePath: path });
      aplicarAnalisis(resultado, file.name);
    } finally {
      setSubiendo(false);
    }
  }

  /** El paso 2 es el mismo venga de un Excel, de un CSV o de una hoja de Google. */
  function aplicarAnalisis(resultado: AnalyzeResult, name: string): boolean {
    if (!resultado.ok) {
      toast.error(
        t.has(`errors.${resultado.reason}`)
          ? t(`errors.${resultado.reason}`)
          : (resultado.detail ?? resultado.reason),
      );
      return false;
    }

    setArchivo({ path: resultado.storagePath, name });
    setAnalisis(resultado);
    setMapping(
      Object.fromEntries(
        resultado.columns.filter((c) => c.field !== null).map((c) => [String(c.index), c.field!]),
      ),
    );
    setPaso(2);
    return true;
  }

  function traerHoja() {
    if (enlaceHoja.trim() === "") return;
    setSubiendo(true);
    startTransition(async () => {
      try {
        // La ruta viene de vuelta dentro del análisis: el CSV ya quedó en el
        // bucket, así que de aquí en adelante es un archivo como cualquier otro.
        const resultado = await importFromGoogleSheet({ url: enlaceHoja });
        aplicarAnalisis(resultado, "Google Sheets");
      } finally {
        setSubiendo(false);
      }
    });
  }

  // --- Paso 2 → 3: validar ---------------------------------------------------
  function validar() {
    startTransition(async () => {
      const resultado = await previewImport(lectura());
      if (!resultado.ok) {
        toast.error(resultado.detail ?? resultado.reason);
        return;
      }
      setPreview(resultado);
      setPaso(3);
    });
  }

  // --- Paso 4: confirmar -----------------------------------------------------
  function confirmar() {
    startTransition(async () => {
      const resultado = await commitImport({ ...lectura(), fileName: archivo?.name ?? "archivo" });
      if (!resultado.ok) {
        toast.error(resultado.detail ?? resultado.reason);
        return;
      }
      setReporte(resultado);
      setPaso(4);
      router.refresh();
    });
  }

  function guardarPlantilla() {
    if (nombrePlantilla.trim() === "" || analisis === null) return;
    startTransition(async () => {
      const resultado = await saveImportTemplate({
        name: nombrePlantilla,
        // Por encabezado, no por posición: es lo que hace que la plantilla
        // siga sirviendo cuando el archivo de la semana que viene cambie.
        mapping: mappingToHeaders(analisis.columns, mapping),
        decimalConvention,
      });
      if (!resultado.ok) {
        toast.error(
          resultado.reason === "DUPLICATE_NAME" ? t("errors.DUPLICATE_NAME") : t("errors.SAVE_FAILED"),
        );
        return;
      }
      toast.success(t("templateSaved"));
      setNombrePlantilla("");
      void listImportTemplates().then(setPlantillas);
    });
  }

  function revertir(batchId: string) {
    startTransition(async () => {
      const resultado = await revertImportBatch(batchId);
      if (!resultado.ok) {
        // El mensaje de la función lista las piezas que lo impiden, una por
        // línea: se muestra tal cual, porque cada línea dice qué carta y por qué.
        toast.error(resultado.detail ?? t("errors.REVERT_BLOCKED"), { duration: 12_000 });
        return;
      }
      toast.success(t("reverted", { items: resultado.itemsDeleted }));
      setPaso(1);
      setReporte(null);
      setPreview(null);
      setAnalisis(null);
      setArchivo(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Pasos actual={paso} />

      {paso === 1 && (
        <PasoSubir
          subiendo={subiendo}
          onFile={subir}
          enlaceHoja={enlaceHoja}
          onEnlace={setEnlaceHoja}
          onTraerHoja={traerHoja}
          visionEnabled={visionEnabled}
          onAnalyzed={aplicarAnalisis}
        />
      )}

      {paso === 2 && analisis !== null && (
        <PasoMapear
          analisis={analisis}
          mapping={mapping}
          onChange={setMapping}
          plantillas={plantillas}
          onAplicarPlantilla={aplicarPlantilla}
          nombrePlantilla={nombrePlantilla}
          onNombre={setNombrePlantilla}
          onGuardar={guardarPlantilla}
          onAtras={() => setPaso(1)}
          onSiguiente={validar}
          pendiente={pendiente}
        />
      )}

      {paso === 3 && preview !== null && (
        <PasoValidar
          preview={preview}
          excluidas={excluidas}
          actualizar={actualizar}
          onExcluir={setExcluidas}
          onActualizar={setActualizar}
          decimalConvention={decimalConvention ?? preview.decimalConvention}
          dateConvention={dateConvention ?? preview.dateConvention}
          onDecimal={setDecimal}
          onDate={setDate}
          onRevalidar={validar}
          onAtras={() => setPaso(2)}
          onConfirmar={confirmar}
          pendiente={pendiente}
        />
      )}

      {paso === 4 && reporte !== null && (
        <PasoReporte reporte={reporte} onRevertir={revertir} pendiente={pendiente} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Pasos({ actual }: { actual: number }) {
  const t = useTranslations("admin.import.steps");
  const nombres = ["upload", "map", "validate", "confirm"] as const;

  return (
    <ol className="flex items-center gap-2 overflow-x-auto text-sm">
      {nombres.map((nombre, i) => {
        const numero = i + 1;
        const hecho = numero < actual;
        const activo = numero === actual;
        return (
          <li key={nombre} className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs",
                activo && "border-primary bg-primary text-primary-foreground",
                hecho && "border-primary/40 text-primary",
                !activo && !hecho && "border-border text-muted-foreground",
              )}
            >
              {numero}
            </span>
            <span className={cn(activo ? "font-medium" : "text-muted-foreground")}>
              {t(nombre)}
            </span>
            {numero < 4 && <span className="text-muted-foreground/40 px-1">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function PasoSubir({
  subiendo,
  onFile,
  enlaceHoja,
  onEnlace,
  onTraerHoja,
  visionEnabled,
  onAnalyzed,
}: {
  subiendo: boolean;
  onFile: (file: File) => void;
  enlaceHoja: string;
  onEnlace: (v: string) => void;
  onTraerHoja: () => void;
  visionEnabled: boolean;
  onAnalyzed: (resultado: AnalyzeResult, nombre: string) => void;
}) {
  const t = useTranslations("admin.import");

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium">{t("upload.title")}</h2>
          <p className="text-muted-foreground text-sm">{t("upload.hint")}</p>
        </div>

        <label
          className={cn(
            "border-border hover:border-primary/50 flex cursor-pointer flex-col items-center gap-3",
            "rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          )}
        >
          {subiendo ? (
            <Loader2 className="text-muted-foreground size-8 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="text-muted-foreground size-8" aria-hidden />
          )}
          <span className="text-sm font-medium">
            {subiendo ? t("upload.working") : t("upload.pick")}
          </span>
          <span className="text-muted-foreground text-xs">{t("upload.formats")}</span>
          <input
            type="file"
            className="sr-only"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={subiendo}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
        </label>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {t("upload.or")}
            </span>
            <span className="bg-border h-px flex-1" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="enlace-hoja" className="flex items-center gap-1.5">
              <Link2 className="size-4" aria-hidden />
              {t("upload.sheetLink")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="enlace-hoja"
                value={enlaceHoja}
                onChange={(e) => onEnlace(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                disabled={subiendo}
              />
              <Button
                type="button"
                variant="outline"
                onClick={onTraerHoja}
                disabled={subiendo || enlaceHoja.trim() === ""}
              >
                {t("upload.fetchSheet")}
              </Button>
            </div>
            <p className="text-muted-foreground/70 text-xs">{t("upload.sheetHint")}</p>
          </div>

          <PhotoSource enabled={visionEnabled} onAnalyzed={onAnalyzed} />
        </div>

        <div className="space-y-2">
          <Link
            href="/admin/import/template.xlsx"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          >
            <Download className="size-4" aria-hidden />
            {t("upload.template")}
          </Link>

          <div>
            <Link
              href="/admin/import/inventory.xlsx"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
            >
              <Download className="size-4" aria-hidden />
              {t("upload.roundtrip")}
            </Link>
            <p className="text-muted-foreground/70 pl-[1.375rem] text-xs">
              {t("upload.roundtripHint")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PasoMapear({
  analisis,
  mapping,
  onChange,
  plantillas,
  onAplicarPlantilla,
  nombrePlantilla,
  onNombre,
  onGuardar,
  onAtras,
  onSiguiente,
  pendiente,
}: {
  analisis: Analisis;
  mapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
  plantillas: readonly ImportTemplate[];
  onAplicarPlantilla: (id: string) => void;
  nombrePlantilla: string;
  onNombre: (v: string) => void;
  onGuardar: () => void;
  onAtras: () => void;
  onSiguiente: () => void;
  pendiente: boolean;
}) {
  const t = useTranslations("admin.import");
  const tc = useTranslations("admin.import.fields");

  const usados = new Set(Object.values(mapping));

  function cambiar(index: number, field: string) {
    const copia = { ...mapping };
    if (field === "") delete copia[String(index)];
    else {
      // Un campo no puede quedar en dos columnas: repartir el mismo dato en dos
      // sitios deja la mitad de las cartas sin él.
      for (const [k, v] of Object.entries(copia)) if (v === field) delete copia[k];
      copia[String(index)] = field;
    }
    onChange(copia);
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium">{t("map.title")}</h2>
          <p className="text-muted-foreground text-sm">{t("map.hint")}</p>
        </div>

        {plantillas.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="usar-plantilla">{t("map.useTemplate")}</Label>
            <select
              id="usar-plantilla"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value !== "") onAplicarPlantilla(e.target.value);
              }}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="">{t("map.useTemplatePick")}</option>
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {analisis.truncated && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("map.truncated")}
          </p>
        )}

        <div className="divide-border divide-y rounded-md border">
          {analisis.columns.map((columna) => {
            const valor = mapping[String(columna.index)] ?? "";
            return (
              <div
                key={columna.index}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{columna.header || "—"}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {analisis.sample[1]?.[columna.index] || t("map.noSample")}
                  </p>
                </div>
                <select
                  value={valor}
                  onChange={(e) => cambiar(columna.index, e.target.value)}
                  className={cn(
                    "border-input bg-background h-9 rounded-md border px-2 text-sm sm:w-56",
                    valor === "" && "text-muted-foreground",
                  )}
                  aria-label={t("map.fieldFor", { header: columna.header || "—" })}
                >
                  <option value="">{t("map.ignore")}</option>
                  {IMPORT_FIELDS.map((field) => (
                    <option key={field} value={field} disabled={usados.has(field) && valor !== field}>
                      {tc(field)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="plantilla">{t("map.saveAs")}</Label>
            <Input
              id="plantilla"
              value={nombrePlantilla}
              onChange={(e) => onNombre(e.target.value)}
              placeholder={t("map.savePlaceholder")}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onGuardar}
            disabled={pendiente || nombrePlantilla.trim() === ""}
          >
            {t("map.save")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={onAtras}>
            <ArrowLeft className="size-4" aria-hidden />
            {t("back")}
          </Button>
          <Button type="button" onClick={onSiguiente} disabled={pendiente}>
            {pendiente && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("map.next")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PasoValidar({
  preview,
  excluidas,
  actualizar,
  onExcluir,
  onActualizar,
  decimalConvention,
  dateConvention,
  onDecimal,
  onDate,
  onRevalidar,
  onAtras,
  onConfirmar,
  pendiente,
}: {
  preview: Preview;
  excluidas: number[];
  actualizar: number[];
  onExcluir: (v: number[]) => void;
  onActualizar: (v: number[]) => void;
  decimalConvention: "es" | "us";
  dateConvention: "dmy" | "mdy";
  onDecimal: (v: "es" | "us") => void;
  onDate: (v: "dmy" | "mdy") => void;
  onRevalidar: () => void;
  onAtras: () => void;
  onConfirmar: () => void;
  pendiente: boolean;
}) {
  const t = useTranslations("admin.import");
  const plan: ImportPlan = preview.plan;

  const hayAmbiguedad =
    preview.ambiguousNumbers.length > 0 || preview.ambiguousDates.length > 0;

  function alternar(lista: number[], set: (v: number[]) => void, fila: number) {
    set(lista.includes(fila) ? lista.filter((n) => n !== fila) : [...lista, fila]);
  }

  return (
    <div className="space-y-5">
      {hayAmbiguedad && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-start gap-2 text-sm text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("validate.ambiguous")}
            </p>

            {preview.ambiguousNumbers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm">
                  {t("validate.numberSamples", { samples: preview.ambiguousNumbers.join(", ") })}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={decimalConvention === "es" ? "default" : "outline"}
                    onClick={() => onDecimal("es")}
                  >
                    {t("validate.decimalEs")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={decimalConvention === "us" ? "default" : "outline"}
                    onClick={() => onDecimal("us")}
                  >
                    {t("validate.decimalUs")}
                  </Button>
                </div>
              </div>
            )}

            {preview.ambiguousDates.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm">
                  {t("validate.dateSamples", { samples: preview.ambiguousDates.join(", ") })}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={dateConvention === "dmy" ? "default" : "outline"}
                    onClick={() => onDate("dmy")}
                  >
                    {t("validate.dateDmy")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={dateConvention === "mdy" ? "default" : "outline"}
                    onClick={() => onDate("mdy")}
                  >
                    {t("validate.dateMdy")}
                  </Button>
                </div>
              </div>
            )}

            <Button type="button" size="sm" variant="outline" onClick={onRevalidar}>
              {t("validate.reread")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-5">
          <Cifra etiqueta={t("validate.toCreate")} valor={plan.totals.rowsToCreate} />
          <Cifra etiqueta={t("validate.toUpdate")} valor={plan.totals.rowsToUpdate} />
          <Cifra etiqueta={t("validate.skipped")} valor={plan.totals.rowsSkipped} />
          <Cifra etiqueta={t("validate.errors")} valor={plan.totals.rowsWithError} />
          <Cifra etiqueta={t("validate.lots")} valor={plan.groups.length} />
        </CardContent>
      </Card>

      {plan.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {/* En móvil son tarjetas y no una tabla de 27 columnas: el error tiene
          que ser el titular, no una celda perdida a la derecha. */}
      <div className="space-y-2">
        {plan.rows.map((fila) => {
          const datos = preview.preview.find((p) => p.rowNumber === fila.rowNumber);
          return (
            <Card key={fila.rowNumber} className="overflow-hidden">
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                <span className="text-muted-foreground w-12 shrink-0 text-xs tabular-nums">
                  {t("validate.row", { n: fila.rowNumber })}
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium">
                    {datos?.name || t("validate.noName")}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {[datos?.purchasedAt, datos?.reference, datos?.hammerPrice]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {fila.errors.map((e) => (
                    <p key={e} className="text-xs text-red-400">
                      {e}
                    </p>
                  ))}
                  {datos?.duplicateSku && (
                    <p className="text-xs text-amber-400">
                      {t("validate.matches", { sku: datos.duplicateSku })}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={ESTADO_TONO[fila.state]}>
                    {t(`state.${fila.state}`)}
                  </Badge>

                  {fila.state === "new" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => alternar(excluidas, onExcluir, fila.rowNumber)}
                    >
                      {t("validate.exclude")}
                    </Button>
                  )}

                  {fila.duplicateOfItemId !== null && fila.state !== "error" && (
                    <Button
                      type="button"
                      size="sm"
                      variant={actualizar.includes(fila.rowNumber) ? "default" : "ghost"}
                      onClick={() => alternar(actualizar, onActualizar, fila.rowNumber)}
                    >
                      {t("validate.update")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onAtras}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Button>
        <div className="flex items-center gap-2">
          {(excluidas.length > 0 || actualizar.length > 0) && (
            <Button type="button" variant="outline" onClick={onRevalidar} disabled={pendiente}>
              {t("validate.reread")}
            </Button>
          )}
          <Button
            type="button"
            onClick={onConfirmar}
            disabled={pendiente || plan.totals.rowsToCreate + plan.totals.rowsToUpdate === 0}
          >
            {pendiente && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <Upload className="size-4" aria-hidden />
            {t("validate.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PasoReporte({
  reporte,
  onRevertir,
  pendiente,
}: {
  reporte: Reporte;
  onRevertir: (batchId: string) => void;
  pendiente: boolean;
}) {
  const t = useTranslations("admin.import");
  const router = useRouter();

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{t("report.title")}</h2>
            <p className="text-muted-foreground text-sm">{t("report.hint")}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Cifra etiqueta={t("report.created")} valor={reporte.rowsCreated} />
          <Cifra etiqueta={t("report.updated")} valor={reporte.rowsUpdated} />
          <Cifra etiqueta={t("report.lots")} valor={reporte.acquisitions} />
          <Cifra etiqueta={t("report.invested")} valor={`$ ${reporte.totalInvested}`} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => router.push("/admin/inventory")}>
            {t("report.goInventory")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onRevertir(reporte.batchId)}
            disabled={pendiente}
          >
            <Undo2 className="size-4" aria-hidden />
            {t("report.revert")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: number | string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{etiqueta}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
