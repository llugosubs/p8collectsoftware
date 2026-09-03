import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { fetchInventoryForExport } from "@/lib/inventory/query";
import { parseInventoryParams } from "@/lib/inventory/params";
import { createClient } from "@/lib/supabase/server";

/**
 * La exportación INVERSA (§7.12): bajar el inventario, editarlo en Excel y
 * volverlo a subir.
 *
 * El master prompt pide bajarlo "en el mismo formato de la plantilla". No se
 * hace así, y el motivo es de dinero: la plantilla tiene forma de COMPRA
 * —fecha, plataforma, martillo, premium, aduana— y reimportar el inventario en
 * ese formato crearía lotes de compra falsos y volvería a cargar un costo que
 * ya se pagó.
 *
 * Lo que sí funciona es esto: la primera columna es el SKU. Un SKU solo puede
 * haber salido de este sistema, así que el importador lo reconoce como "esta
 * pieza YA EXISTE" y la fila entra por el camino de ACTUALIZAR, que solo puede
 * tocar valor de mercado, precios, ubicación y si ya llegó. Nunca el costo,
 * nunca un lote nuevo.
 *
 * Así la ida y vuelta sirve para lo que de verdad sirve: corregir cien valores
 * de mercado de una sentada, sin tocar una carta a la vez.
 *
 * Sale en .xlsx y no en CSV a propósito. SheetJS escribe cada celda como texto,
 * así que una carta que se llame "=cmd|..." es una cadena y no una fórmula: la
 * defensa del apóstrofo que necesita el CSV aquí sobra, y anteponerlo sería
 * corromper el dato del dueño para nada.
 */

/** El módulo entero es de admin: el importador escribe compras. */
const ROLES_CON_ACCESO = new Set(["owner", "admin"]);

/**
 * Las columnas que el importador VUELVE A LEER de este archivo. El resto va
 * como referencia, para saber qué carta se está editando.
 */
const EDITABLES = ["valor_mercado_usd", "precio_lista_usd", "precio_minimo_usd", "ubicacion", "recibido"];

const COLUMNAS = [
  "sku",
  "jugador_o_personaje",
  "set",
  "gradadora",
  "grado",
  "cert",
  "estado",
  ...EDITABLES,
] as const;

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

  if (!ROLES_CON_ACCESO.has(profile?.role ?? "")) {
    return new NextResponse("Sin acceso", { status: 403 });
  }

  // Respeta el filtro que el dueño tenga puesto en Inventario: si bajó solo lo
  // de una caja, sube solo lo de esa caja.
  const params = parseInventoryParams(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const { rows: items } = await fetchInventoryForExport(supabase, params, { canSeeCosts: false });

  const filas = items.map((item) => [
    item.sku,
    item.player_or_character ?? "",
    item.set_name ?? "",
    item.grading_company === "none" ? "" : item.grading_company,
    item.grade ?? "",
    item.cert_number ?? "",
    item.status,
    item.market_value ?? "",
    item.list_price ?? "",
    item.min_price ?? "",
    item.location ?? "",
    item.received_at ? "sí" : "no",
  ]);

  const hoja = XLSX.utils.aoa_to_sheet([[...COLUMNAS], ...filas]);
  hoja["!cols"] = COLUMNAS.map((nombre) => ({ wch: Math.max(12, nombre.length + 2) }));

  // La primera columna se congela: con doscientas filas, saber qué carta se
  // está editando exige tener el SKU siempre a la vista.
  hoja["!freeze"] = { xSplit: "1", ySplit: "1", topLeftCell: "B2", activePane: "bottomRight" };

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Inventario");

  // Una segunda hoja que dice qué se lee de vuelta. Sin ella, el dueño edita
  // el nombre del jugador, lo sube, no pasa nada, y no hay forma de que sepa
  // por qué.
  const instrucciones = XLSX.utils.aoa_to_sheet([
    ["Cómo se usa este archivo"],
    [],
    ["1.", "Edita las columnas de la lista de abajo. NO borres ni muevas la columna sku."],
    ["2.", "Súbelo en Importador. Cada fila con SKU se marca como “Actualiza” sola."],
    ["3.", "Revisa la previsualización y confirma."],
    [],
    ["Se leen de vuelta:", EDITABLES.join(", ")],
    [
      "Las demás columnas:",
      "van solo como referencia, para que sepas qué carta estás editando. Editarlas no hace nada.",
    ],
    [],
    [
      "Ojo:",
      "este archivo NO sirve para registrar compras. Una fila sin SKU necesita plataforma, fecha y martillo, y eso se hace en Compras o con la plantilla del importador.",
    ],
  ]);
  instrucciones["!cols"] = [{ wch: 18 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(libro, instrucciones, "Cómo se usa");

  const bytes = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fecha = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="p8-inventario-${fecha}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
