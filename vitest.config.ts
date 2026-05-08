import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{spec,test}.ts"],
    setupFiles: ["tests/support/foundry-v14-globals.ts"],
  },
});
