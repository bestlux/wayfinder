import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const foundryGlobals = {
  CONFIG: "readonly",
  Dialog: "readonly",
  FormDataExtended: "readonly",
  Hooks: "readonly",
  TextEditor: "readonly",
  canvas: "readonly",
  foundry: "readonly",
  fromUuid: "readonly",
  fu: "readonly",
  game: "readonly",
  loadTemplates: "readonly",
  ui: "readonly",
};

const vitestGlobals = {
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly",
};

export default tseslint.config(
  {
    ignores: ["agents/**", ".claude/**", "lang/**", "node_modules/**", "scripts/**", "styles/**", "templates/**"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...foundryGlobals,
      },
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...vitestGlobals,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "no-var": "off",
    },
  },
  {
    files: [
      "src/build-state.ts",
      "src/build-state/**/*.ts",
      "src/actor-updater.ts",
      "src/actor-updater/**/*.ts",
      "src/shared/**/*.ts",
      "tests/support/**/*.ts",
      "src/wayfinder/application/**/*.ts",
      "src/wayfinder/class-choice-service.ts",
      "src/wayfinder/class-choice/**/*.ts",
      "src/wayfinder/domain/**/*.ts",
      "src/wayfinder/draft-decisions.ts",
      "src/wayfinder/invalidation.ts",
      "src/wayfinder/existing-selection-service.ts",
      "src/wayfinder/spell-choice-service.ts",
      "src/wayfinder/spell-choice/**/*.ts",
      "src/wayfinder/slot-ids.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  }
);
