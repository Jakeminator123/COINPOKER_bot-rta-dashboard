// eslint.config.mjs eller eslint.config.js

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";

export default [
  //
  // STEG 1: Bas-config för alla filer (JS/TS/React)
  //
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },

  //
  // STEG 2: TypeScript + React rekommenderade konfigurationer
  //
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,

  //
  // STEG 3: Egna regler som ska åsidosätta de ovan
  //
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      // React 17+ behöver inte React i scope för JSX
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",

      // ---- TypeScript-regler ----

      // Slå AV klagomål på `any` (ändra till "warn" om du vill ha varningar)
      "@typescript-eslint/no-explicit-any": "off",

      // Tillåt oanvända variabler/args som börjar med underscore osv.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_|^e$|^err$|^error$",
          args: "after-used",
        },
      ],
    },
  },

  //
  // STEG 4: Saker vi ignorerar helt
  //
  {
    ignores: [
      "**/*-lock.json",
      "**/package-lock.json",
      "**/yarn.lock",
      "**/pnpm-lock.yaml",

      "scripts/**",          // Node-skript, får använda require()
      "types/**/*.d.ts",     // Typsdefs, ofta med 'any'
      ".next/**",            // Next.js build
      "node_modules/**",     // Dependencies
      "public/**",           // Statiska filer
      "*.config.{js,mjs,ts}" // Konfigfiler får också vara mer slappa
    ],
  },
];
