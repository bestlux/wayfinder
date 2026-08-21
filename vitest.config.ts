import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{spec,test}.ts"],
    // Process-backed integration tests need CPU headroom beyond Vitest's file worker.
    maxWorkers: 8,
    setupFiles: ["tests/support/foundry-v14-globals.ts"],
  },
});
