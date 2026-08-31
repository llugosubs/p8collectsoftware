import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { createClient } from "@/lib/supabase/server";

/**
 * La plantilla descargable (§7.12).
 *
 * Las 27 columnas en el orden del master prompt, con una fila de ejemplo
 * debajo. El ejemplo no es decorativo: es lo que enseña que la fecha va como
 * fecha, que el fee de tarjeta es un PORCENTAJE y no un monto, y que los
 * costos comunes se escriben una sola vez por lote.
 */

const COLUMNAS = [
  "fecha_compra",
  "plataforma",
  "referencia_subasta",
  "tipo",
  "deporte_o_juego",
  "jugador_o_personaje",
  "marca",
  "set",
  "año",
  "numero",
  "variante",
  "serial",
  "gradadora",
  "grado",
  "cert",
  "condicion_raw",
  "cantidad",
  "hammer_usd",
  "premium_usd",
  "fee_tarjeta_pct",
  "envio_usd",
  "courier_ve_usd",
  "aduana_usd",
  "valor_mercado_usd",
  "recibido",
  "ubicacion",
  "notas",
] as const;

const EJEMPLOS: readonly (readonly (string | number)[])[] = [
  [
    "2026-08-14", "alt", "ALT-2026-33", "carta graduada", "NBA", "Victor Wembanyama",
    "Panini", "Prizm", 2023, "136", "Silver", "/25", "PSA", 10, "118442901", "",
    1, 1250, 150, 3.3, 45, 20, 15, 1800, "sí", "Caja A", "Primera fila del lote",
  ],
  [
    "2026-08-14", "alt", "ALT-2026-33", "carta graduada", "NBA", "Chet Holmgren",
    "Panini", "Prizm", 2022, "280", "", "", "PSA", 9, "118442902", "",
    1, 380, "", "", "", "", "", 520, "sí", "Caja A",
    "Los costos comunes van solo en la primera fila del lote",
  ],
  [
    "2026-08-16", "fanatics", "FC-88120", "carta raw", "One Piece", "Monkey D. Luffy",
    "Bandai", "OP-05", 2024, "OP05-119", "Manga", "", "", "", "", "NM",
    1, 95, 12, 3.3, 18, "", "", 140, "no", "", "Otro lote: otra referencia",
  ],
];

/** Solo el equipo administrativo. La plantilla describe el modelo de compras. */
const ROLES_CON_ACCESO = new Set(["owner", "admin"]);

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("No autorizado", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ROLES_CON_ACCESO.has(profile?.role ?? "")) {
    return new NextResponse("Sin acceso", { status: 403 });
  }

  const hoja = XLSX.utils.aoa_to_sheet([[...COLUMNAS], ...EJEMPLOS.map((f) => [...f])]);

  // Anchos cómodos: sin esto, "jugador_o_personaje" sale cortado y el dueño
  // tiene que ensanchar 27 columnas a mano antes de empezar.
  hoja["!cols"] = COLUMNAS.map((nombre) => ({ wch: Math.max(12, nombre.length + 2) }));

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Compras");

  const bytes = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="p8-plantilla-compras.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
