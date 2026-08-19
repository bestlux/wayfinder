import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProgressionPlan } from "../src/types";
import { resolveStartingEquipmentRenderPlan } from "../src/wayfinder/application/starting-equipment-ui-adapter";

const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");

describe("starting equipment search isolation", () => {
  it("schedules an equipment-only render without rebuilding the character plan from the input handler", () => {
    const start = appShell.indexOf("  #onEquipmentSearchInput = ");
    const end = appShell.indexOf("#renderPickerSearch", start);
    const handler = appShell.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain("#equipmentSearchScheduler.schedule(stepId, input.value)");
    expect(handler).toContain("wayfinderEquipmentUpdate: true");
    expect(handler).not.toContain("#buildPlan(");
  });

  it("reuses the cached render plan for equipment search and cart renders", async () => {
    const cachedPlan = { targetLevel: 1, steps: [] } as ProgressionPlan;
    const buildPlan = vi.fn(async () => ({ targetLevel: 1, steps: [] }) as ProgressionPlan);

    await expect(
      resolveStartingEquipmentRenderPlan({
        equipmentOnlyUpdate: true,
        targetLevel: 1,
        cachedPlan,
        buildPlan,
      })
    ).resolves.toBe(cachedPlan);
    expect(buildPlan).not.toHaveBeenCalled();
    expect(appShell).toContain("this.render({ wayfinderEquipmentUpdate: true })");
  });
});
