/**
 * Preparación de una foto ANTES de subirla, en el navegador.
 *
 * Hace tres cosas, y las tres importan:
 *
 * 1. **Reduce.** Una foto de un iPhone son 4 MB y 4000 px de lado. El bucket
 *    admite hasta 10 MB, pero subir eso por datos móviles desde Caracas es una
 *    espera larga, y las transformaciones de Supabase que servirían una versión
 *    pequeña son de plan Pro. Se recorta aquí, una vez.
 *
 * 2. **Quita los metadatos.** Volver a codificar desde un canvas descarta el
 *    EXIF entero — incluida la GEOLOCALIZACIÓN, que en una foto tomada en casa
 *    es la dirección del dueño, y que iría a un bucket PÚBLICO.
 *
 * 3. **Respeta la orientación.** Como el EXIF se pierde, la rotación hay que
 *    aplicarla antes de dibujar; si no, las fotos tomadas de lado quedarían
 *    acostadas para siempre.
 */

export const MAX_EDGE_PX = 2000;
export const OUTPUT_TYPE = "image/webp";
export const OUTPUT_QUALITY = 0.85;
/** Tope del bucket `cards`. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type PreparedImage = { blob: Blob; width: number; height: number };

export class ImagePrepError extends Error {
  constructor(public readonly code: "NOT_AN_IMAGE" | "DECODE_FAILED" | "TOO_LARGE") {
    super(code);
    this.name = "ImagePrepError";
  }
}

/** Escala manteniendo proporción, sin agrandar nunca. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE_PX,
): { width: number; height: number } {
  const mayor = Math.max(width, height);
  if (mayor <= maxEdge) return { width, height };
  const factor = maxEdge / mayor;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new ImagePrepError("NOT_AN_IMAGE");

  let bitmap: ImageBitmap;
  try {
    // `from-image` aplica la rotación del EXIF antes de que la perdamos.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImagePrepError("DECODE_FAILED");
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ImagePrepError("DECODE_FAILED");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY),
  );

  if (!blob) throw new ImagePrepError("DECODE_FAILED");
  if (blob.size > MAX_UPLOAD_BYTES) throw new ImagePrepError("TOO_LARGE");

  return { blob, width, height };
}
