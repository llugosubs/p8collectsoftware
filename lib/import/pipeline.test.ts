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
