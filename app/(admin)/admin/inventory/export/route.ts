import { NextResponse, type NextRequest } from "next/server";

import { toCsv } from "@/lib/inventory/csv";
import { fetchInventoryForExport } from "@/lib/inventory/query";
import { formatGrade, formatInstant, itemTitle } from "@/lib/inventory/format";
import { parseInventoryParams } from "@/lib/inventory/params";
import { createClient } from "@/lib/supabase/server";

/**
 * Exportación del inventario a CSV.
 *
 * Respeta el filtro que el usuario tenga puesto y su rol: se consulta con SU
 * sesión, así que el RLS decide. Un `staff` baja el archivo sin columnas de
 * costo, porque simplemente le llegan vacías.
 *
 * Es una exportación para MIRAR — contar piezas, mandársela al contador,
 * imprimirla. No es el formato de la plantilla de importación: esa tiene forma
 * de compra (fecha, plataforma, martillo, premium, aduana) y reimportar esto
 * crearía lotes falsos.
 */

const ROLES_CON_COSTOS = new Set(["owner", "admin"]);

export async function GET(request: NextRequest) {
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

  if (!profile || profile.role === "consignor") {
    return new NextResponse("Sin acceso", { status: 403 });
  }

  const canSeeCosts = ROLES_CON_COSTOS.has(profile.role);

  const params = parseInventoryParams(Object.fromEntries(request.nextUrl.searchParams.entries()));

  const { rows: items } = await fetchInventoryForExport(supabase, params, { canSeeCosts });

  const headers = [
    "sku",
    "pieza",
    "tipo",
    "categoria",
    "deporte_o_juego",
    "jugador_o_personaje",
    "marca",
    "set",
    "anio",
    "numero",
    "variante",
    "serial",
    "grado",
    "cert",
    "cantidad",
    "estado",
    "ubicacion",
    "dueno",
    "valor_mercado_usd",
    "precio_lista_usd",
    ...(canSeeCosts ? ["costo_usd", "ganancia_no_realizada_usd"] : []),
    "publicada",
    "recibida",
    "listada",
    "vendida",
  ];

  const rows = items.map((item) => [
    item.sku,
    itemTitle(item),
    item.type,
    item.category,
    item.sport_or_game,
    item.player_or_character,
    item.brand,
    item.set_name,
    item.year,
    item.card_number,
    item.variant,
    item.serial_numbered,
    formatGrade(item.grading_company, item.grade, item.raw_condition),
    item.cert_number,
    item.quantity,
    item.status,
    item.location,
    item.owner_type,
    item.market_value,
    item.list_price,
    ...(canSeeCosts ? [item.cost_basis, item.unrealized_gain] : []),
    item.is_published ? "si" : "no",
    // Estas tres son `timestamptz`, no `date`: llevan zona horaria.
    formatInstant(item.received_at),
    formatInstant(item.listed_at),
    formatInstant(item.sold_at),
  ]);

  const csv = toCsv(headers, rows);
  const fecha = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventario-p8-${fecha}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
