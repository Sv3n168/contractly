// Lint for the browser app (frontend/js): plain ES modules, no build step.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["frontend/js/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, Chart: "readonly", Hammer: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
];
