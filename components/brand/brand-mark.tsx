import Image from "next/image";

/**
 * La marca en la interfaz.
 *
 * PENDIENTE DE ARCHIVO: la guía de marca especifica el lockup con "Collects"
 * en script dorado bajo el P8, y dice expresamente que esa palabra NUNCA se
 * renderiza como texto — se usa siempre el PNG. Ese archivo todavía no está en
 * el repositorio; el kit disponible trae el wordmark anterior, en mayúsculas.
 *
 * Mientras llega, se usa ese wordmark como imagen (no como texto), que es lo
 * más cercano y correcto que hay hoy. Cuando aparezcan los PNG del lockup se
 * cambian las dos rutas de aquí abajo y no hace falta tocar nada más.
 */

const LOCKUP_OSCURO = "/brand/p8-wordmark-negativo.svg";
const LOCKUP_CLARO = "/brand/p8-wordmark.svg";

export function BrandMark({
  variant = "dark",
  className,
  height = 20,
}: {
  /** `dark` para fondos oscuros y vault; `light` para crema, facturas e impresión. */
  variant?: "dark" | "light";
  className?: string;
  height?: number;
}) {
  const src = variant === "dark" ? LOCKUP_OSCURO : LOCKUP_CLARO;

  return (
    <Image
      src={src}
      alt="P8 Collects"
      height={height}
      width={Math.round(height * 10.94)}
      priority
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}
