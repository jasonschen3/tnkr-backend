import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "generated/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.log",
      ".env*",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
  },
]);
