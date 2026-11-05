// Lint for the browser app (frontend/js, plain ES modules, no build step) and its service worker.
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
  {
    files: ["frontend/sw.js"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: { ...globals.serviceworker } },
  },
];
