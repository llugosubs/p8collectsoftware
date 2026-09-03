"use client";

import { useTranslations } from "next-intl";
import { Camera, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { extractFromPhotos, type AnalyzeResult } from "@/app/(admin)/admin/import/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImagePrepError, prepareImage, VISION_MAX_EDGE_PX } from "@/lib/inventory/image";
import { createClient } from "@/lib/supabase/client";
import { ACQUISITION_PLATFORMS } from "@/lib/validations/purchases";
import { cn } from "@/lib/utils";

/**
 * Importar por foto.
 *
 * Lo que la foto puede decir y lo que no está separado a propósito. De la
 * etiqueta sale la carta: jugador, set, gradadora, grado, cert. De la cabecera
 * del lote —plataforma, fecha, referencia, comisión, envío, aduana— no sale
 * NADA, porque ninguna foto de una carta sabe en qué subasta se compró ni
 * cuánto costó el courier. Eso lo escribe el dueño una vez, arriba.
 *
 * No es una separación cosmética: los costos comunes se untan sobre todas las
 * piezas del lote en proporción al martillo, así que un dígito mal leído en la
 * aduana se reparte entre las quince cartas y no se ve en ninguna. Un dígito
 * mal leído en el nombre de la carta se ve al lado del nombre.
 *
 * La foto se reduce y se le quita el EXIF ANTES de subir. Aunque el bucket sea
 * privado, el EXIF de una foto tomada en casa lleva la dirección del dueño, y
 * esa imagen va a salir hacia un tercero.
 */

const HOY = () => new Date().toISOString().slice(0, 10);

export function PhotoSource({
  enabled,
  onAnalyzed,
}: {
  enabled: boolean;
  onAnalyzed: (resultado: AnalyzeResult, nombre: string) => void;
}) {
  const t = useTranslations("admin.import.photo");
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [rutas, setRutas] = useState<{ path: string; nombre: string }[]>([]);
  const [modo, setModo] = useState<"slab" | "lista">("slab");

  const [platform, setPlatform] = useState<string>("alt");
  const [purchasedAt, setPurchasedAt] = useState(HOY);
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState(true);
  const [shippingIntl, setShipping] = useState("");
  const [buyerPremium, setPremium] = useState("");

  const inputCamara = useRef<HTMLInputElement>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  if (!enabled) {
    return (
      <div className="border-border/60 text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4" aria-hidden />
          {t("title")}
        </p>
        <p className="mt-1 text-xs">{t("disabled")}</p>
      </div>
    );
  }

  async function agregarFoto(file: File) {
    setSubiendo(true);
    try {
      // Se reduce a 1568 px: por encima el modelo no lee mejor la etiqueta y
      // solo se pagan más tokens; por debajo se pierden los dígitos del cert.
      const preparada = await prepareImage(file, VISION_MAX_EDGE_PX);
      const path = `imports/photos/${crypto.randomUUID()}.webp`;

      const supabase = createClient();
      const { error } = await supabase.storage.from("docs").upload(path, preparada.blob, {
        contentType: "image/webp",
        upsert: false,
      });

      if (error) {
        toast.error(/42501|policy/i.test(error.message) ? t("forbidden") : error.message);
        return;
      }

      setRutas((previas) => [...previas, { path, nombre: file.name }]);
    } catch (error) {
      toast.error(error instanceof ImagePrepError ? t("badImage") : t("uploadFailed"));
    } finally {
      setSubiendo(false);
    }
  }

  function leer() {
    if (rutas.length === 0) return;
    startTransition(async () => {
      const resultado = await extractFromPhotos({
        storagePaths: rutas.map((r) => r.path),
        mode: modo,
        lote: {
          platform,
          purchasedAt,
          reference: reference.trim() || undefined,
          received,
          shippingIntl: shippingIntl.trim() || undefined,
          buyerPremium: buyerPremium.trim() || undefined,
        },
      });
      onAnalyzed(resultado, t("sheetName"));
    });
  }

  if (!abierto) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setAbierto(true)}>
        <Sparkles className="size-4" aria-hidden />
        {t("open")}
      </Button>
    );
  }

  return (
    <div className="border-border space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" aria-hidden />
            {t("title")}
          </p>
          <p className="text-muted-foreground text-xs">{t("hint")}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {/* La cabecera del lote. Ninguna foto sabe esto. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="foto-plataforma">{t("platform")}</Label>
          <select
            id="foto-plataforma"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            {ACQUISITION_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="foto-fecha">{t("purchasedAt")}</Label>
          <Input
            id="foto-fecha"
            type="date"
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="foto-referencia">{t("reference")}</Label>
          <Input
            id="foto-referencia"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="ALT-2026-33"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="foto-envio">{t("shipping")}</Label>
          <Input
            id="foto-envio"
            inputMode="decimal"
            value={shippingIntl}
            onChange={(e) => setShipping(e.target.value)}
            placeholder="45,00"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="foto-premium">{t("premium")}</Label>
          <Input
            id="foto-premium"
            inputMode="decimal"
            value={buyerPremium}
            onChange={(e) => setPremium(e.target.value)}
            placeholder="150,00"
          />
        </div>

        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={received}
            onChange={(e) => setReceived(e.target.checked)}
            className="size-4"
          />
          {t("received")}
        </label>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={modo === "slab" ? "default" : "outline"}
          onClick={() => setModo("slab")}
        >
          {t("modeSlab")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={modo === "lista" ? "default" : "outline"}
          onClick={() => setModo("lista")}
        >
          {t("modeList")}
        </Button>
      </div>

      {rutas.length > 0 && (
        <ul className="text-muted-foreground space-y-1 text-xs">
          {rutas.map((r) => (
            <li key={r.path} className="truncate">
              · {r.nombre}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={subiendo || rutas.length >= 4}
          onClick={() => inputCamara.current?.click()}
        >
          {subiendo ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-4" aria-hidden />
          )}
          {t("takePhoto")}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={subiendo || rutas.length >= 4}
          onClick={() => inputArchivo.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden />
          {t("pickPhoto")}
        </Button>

        <Button
          type="button"
          size="sm"
          disabled={pendiente || subiendo || rutas.length === 0}
          onClick={leer}
          className={cn(rutas.length === 0 && "opacity-60")}
        >
          {pendiente && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("read", { n: rutas.length })}
        </Button>
      </div>

      <p className="text-muted-foreground/70 text-xs">{t("alwaysReviewed")}</p>

      <input
        ref={inputCamara}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void agregarFoto(file);
          e.target.value = "";
        }}
      />
      <input
        ref={inputArchivo}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void agregarFoto(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
