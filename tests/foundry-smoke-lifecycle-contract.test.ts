import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");

describe("Foundry smoke lifecycle contract", () => {
  it("passes typed step evaluation through every draft lifecycle path", () => {
    expect(browserSuite.match(/modules\.applyDraftLifecycle\(\{/g)).toHaveLength(3);
    expect(browserSuite.match(/evaluateStep: \(step\) => evaluateStep\(actor, draft, step, modules\)/g)).toHaveLength(
      3
    );
    expect(browserSuite).not.toMatch(/modules\.applyDraftLifecycle\(\{[\s\S]*?isStepComplete:/);
    expect(browserSuite).toContain("evaluateWayfinderStep: planService.evaluateWayfinderStep");
  });
});
