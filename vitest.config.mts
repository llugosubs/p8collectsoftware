import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite resuelve los alias `@/*` leyendo tsconfig.json directamente.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // Las reglas de negocio viven en /lib/domain y ahí es donde se prueban.
    include: ["lib/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
