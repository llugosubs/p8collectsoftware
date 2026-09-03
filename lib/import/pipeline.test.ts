import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { findHeaderRow, matchColumns } from "@/lib/domain/import/columns";
import { findDuplicates, type ImportRowKeys } from "@/lib/domain/import/duplicates";
import { buildImportPlan } from "@/lib/domain/import/plan";

import { readSheet, textRows } from "./parse";
import { mappingFromMatches, readRows } from "./rows";

/**
 * El archivo de verdad, de punta a punta.
 *
 * Un Excel como los que sube el dueño: título arriba, una fila en blanco,
 * números venezolanos, gradadora en minúscula, el nombre comercial de la
 * plataforma, un cert repetido, un grado imposible y una fila sin nombre.
 */
function excelDePrueba(): ArrayBuffer {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["Compras de la semana 35", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", ""],
    [
      "fecha_compra",
      "plataforma",
      "referencia_subasta",
      "tipo",
      "deporte_o_juego",
      "jugador_o_personaje",
      "gradadora",
      "grado",
      "cert",
      "hammer_usd",
      "premium_usd",
      "envio_usd",
      "recibido",
    ],
    ["14/08/2026", "Fanatics Collect", "FC-501", "carta graduada", "NBA", "Wembanyama",
     "psa", "10", "118442901", "1.234,56", "100", "50", "sí"],
    ["14/08/2026", "Fanatics Collect", "FC-501", "carta graduada", "One Piece", "Luffy",
     "psa", "9,5", "118442902", "383", "", "", "sí"],
    ["14/08/2026", "Fanatics Collect", "FC-501", "carta graduada", "NBA", "Wembanyama",
     "psa", "10", "118442901", "1.234,56", "", "", "sí"],
    ["14/08/2026", "Fanatics Collect", "FC-502", "carta graduada", "MLB", "Ohtani",
     "psa", "11", "118442903", "900", "", "", "no"],
    ["14/08/2026", "Fanatics Collect", "FC-502", "carta graduada", "MLB", "",
     "psa", "10", "118442904", "500", "", "", "no"],
  ]);

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Hoja1");
  const bytes = XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return bytes;
}

function correrPipeline() {
  const grid = readSheet(excelDePrueba());
  const encabezados = findHeaderRow(textRows(grid));
  if (encabezados === null) throw new Error("no se encontró la fila de encabezados");

  const matches = matchColumns(encabezados.headers);
  const leidas = readRows(grid, encabezados.index, mappingFromMatches(matches));

  const claves: ImportRowKeys[] = leidas.rows.map((r) => ({
    rowNumber: r.rowNumber,
    gradingCompany: r.item.gradingCompany,
    certNumber: r.item.certNumber,
    platform: r.platform,
    reference: r.reference,
    cardNumber: r.item.cardNumber,
    grade: r.item.grade,
  }));

  const plan = buildImportPlan({
    rows: leidas.rows,
    duplicates: findDuplicates(claves, []),
  });

  return { grid, encabezados, leidas, plan };
}

describe("un Excel de verdad, de punta a punta", () => {
  it("salta el título y la fila vacía", () => {
    const { encabezados } = correrPipeline();
    expect(encabezados.index).toBe(2);
  });

  it("deduce que el archivo escribe números a la venezolana", () => {
    const { leidas } = correrPipeline();
    expect(leidas.decimalConvention).toBe("es");
    expect(leidas.ambiguousNumbers).toEqual([]);
  });

  it("lee 1.234,56 como mil doscientos treinta y cuatro con cincuenta y seis", () => {
    // Leerlo a la gringa lo dejaría en 1,23 — mil veces menos.
    const { leidas } = correrPipeline();
    expect(leidas.rows[0]?.hammerPrice).toBe("1234.56");
  });

  it("deduce que las fechas van con el día primero", () => {
    const { leidas } = correrPipeline();
    expect(leidas.dateConvention).toBe("dmy");
    expect(leidas.rows[0]?.purchasedAt).toBe("2026-08-14");
  });

  it("entiende la gradadora en minúscula y el nombre comercial de la casa", () => {
    const { leidas } = correrPipeline();
    expect(leidas.rows[0]?.item.gradingCompany).toBe("PSA");
    expect(leidas.rows[0]?.platform).toBe("fanatics");
  });

  it("deduce la categoría del deporte y del juego", () => {
    const { leidas } = correrPipeline();
    expect(leidas.rows[0]?.item.category).toBe("sports");
    expect(leidas.rows[1]?.item.category).toBe("tcg");
  });

  it("lee el grado 9,5 con coma", () => {
    const { leidas } = correrPipeline();
    expect(leidas.rows[1]?.item.grade).toBe(9.5);
  });

  it("numera las filas como las ve el dueño en Excel", () => {
    const { leidas } = correrPipeline();
    expect(leidas.rows.map((r) => r.rowNumber)).toEqual([4, 5, 6, 7, 8]);
  });

  it("marca el cert repetido dentro del mismo archivo", () => {
    const { plan } = correrPipeline();
    expect(plan.rows.find((r) => r.rowNumber === 6)?.state).toBe("duplicate_in_file");
  });

  it("marca el grado imposible y la fila sin nombre", () => {
    const { plan } = correrPipeline();
    expect(plan.rows.find((r) => r.rowNumber === 7)?.state).toBe("error");
    expect(plan.rows.find((r) => r.rowNumber === 8)?.errors[0]).toMatch(/nombre/i);
  });

  it("arma un solo lote, con las dos filas buenas", () => {
    // El otro grupo (FC-502) se quedó sin filas: las dos traían error.
    const { plan } = correrPipeline();
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.lines.map((l) => l.rowNumber)).toEqual([4, 5]);
    expect(plan.groups[0]?.reference).toBe("FC-501");
  });

  it("los costos comunes salen de la primera fila del lote", () => {
    const { plan } = correrPipeline();
    expect(plan.groups[0]?.buyerPremium).toBe("100.0000");
    expect(plan.groups[0]?.shippingIntl).toBe("50.0000");
  });

  it("el prorrateo cuadra al centavo con lo que costó el lote", () => {
    const { plan } = correrPipeline();
    const g = plan.groups[0]!;
    // 1.234,56 + 383 + 100 + 50
    expect(g.totalCost).toBe("1767.5600");
    const suma = g.lines.reduce((acc, l) => acc.plus(l.allocatedCost), new Decimal(0));
    expect(suma.toFixed(4)).toBe(g.totalCost);
  });

  it("la fila repetida no aporta su martillo al total del lote", () => {
    // Contarla lo inflaría en 1.234,56 y repartiría envío entre una carta que
    // nunca se va a crear.
    const { plan } = correrPipeline();
    expect(plan.groups[0]?.hammerTotal).toBe("1617.5600");
  });

  it("el lote llegó, porque sus dos filas dicen que sí", () => {
    const { plan } = correrPipeline();
    expect(plan.groups[0]?.received).toBe(true);
  });

  it("el resumen cuenta lo que va a pasar", () => {
    const { plan } = correrPipeline();
    expect(plan.totals).toMatchObject({
      rowsTotal: 5,
      rowsToCreate: 2,
      rowsSkipped: 1,
      rowsWithError: 2,
    });
  });
});

/**
 * El grado no vota sobre cómo se leen los montos.
 *
 * PSA imprime "9.5" en la etiqueta y el dueño la transcribe tal cual; el dinero
 * lo teclea él desde Caracas. Las dos cosas conviven en el mismo archivo sin
 * contradecirse, porque vienen de fuentes distintas.
 */
function excelConGradoAmericano(): ArrayBuffer {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["fecha_compra", "plataforma", "referencia_subasta", "tipo", "deporte_o_juego",
     "jugador_o_personaje", "gradadora", "grado", "hammer_usd", "fee_tarjeta_pct"],
    // Todo como TEXTO a propósito: es lo que pasa con un CSV o con una hoja
    // donde las columnas quedaron con formato de texto.
    ["14/08/2026", "alt", "ALT-1", "carta graduada", "NBA", "Wembanyama",
     "psa", "9.5", "1.234", "3,3"],
  ]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Hoja1");
  return XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("el grado no decide cómo se lee el dinero", () => {
  it("un grado 9.5 no convierte el archivo en gringo", () => {
    // Si votara, inferDecimalConvention devolvería "us" con confident:true —así
    // que el toggle del paso 3 ni aparecería— y el martillo de 1.234 dólares se
    // leería como uno con veintitrés. El precio dividido entre mil, en silencio.
    const grid = readSheet(excelConGradoAmericano());
    const encabezados = findHeaderRow(textRows(grid))!;
    const leidas = readRows(
      grid,
      encabezados.index,
      mappingFromMatches(matchColumns(encabezados.headers)),
    );

    expect(leidas.decimalConvention).toBe("es");
    expect(leidas.rows[0]?.hammerPrice).toBe("1234");
    expect(leidas.rows[0]?.cardFeePct).toBe("3.3");
    // Y el grado se sigue leyendo bien: su forma es inequívoca con cualquier
    // convención, porque nunca trae tres dígitos después del separador.
    expect(leidas.rows[0]?.item.grade).toBe(9.5);
  });
});

/**
 * La ida y vuelta: el inventario bajado a Excel, editado, y subido otra vez.
 *
 * La primera columna es el SKU, y eso lo cambia todo: la fila no es una compra,
 * es una corrección sobre una pieza que ya existe.
 */
function inventarioExportado(): ArrayBuffer {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["sku", "jugador_o_personaje", "set", "gradadora", "grado", "cert", "estado",
     "valor_mercado_usd", "precio_lista_usd", "ubicacion", "recibido"],
    ["P8-2026-0007", "Victor Wembanyama", "Prizm", "PSA", "10", "118442901", "in_stock",
     "2.150,00", "2.400,00", "Caja B", "sí"],
    ["P8-2026-0008", "Monkey D. Luffy", "OP-05", "PSA", "9.5", "118442902", "in_stock",
     "410,00", "", "Caja B", "sí"],
  ]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Inventario");
  return XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function correrRoundTrip(estadoDe0007 = "in_stock") {
  const grid = readSheet(inventarioExportado());
  const encabezados = findHeaderRow(textRows(grid))!;
  const leidas = readRows(
    grid,
    encabezados.index,
    mappingFromMatches(matchColumns(encabezados.headers)),
  );

  const claves: ImportRowKeys[] = leidas.rows.map((r) => ({
    rowNumber: r.rowNumber,
    sku: r.sku,
    gradingCompany: r.item.gradingCompany,
    certNumber: r.item.certNumber,
    platform: r.platform,
    reference: r.reference,
    cardNumber: r.item.cardNumber,
    grade: r.item.grade,
  }));

  const enBase = [
    { id: "i7", sku: "P8-2026-0007", status: estadoDe0007, ...vacio },
    { id: "i8", sku: "P8-2026-0008", status: "in_stock", ...vacio },
  ];

  const plan = buildImportPlan({ rows: leidas.rows, duplicates: findDuplicates(claves, enBase) });
  return { leidas, plan };
}

const vacio = {
  gradingCompany: null,
  certNumber: null,
  platform: null,
  reference: null,
  cardNumber: null,
  grade: null,
};

describe("la ida y vuelta por Excel", () => {
  it("una fila con SKU se marca para ACTUALIZAR sola", () => {
    // Es lo que el dueño pidió al bajar el inventario para editarlo. Obligarlo
    // a marcar doscientas casillas sería no haber entendido para qué lo bajó.
    const { plan } = correrRoundTrip();
    expect(plan.rows.map((r) => r.state)).toEqual(["update_existing", "update_existing"]);
    expect(plan.totals.rowsToUpdate).toBe(2);
  });

  it("no crea ningún lote de compra", () => {
    // Es el punto entero: reimportar el inventario con forma de compra
    // inventaría lotes y volvería a cargar un costo que ya se pagó.
    const { plan } = correrRoundTrip();
    expect(plan.groups).toEqual([]);
    expect(plan.totals.rowsToCreate).toBe(0);
  });

  it("no le exige plataforma, fecha ni martillo a una fila con SKU", () => {
    // Una corrección no es una compra: nada de eso se vuelve a escribir.
    const { plan } = correrRoundTrip();
    expect(plan.rows.flatMap((r) => r.errors)).toEqual([]);
  });

  it("lee los montos editados a la venezolana", () => {
    const { leidas } = correrRoundTrip();
    expect(leidas.rows[0]?.item.marketValue).toBe("2150");
    expect(leidas.rows[1]?.item.marketValue).toBe("410");
  });

  it("se niega a actualizar una pieza que ya se vendió", () => {
    const { plan } = correrRoundTrip("sold");
    const fila = plan.rows.find((r) => r.rowNumber === 2)!;
    expect(fila.state).toBe("error");
    expect(fila.errors[0]).toMatch(/ya no está en el inventario/);
    // Y la otra fila del archivo se importa igual.
    expect(plan.rows.find((r) => r.rowNumber === 3)?.state).toBe("update_existing");
  });
});
