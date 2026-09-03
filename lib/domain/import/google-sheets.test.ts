import { describe, expect, it } from "vitest";

import {
  buildSheetCsvUrl,
  isAllowedGoogleHost,
  looksLikeLoginPage,
  parseGoogleSheetUrl,
} from "./google-sheets";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

describe("leer un enlace de Sheets", () => {
  it("entiende la URL de edición", () => {
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toEqual({
      id: ID,
      gid: "0",
    });
  });

  it("saca la pestaña del fragmento y de la query", () => {
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1553420318`)?.gid,
    ).toBe("1553420318");
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=77#gid=77`)?.gid,
    ).toBe("77");
  });

  it("supone la primera pestaña cuando no viene", () => {
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/`)?.gid).toBe("0");
  });

  it("acepta el identificador pelado", () => {
    expect(parseGoogleSheetUrl(ID)?.id).toBe(ID);
  });

  it("no adivina ante algo que no es una hoja", () => {
    expect(parseGoogleSheetUrl("https://ejemplo.com/hoja")).toBeNull();
    expect(parseGoogleSheetUrl("")).toBeNull();
    expect(parseGoogleSheetUrl("no es un enlace")).toBeNull();
  });
});

describe("la URL que el servidor sí pide", () => {
  it("se arma desde cero, no se reusa la del usuario", () => {
    // Es la defensa entera contra el SSRF: del enlace pegado sobreviven dos
    // cadenas validadas, y ni el host ni la ruta salen de él.
    const url = buildSheetCsvUrl({ id: ID, gid: "42" });
    expect(url).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`,
    );
  });

  it("un enlace que apunta a la red interna no sobrevive al viaje", () => {
    // El id se saca por patrón, así que un host hostil no llega a ninguna parte.
    const ref = parseGoogleSheetUrl("http://169.254.169.254/spreadsheets/d/" + ID);
    // Aunque el patrón encuentre el id, la URL que se pide es la de Google.
    expect(ref === null || new URL(buildSheetCsvUrl(ref)).hostname).toBe(
      ref === null ? null : "docs.google.com",
    );
  });
});

describe("hosts admitidos", () => {
  it("solo Google", () => {
    expect(isAllowedGoogleHost("docs.google.com")).toBe(true);
    expect(isAllowedGoogleHost("doc-0s-0c-sheets.googleusercontent.com")).toBe(true);
    expect(isAllowedGoogleHost("evil.com")).toBe(false);
    // El clásico: un host que TERMINA en algo parecido.
    expect(isAllowedGoogleHost("docs.google.com.evil.com")).toBe(false);
    expect(isAllowedGoogleHost("notgoogleusercontent.com")).toBe(false);
  });
});

describe("la hoja que no está compartida", () => {
  it("se reconoce, porque Google devuelve 200 con la pantalla de acceso", () => {
    // Sin esto, el parser trataría de leer un documento de Google como tabla y
    // el dueño recibiría un error incomprensible en vez de "comparte la hoja".
    expect(looksLikeLoginPage("text/html; charset=utf-8", "")).toBe(true);
    expect(looksLikeLoginPage(null, "<!DOCTYPE html><html>...")).toBe(true);
    expect(looksLikeLoginPage("text/csv", "sku,jugador\nP8-1,Luffy")).toBe(false);
  });
});
