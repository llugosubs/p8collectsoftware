/**
 * Interpretación de números escritos como texto.
 *
 * Este archivo existe por un riesgo concreto: `1.234` significa mil doscientos
 * treinta y cuatro en Venezuela y uno coma doscientos treinta y cuatro en
 * Estados Unidos. Adivinar mal **multiplica un precio por mil**, y ese precio
 * entra al costo de una carta que después se vende.
 *
 * La regla, entonces, es no adivinar nunca por celda. Se decide la convención
 * mirando la COLUMNA COMPLETA: basta con que un solo valor sea inequívoco para
 * saber cómo leer los demás. Si la columna entera es ambigua, se pregunta.
 *
 * Las celdas que el .xlsx entrega ya como número no pasan por aquí: Excel
 * resolvió el idioma al guardarlas. Esto es solo para texto y para CSV.
 */

export type DecimalConvention = "es" | "us";

export type ConventionInference =
  | { convention: DecimalConvention; confident: true; evidence: string }
  | { convention: null; confident: false; ambiguousSamples: string[] };

export class NumberFormatError extends Error {
  constructor(
    public readonly code: "NOT_A_NUMBER" | "AMBIGUOUS" | "OUT_OF_RANGE",
    public readonly raw: string,
  ) {
    super(`${code}: ${raw}`);
    this.name = "NumberFormatError";
  }
}

/** `numeric(14,4)`: diez dígitos enteros y cuatro decimales, ni uno más. */
export const MAX_INTEGER_DIGITS = 10;
export const MAX_DECIMAL_DIGITS = 4;

/**
 * Quita todo lo que no es dígito ni separador: símbolos de moneda, espacios
 * duros, porcentajes. Los paréntesis marcan negativo en contabilidad.
 */
function limpiar(raw: string): { cuerpo: string; negativo: boolean } {
  let texto = raw.trim();
  let negativo = false;

  if (/^\(.*\)$/.test(texto)) {
    negativo = true;
    texto = texto.slice(1, -1).trim();
  }

  if (texto.startsWith("-")) {
    negativo = true;
    texto = texto.slice(1).trim();
  }

  // US$, $, Bs., Bs, %, espacios normales y duros, apóstrofo suizo de miles.
  texto = texto
    .replace(/^(US\$|\$|Bs\.?|VES|USD)\s*/i, "")
    .replace(/\s*(%|Bs\.?|USD|VES)$/i, "")
    .replace(/[\s  ']/g, "");

  return { cuerpo: texto, negativo };
}

/**
 * Un número con separador de miles tiene grupos de tres: `1.234.567`. Sin esta
 * comprobación, `1..2` contaría dos puntos y se leería como el número 12.
 */
function esAgrupacionValida(texto: string, separador: "." | ","): boolean {
  const escapado = separador === "." ? "\\." : ",";
  return new RegExp(`^\\d{1,3}(${escapado}\\d{3})+$`).test(texto);
}

type Forma =
  | { tipo: "entero" }
  | { tipo: "decimal"; separador: "." | "," }
  | { tipo: "miles"; separador: "." | "," }
  | { tipo: "ambos"; decimal: "." | "," }
  | { tipo: "ambiguo"; separador: "." | "," }
  | { tipo: "invalido" };

/** Qué forma tiene el texto, sin decidir todavía qué significa. */
function analizar(cuerpo: string): Forma {
  if (cuerpo === "" || !/^[\d.,]+$/.test(cuerpo)) return { tipo: "invalido" };

  const puntos = (cuerpo.match(/\./g) ?? []).length;
  const comas = (cuerpo.match(/,/g) ?? []).length;

  if (puntos === 0 && comas === 0) return { tipo: "entero" };

  // Los dos separadores presentes: el ÚLTIMO es el decimal. Aquí no hay
  // ambigüedad posible, y por eso una sola celda así resuelve la columna.
  if (puntos > 0 && comas > 0) {
    const decimal = cuerpo.lastIndexOf(".") > cuerpo.lastIndexOf(",") ? "." : ",";
    const miles = decimal === "." ? "," : ".";
    const corte = cuerpo.lastIndexOf(decimal);
    const entera = cuerpo.slice(0, corte);
    const fraccion = cuerpo.slice(corte + 1);

    // La parte entera tiene que estar bien agrupada y la decimal ser dígitos.
    if (!esAgrupacionValida(entera, miles) || !/^\d+$/.test(fraccion)) {
      return { tipo: "invalido" };
    }
    return { tipo: "ambos", decimal };
  }

  const separador: "." | "," = puntos > 0 ? "." : ",";
  const veces = puntos > 0 ? puntos : comas;

  // Repetido: solo puede ser separador de miles, y entonces los grupos tienen
  // que ser de tres. Sin esta comprobación, "1..2" se leería como 12.
  if (veces > 1) {
    return esAgrupacionValida(cuerpo, separador)
      ? { tipo: "miles", separador }
      : { tipo: "invalido" };
  }

  const partes = cuerpo.split(separador);
  const izquierda = partes[0] ?? "";
  const derecha = partes[1] ?? "";

  // Un separador suelto necesita dígitos a los dos lados: ".5" o "5." no son
  // números que alguien haya querido escribir.
  if (izquierda === "" || derecha === "") return { tipo: "invalido" };

  // Tres dígitos después y hasta tres antes: el caso ambiguo. "1.234" puede
  // ser mil doscientos treinta y cuatro o uno coma doscientos treinta y cuatro.
  if (derecha.length === 3 && izquierda.length <= 3) return { tipo: "ambiguo", separador };

  // Cualquier otra cantidad de decimales solo tiene sentido como decimal:
  // nadie agrupa miles de dos en dos ni de cuatro en cuatro.
  return { tipo: "decimal", separador };
}

/**
 * Deduce la convención de una columna entera.
 *
 * Basta un valor inequívoco para resolver toda la columna. Solo si TODOS son
 * ambiguos se devuelve `confident: false` y la interfaz pregunta.
 */
export function inferDecimalConvention(valores: readonly string[]): ConventionInference {
  const ambiguos: string[] = [];

  for (const valor of valores) {
    const { cuerpo } = limpiar(valor);
    if (cuerpo === "") continue;

    const forma = analizar(cuerpo);

    if (forma.tipo === "ambos") {
      return {
        convention: forma.decimal === "," ? "es" : "us",
        confident: true,
        evidence: valor,
      };
    }

    if (forma.tipo === "decimal") {
      return {
        convention: forma.separador === "," ? "es" : "us",
        confident: true,
        evidence: valor,
      };
    }

    if (forma.tipo === "miles") {
      // "1.234.567" en venezolano; "1,234,567" en gringo.
      return {
        convention: forma.separador === "." ? "es" : "us",
        confident: true,
        evidence: valor,
      };
    }

    if (forma.tipo === "ambiguo") ambiguos.push(valor);
  }

  if (ambiguos.length === 0) {
    // Solo enteros: cualquiera de las dos convenciones da el mismo número.
    return { convention: "es", confident: true, evidence: "solo enteros" };
  }

  return { convention: null, confident: false, ambiguousSamples: ambiguos.slice(0, 5) };
}

/**
 * Convierte a string decimal exacto, listo para `numeric(14,4)`.
 *
 * Devuelve un STRING, no un número: un `number` de JavaScript ya perdió
 * precisión antes de salir de esta función.
 */
export function parseDecimalText(raw: string, convention: DecimalConvention): string {
  const { cuerpo, negativo } = limpiar(raw);
  if (cuerpo === "") throw new NumberFormatError("NOT_A_NUMBER", raw);

  const forma = analizar(cuerpo);
  if (forma.tipo === "invalido") throw new NumberFormatError("NOT_A_NUMBER", raw);

  const separadorDecimal =
    forma.tipo === "ambos"
      ? forma.decimal
      : forma.tipo === "decimal"
        ? forma.separador
        : forma.tipo === "ambiguo"
          ? convention === "es"
            ? ","
            : "."
          : null;

  // El caso ambiguo se resuelve con la convención de la columna: si el
  // separador que trae NO es el decimal de esa convención, es de miles.
  let entera: string;
  let decimal = "";

  if (separadorDecimal !== null && cuerpo.includes(separadorDecimal)) {
    const corte = cuerpo.lastIndexOf(separadorDecimal);
    entera = cuerpo.slice(0, corte);
    decimal = cuerpo.slice(corte + 1);
  } else {
    entera = cuerpo;
  }

  entera = entera.replace(/[.,]/g, "");
  if (!/^\d*$/.test(entera) || !/^\d*$/.test(decimal)) {
    throw new NumberFormatError("NOT_A_NUMBER", raw);
  }

  entera = entera.replace(/^0+(?=\d)/, "") || "0";
  decimal = decimal.replace(/0+$/, "");

  if (entera.length > MAX_INTEGER_DIGITS) throw new NumberFormatError("OUT_OF_RANGE", raw);
  if (decimal.length > MAX_DECIMAL_DIGITS) throw new NumberFormatError("OUT_OF_RANGE", raw);

  const signo = negativo && (entera !== "0" || decimal !== "") ? "-" : "";
  return decimal === "" ? `${signo}${entera}` : `${signo}${entera}.${decimal}`;
}

/**
 * Lo que el .xlsx ya entregó como número.
 *
 * `Number.prototype.toString()` produce la representación decimal más corta que
 * vuelve al mismo double, así que un valor que cupo en `numeric(14,4)` sale de
 * aquí idéntico a como entró. Es la única frontera donde un `number` puede
 * tocar un monto.
 */
export function numericCellToDecimalText(value: number): string {
  if (!Number.isFinite(value)) throw new NumberFormatError("NOT_A_NUMBER", String(value));

  const texto = value.toString();
  if (texto.includes("e") || texto.includes("E")) {
    // Notación científica: se expande sin pasar por otro float.
    const expandido = value.toFixed(MAX_DECIMAL_DIGITS).replace(/0+$/, "").replace(/\.$/, "");
    return expandido;
  }

  const [entera = "0", decimal = ""] = texto.replace("-", "").split(".");
  if (entera.length > MAX_INTEGER_DIGITS) throw new NumberFormatError("OUT_OF_RANGE", texto);
  if (decimal.length > MAX_DECIMAL_DIGITS) {
    // Más de cuatro decimales no caben: se redondea y se deja constancia
    // devolviendo el valor recortado, no un error — un precio con seis
    // decimales es un artefacto de Excel, no una intención del dueño.
    return value.toFixed(MAX_DECIMAL_DIGITS).replace(/0+$/, "").replace(/\.$/, "");
  }

  return texto;
}
