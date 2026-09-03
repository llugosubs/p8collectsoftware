import {
  buildSheetCsvUrl,
  isAllowedGoogleHost,
  looksLikeLoginPage,
  parseGoogleSheetUrl,
} from "@/lib/domain/import/google-sheets";

/**
 * Bajar una hoja de Google, con la correa corta.
 *
 * Que el servidor haga una petición HTTP a partir de algo que escribió el
 * usuario es SSRF. La primera defensa está en `google-sheets.ts`: la URL del
 * usuario nunca se pide, se construye una nueva desde dos cadenas validadas.
 * Aquí van las otras cuatro:
 *
 *   · Las redirecciones se siguen A MANO, comprobando el host en CADA salto.
 *     Con `redirect: "follow"` solo se ve el destino final, y un salto
 *     intermedio hacia la red interna pasaría sin que nadie lo mire.
 *   · Tope de saltos, para que una cadena infinita no ate el proceso.
 *   · Tope de tiempo, porque un servidor que acepta la conexión y no responde
 *     nunca es la forma más barata de tumbar un servidor.
 *   · Tope de bytes mientras se lee, no después: comprobar el tamaño al final
 *     es comprobarlo cuando ya está en memoria.
 */

export class SheetFetchError extends Error {
  constructor(
    public readonly code:
      | "NOT_A_SHEET"
      | "NOT_SHARED"
      | "NOT_FOUND"
      | "TOO_LARGE"
      | "TIMEOUT"
      | "UNREACHABLE",
    message: string,
  ) {
    super(message);
    this.name = "SheetFetchError";
  }
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 15_000;

async function leerConTope(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) return "";

  const reader = body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      total += value.byteLength;
      if (total > MAX_BYTES) {
        // Se corta la lectura en el momento, no al final: comprobar el tamaño
        // después es comprobarlo cuando ya está en memoria.
        await reader.cancel();
        throw new SheetFetchError("TOO_LARGE", "La hoja pesa más de 8 MB.");
      }
      trozos.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const todo = new Uint8Array(total);
  let offset = 0;
  for (const trozo of trozos) {
    todo.set(trozo, offset);
    offset += trozo.byteLength;
  }

  return new TextDecoder("utf-8").decode(todo);
}

export type SheetDownload = { csv: string; sheetId: string; gid: string };

export async function downloadGoogleSheetCsv(enlace: string): Promise<SheetDownload> {
  const ref = parseGoogleSheetUrl(enlace);
  if (ref === null) {
    throw new SheetFetchError(
      "NOT_A_SHEET",
      "Ese enlace no parece de Google Sheets. Copia la barra de direcciones con la hoja abierta.",
    );
  }

  let url = buildSheetCsvUrl(ref);
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    for (let salto = 0; salto <= MAX_REDIRECTS; salto += 1) {
      if (!isAllowedGoogleHost(new URL(url).hostname)) {
        throw new SheetFetchError("UNREACHABLE", "La descarga salió de Google. Se detuvo.");
      }

      let response: Response;
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal: controlador.signal,
          headers: { Accept: "text/csv,*/*" },
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new SheetFetchError("TIMEOUT", "Google no respondió a tiempo.");
        }
        throw new SheetFetchError("UNREACHABLE", "No se pudo contactar a Google.");
      }

      if (response.status >= 300 && response.status < 400) {
        const destino = response.headers.get("location");
        if (destino === null) {
          throw new SheetFetchError("UNREACHABLE", "Google redirigió a ninguna parte.");
        }
        url = new URL(destino, url).toString();
        continue;
      }

      if (response.status === 404) {
        throw new SheetFetchError("NOT_FOUND", "Esa hoja no existe o se borró.");
      }

      if (response.status === 401 || response.status === 403) {
        throw new SheetFetchError("NOT_SHARED", "La hoja no está compartida.");
      }

      if (!response.ok) {
        throw new SheetFetchError("UNREACHABLE", `Google respondió ${response.status}.`);
      }

      const texto = await leerConTope(response);

      // Una hoja privada no da 403: da 200 con la pantalla de acceso en HTML.
      if (looksLikeLoginPage(response.headers.get("content-type"), texto)) {
        throw new SheetFetchError("NOT_SHARED", "La hoja no está compartida.");
      }

      return { csv: texto, sheetId: ref.id, gid: ref.gid };
    }

    throw new SheetFetchError("UNREACHABLE", "Demasiadas redirecciones.");
  } finally {
    clearTimeout(reloj);
  }
}
