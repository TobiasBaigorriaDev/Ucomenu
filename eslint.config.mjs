import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Herramientas y skills de agentes (código de terceros, no del producto).
    ".agents/**",
    ".claude/**",
    ".codex/**",
    // Diagnósticos locales generados por agentes, ajenos al producto.
    "output/**",
    // Proyecto de video de presentación (HyperFrames): scripts de captura, no código del producto.
    "video/**",
    "supabase/**",
    // Generado por `pnpm db:types`.
    "src/lib/supabase/database.types.ts",
  ]),
]);

export default eslintConfig;
