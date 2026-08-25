/**
 * Generación de CSV.
 *
 * Lo importante aquí no es el formato, es la inyección de fórmulas. Excel y
 * Sheets interpretan como fórmula cualquier celda que empiece por `=`, `+`,
 * `-` o `@`. Una carta llamada `=cmd|...` en un archivo que el dueño abre —o
 * que le manda al contador— se ejecuta al abrirlo. Se antepone un apóstrofo,
 * que Excel entiende como "esto es texto" y no muestra.
 */

const PELIGROSOS = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);
  if (PELIGROSOS.test(text)) text = `'${text}`;

  // Comillas, comas y saltos de línea obligan a entrecomillar la celda.
  if (/[",\n\r]/.test(text)) {
    text = `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lineas = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) lineas.push(row.map(escapeCsvCell).join(","));
  // CRLF y BOM: sin ellos, Excel en Windows abre los acentos rotos y mete todo
  // en una sola columna.
  return `﻿${lineas.join("\r\n")}\r\n`;
}
