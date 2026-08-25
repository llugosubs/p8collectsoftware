import type Decimal from "decimal.js";

import {
  fromDbNumeric,
  fromDbNumericOrNull,
  toDbNumeric,
  type MoneyInput,
} from "@/lib/domain/money";

/**
 * El puente entre `numeric` de Postgres y JavaScript.
 *
 * PostgREST entrega los `numeric` como número JSON, así que `supabase gen types`
 * los declara `number`. Eso choca con la regla del proyecto: un `number` de
 * JavaScript es un float binario y no debe sostener un monto.
 *
 * Al ESCRIBIR se manda siempre el string exacto. Postgres lo convierte a
 * `numeric` sin que un float toque el valor en ningún momento. El `as unknown
 * as number` es una mentira deliberada al sistema de tipos, contenida en esta
 * única función en vez de repartida por cada `insert` del proyecto.
 *
 * Al LEER, el número que llega se convierte a `Decimal` de inmediato y no se
 * hace aritmética con él antes.
 */
export function dbNumeric(value: MoneyInput): number {
  return toDbNumeric(value) as unknown as number;
}

/** Lectura de un `numeric` obligatorio. Nada de aritmética antes de convertirlo. */
export function readNumeric(value: number | string): Decimal {
  return fromDbNumeric(value);
}

/**
 * Lectura de un `numeric` que puede llegar nulo — y en este esquema son
 * muchos, porque el RLS esconde los costos devolviendo NULL en las vistas.
 *
 * Toda columna de `item_costs`, `order_line_costs` o `account_details` leída
 * desde el panel pasa por aquí. Si se usara `readNumeric` con un `?? 0`, la
 * pantalla de un `staff` mostraría costo cero y margen completo en vez de
 * "sin acceso", y nada en el sistema avisaría del error.
 */
export function readNullableNumeric(value: number | string | null | undefined): Decimal | null {
  return fromDbNumericOrNull(value);
}
