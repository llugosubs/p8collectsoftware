import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Lo escupe `supabase start`: runtime de Deno minificado, no es código del proyecto.
      "supabase/.temp/**",
      // Generado por `npm run gen:types`. Corregirlo a mano no tiene sentido:
      // la próxima generación lo sobreescribe.
      "lib/supabase/database.types.ts",
    ],
  },
];

export default eslintConfig;
