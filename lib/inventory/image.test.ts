import { describe, expect, it } from "vitest";

import { fitWithin, MAX_EDGE_PX } from "./image";

describe("escalado de fotos", () => {
  it("no agranda una imagen que ya es pequeña", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("reduce el lado mayor al tope y conserva la proporción", () => {
    // Una foto típica de iPhone, apaisada.
    const r = fitWithin(4032, 3024);
    expect(r.width).toBe(MAX_EDGE_PX);
    expect(r.height).toBe(1500);
    expect(r.width / r.height).toBeCloseTo(4032 / 3024, 2);
  });

  it("funciona igual con la foto de pie, que es como se fotografía una carta", () => {
    const r = fitWithin(3024, 4032);
    expect(r.height).toBe(MAX_EDGE_PX);
    expect(r.width).toBe(1500);
  });

  it("nunca devuelve una dimensión de cero", () => {
    const r = fitWithin(10000, 1);
    expect(r.width).toBe(MAX_EDGE_PX);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("deja pasar una imagen exactamente en el tope", () => {
    expect(fitWithin(MAX_EDGE_PX, 1000)).toEqual({ width: MAX_EDGE_PX, height: 1000 });
  });
});
