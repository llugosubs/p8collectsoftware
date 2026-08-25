"use client";

import { useTranslations } from "next-intl";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteItemImage, registerItemImage } from "@/app/(admin)/admin/inventory/actions";
import { Button } from "@/components/ui/button";
import { ImagePrepError, OUTPUT_TYPE, prepareImage } from "@/lib/inventory/image";
import { createClient } from "@/lib/supabase/client";

export type ItemPhoto = { id: string; url: string; kind: string };

/**
 * Subida de fotos desde el teléfono.
 *
 * El archivo va DIRECTO del navegador al bucket, con la sesión del usuario: el
 * RLS de storage decide si puede. No pasa por un Server Action porque el cuerpo
 * de uno son 1 MB y una foto de teléfono no cabe.
 *
 * Antes de subir, la imagen se reduce y se le quitan los metadatos — el EXIF de
 * una foto tomada en casa lleva la dirección del dueño, y el bucket es público.
 */
export function PhotoUploader({
  itemId,
  photos,
  canEdit,
}: {
  itemId: string;
  photos: readonly ItemPhoto[];
  canEdit: boolean;
}) {
  const t = useTranslations("admin.inventory.photos");
  const [isPending, startTransition] = useTransition();
  const [estado, setEstado] = useState<"idle" | "preparing" | "uploading">("idle");
  const inputCamara = useRef<HTMLInputElement>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  function traducirError(code: string) {
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.UPLOAD_FAILED");
  }

  async function subir(file: File) {
    setEstado("preparing");
    try {
      const { blob } = await prepareImage(file);

      setEstado("uploading");
      const supabase = createClient();
      const nombre = `${crypto.randomUUID()}.webp`;
      const ruta = `${itemId}/${nombre}`;

      const { error } = await supabase.storage
        .from("cards")
        .upload(ruta, blob, { contentType: OUTPUT_TYPE, upsert: false });

      if (error) {
        // El 42501 de storage es el RLS diciendo que este rol no puede.
        const esPermiso = /row-level security|Unauthorized|403/i.test(error.message);
        toast.error(traducirError(esPermiso ? "FORBIDDEN" : "UPLOAD_FAILED"));
        return;
      }

      const result = await registerItemImage({ itemId, storagePath: ruta, kind: "front" });
      if (!result.ok) {
        // La fila no se pudo crear: se quita el archivo para no dejar huérfanos.
        await supabase.storage.from("cards").remove([ruta]);
        toast.error(traducirError(result.reason));
        return;
      }

      toast.success(t("uploaded"));
    } catch (error) {
      toast.error(traducirError(error instanceof ImagePrepError ? error.code : "UPLOAD_FAILED"));
    } finally {
      setEstado("idle");
    }
  }

  function alElegir(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    startTransition(() => {
      void subir(file);
    });
  }

  function borrar(imageId: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      const result = await deleteItemImage({ imageId });
      if (result.ok) toast.success(t("deleted"));
      else toast.error(traducirError(result.reason));
    });
  }

  const ocupado = isPending || estado !== "idle";

  return (
    <div className="space-y-3">
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {photos.map((photo) => (
            <li key={photo.id} className="group relative">
              <div className="border-border bg-muted relative aspect-[5/7] overflow-hidden rounded border">
                <Image
                  src={photo.url}
                  alt={t(`kind.${photo.kind}`)}
                  fill
                  sizes="(min-width: 1024px) 10rem, 45vw"
                  className="object-cover"
                />
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => borrar(photo.id)}
                  disabled={ocupado}
                  aria-label={t("delete")}
                  className="bg-background/90 text-muted-foreground hover:text-destructive absolute top-1.5 right-1.5 rounded p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {/* `capture` abre la cámara directamente en el teléfono, que es como
              se fotografía una carta que tienes en la mano. */}
          <input
            ref={inputCamara}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={alElegir}
          />
          <input
            ref={inputArchivo}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={alElegir}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={() => inputCamara.current?.click()}
            className="sm:hidden"
          >
            {ocupado ? (
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
            disabled={ocupado}
            onClick={() => inputArchivo.current?.click()}
          >
            {ocupado ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
            {estado === "preparing"
              ? t("preparing")
              : estado === "uploading"
                ? t("uploading")
                : t("add")}
          </Button>
        </div>
      )}
    </div>
  );
}
