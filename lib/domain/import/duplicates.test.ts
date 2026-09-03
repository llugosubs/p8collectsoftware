import { describe, expect, it } from "vitest";

import {
  certKey,
  findDuplicates,
  lookupKeys,
  lotPositionKey,
  type ExistingItem,
  type ImportRowKeys,
} from "./duplicates";

const vacia = {
  gradingCompany: null,
  certNumber: null,
  platform: null,
  reference: null,
  cardNumber: null,
  grade: null,
};

function fila(rowNumber: number, campos: Partial<ImportRowKeys>): ImportRowKeys {
  return { ...vacia, rowNumber, ...campos };
}

function item(id: string, sku: string, campos: Partial<ExistingItem>): ExistingItem {
  return { ...vacia, id, sku, ...campos };
}

describe("claves de comparación", () => {
  it("la del cert incluye la gradadora, igual que el índice de la base", () => {
    // Si aquí se calculara distinto, el importador diría "nueva" y el insert
    // moriría con 23505 a mitad de la transacción.
    expect(certKey({ ...vacia, gradingCompany: "PSA", certNumber: "118442901" })).toBe(
      "PSA|118442901",
    );
  });

  it("sin cert no hay clave de cert", () => {
    expect(certKey({ ...vacia, gradingCompany: "PSA", certNumber: "  " })).toBeNull();
  });

  it("la de posición necesita plataforma, referencia y número", () => {
    expect(
      lotPositionKey({ ...vacia, platform: "alt", reference: "ALT-33", cardNumber: "150" }),
    ).toBe("alt|alt 33|150|");

    // Una compra particular sin referencia nunca es duplicada por esta vía.
    expect(lotPositionKey({ ...vacia, platform: "private", cardNumber: "150" })).toBeNull();
  });

  it("el grado se compara como número, no como texto", () => {
    // La base devuelve 10.0 y el archivo dice 10. Comparados como texto serían
    // cartas distintas y la duplicada se colaría al inventario.
    const base = { ...vacia, platform: "alt", reference: "ALT-33", cardNumber: "150" };
    expect(lotPositionKey({ ...base, grade: "10.0" })).toBe(
      lotPositionKey({ ...base, grade: 10 }),
    );
  });
});

describe("duplicados", () => {
  it("marca la carta que ya está en el inventario", () => {
    const v = findDuplicates(
      [fila(4, { gradingCompany: "PSA", certNumber: "118442901" })],
      [item("i1", "P8-2026-0001", { gradingCompany: "PSA", certNumber: "118442901" })],
    );
    expect(v.get(4)).toEqual({
      kind: "duplicate_in_db",
      matchedBy: "cert",
      itemId: "i1",
      sku: "P8-2026-0001",
      status: null,
    });
  });

  it("atrapa el duplicado DENTRO del mismo archivo", () => {
    // Ningún índice único de la base puede atraparlo: las dos filas son nuevas,
    // y el choque aparecería a mitad de la transacción con quince cartas ya
    // escritas.
    const v = findDuplicates(
      [
        fila(4, { gradingCompany: "PSA", certNumber: "118442901" }),
        fila(9, { gradingCompany: "PSA", certNumber: "118442901" }),
      ],
      [],
    );
    expect(v.get(4)).toEqual({ kind: "new" });
    expect(v.get(9)).toEqual({
      kind: "duplicate_in_file",
      matchedBy: "cert",
      firstRowNumber: 4,
    });
  });

  it("la primera aparición es la que se carga", () => {
    const v = findDuplicates(
      [
        fila(4, { platform: "alt", reference: "ALT-33", cardNumber: "150", grade: 10 }),
        fila(5, { platform: "alt", reference: "ALT-33", cardNumber: "150", grade: 10 }),
        fila(6, { platform: "alt", reference: "ALT-33", cardNumber: "151", grade: 10 }),
      ],
      [],
    );
    expect(v.get(4)?.kind).toBe("new");
    expect(v.get(5)?.kind).toBe("duplicate_in_file");
    expect(v.get(6)?.kind).toBe("new");
  });

  it("el mismo número con otro grado no es la misma carta", () => {
    const v = findDuplicates(
      [
        fila(4, { platform: "alt", reference: "ALT-33", cardNumber: "150", grade: 10 }),
        fila(5, { platform: "alt", reference: "ALT-33", cardNumber: "150", grade: 9 }),
      ],
      [],
    );
    expect(v.get(5)?.kind).toBe("new");
  });

  it("dos cartas raw sin referencia no se estorban", () => {
    // Un lote particular puede traer de verdad dos copias del mismo número.
    const v = findDuplicates(
      [
        fila(4, { platform: "private", cardNumber: "150" }),
        fila(5, { platform: "private", cardNumber: "150" }),
      ],
      [],
    );
    expect(v.get(4)?.kind).toBe("new");
    expect(v.get(5)?.kind).toBe("new");
  });

  it("la base gana sobre el archivo", () => {
    const v = findDuplicates(
      [
        fila(4, { gradingCompany: "BGS", certNumber: "0099" }),
        fila(5, { gradingCompany: "BGS", certNumber: "0099" }),
      ],
      [item("i9", "P8-2026-0009", { gradingCompany: "BGS", certNumber: "0099" })],
    );
    expect(v.get(4)?.kind).toBe("duplicate_in_db");
    expect(v.get(5)?.kind).toBe("duplicate_in_db");
  });
});

describe("qué buscar en la base", () => {
  it("devuelve listas sin repetir, para una sola consulta", () => {
    // Doscientas filas serían doscientas consultas: el paso de validación
    // tardaría más que cargar las cartas a mano.
    const r = lookupKeys([
      fila(4, { certNumber: "111", reference: "ALT-33" }),
      fila(5, { certNumber: "111", reference: "ALT-33" }),
      fila(6, { certNumber: "222", reference: "ALT-34" }),
    ]);
    expect(r.certNumbers.sort()).toEqual(["111", "222"]);
    expect(r.references.sort()).toEqual(["ALT-33", "ALT-34"]);
  });
});
