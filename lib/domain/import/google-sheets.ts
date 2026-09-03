/**
 * Enlaces de Google Sheets.
 *
 * Esto existe por una razón de seguridad, no de comodidad: el servidor va a
 * hacer una petición HTTP a partir de algo que escribió el usuario, y eso es
 * SSRF de manual — un enlace apuntando a `http://169.254.169.254/` o a un
 * servicio interno saldría desde nuestra red, con nuestra identidad.
 *
 * La defensa no es una lista de hosts prohibidos ni un filtro de IP privadas.
 * Es más simple y más fuerte: **la URL del usuario nunca se pide**. De ella se
 * extraen dos cosas, un identificador y un número de hoja, y con esas dos el
 * servidor CONSTRUYE la única URL que puede pedir. No queda ni host, ni ruta,
 * ni query bajo control de quien pegó el enlace.
 */

/** El identificador de un documento de Sheets. */
const ID = /[a-zA-Z0-9_-]{20,120}/;

export type GoogleSheetRef = {
  id: string;
  /** La pestaña. `0` es la primera y es lo que Google usa por defecto. */
  gid: string;
};

/**
 * Saca el identificador y la pestaña de un enlace pegado.
 *
 * Acepta las formas en que la gente comparte de verdad: la URL de edición, la
 * de vista, la de publicación, con o sin `#gid=`, y el identificador pelado.
 * Devuelve null cuando no reconoce nada — no adivina.
 */
export function parseGoogleSheetUrl(input: string): GoogleSheetRef | null {
  const texto = input.trim();
  if (texto === "") return null;

  let id: string | null = null;

  const enRuta = new RegExp(`/spreadsheets/(?:d/)?(?:e/)?(${ID.source})`).exec(texto);
  if (enRuta) {
    id = enRuta[1] ?? null;
  } else if (new RegExp(`^${ID.source}$`).test(texto)) {
    // El identificador pelado, que es lo que queda al copiar de la barra.
    id = texto;
  }

  if (id === null) return null;

  // El gid puede venir en el fragmento (#gid=) o en la query (?gid=). Google
  // usa los dos según por dónde compartas.
  const gid = /[#?&]gid=(\d{1,20})/.exec(texto)?.[1] ?? "0";

  return { id, gid };
}

/** El host —el único— del que se baja una hoja. */
export const GOOGLE_SHEETS_HOST = "docs.google.com";

/**
 * Google responde la descarga con una redirección a su CDN de contenido. Es el
 * único otro host que se admite, y solo como destino de un salto.
 */
export const GOOGLE_REDIRECT_HOSTS: readonly string[] = [
  "docs.google.com",
  "doc-0s-0c-sheets.googleusercontent.com",
  "googleusercontent.com",
];

export function isAllowedGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === GOOGLE_SHEETS_HOST ||
    host === "googleusercontent.com" ||
    host.endsWith(".googleusercontent.com")
  );
}

/**
 * La URL que el servidor SÍ pide. Se arma aquí, con partes ya validadas.
 *
 * `format=csv` en vez de `format=xlsx` a propósito: el CSV es una sola pestaña
 * y un solo formato, sin macros ni fórmulas ni objetos incrustados. Bajar un
 * .xlsx generado por un tercero para parsearlo es una superficie de ataque que
 * no hace falta abrir.
 */
export function buildSheetCsvUrl(ref: GoogleSheetRef): string {
  const url = new URL(`https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${ref.id}/export`);
  url.searchParams.set("format", "csv");
  url.searchParams.set("gid", ref.gid);
  return url.toString();
}

/**
 * ¿Lo que volvió es de verdad un CSV?
 *
 * Cuando la hoja NO está compartida, Google no da 403: da 200 con la página de
 * inicio de sesión en HTML. Sin esta comprobación, el parser trataría de leer
 * un documento de Google como si fuera una tabla y el dueño recibiría un error
 * incomprensible en vez de "comparte la hoja".
 */
export function looksLikeLoginPage(contentType: string | null, primerosBytes: string): boolean {
  if (contentType !== null && /text\/html/i.test(contentType)) return true;
  const cabeza = primerosBytes.slice(0, 400).toLowerCase();
  return cabeza.includes("<!doctype html") || cabeza.includes("<html");
}
