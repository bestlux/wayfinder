import { describe, expect, it } from "vitest";
import {
  type EquipmentProfileStageCompletion,
  type EquipmentProfileStageStart,
  profileEquipmentStage,
  registerEquipmentProfileStageObserver,
} from "../src/wayfinder/application/equipment-performance-profiler.js";

describe("equipment performance profiler", () => {
  it("keeps the direct operation path when no observer is installed", () => {
    let calls = 0;
    const result = profileEquipmentStage("criteria-rank", () => {
      calls += 1;
      return "ready";
    });
    expect(result).toBe("ready");
    expect(calls).toBe(1);
  });

  it("binds nested async completions to their start owners with rederived durations", async () => {
    const starts: EquipmentProfileStageStart[] = [];
    const completions: Array<{ event: EquipmentProfileStageCompletion; owner: unknown }> = [];
    const restore = registerEquipmentProfileStageObserver({
      start(event) {
        starts.push(event);
        return `owner-${event.id}`;
      },
      complete(event, owner) {
        completions.push({ event, owner });
      },
    });
    try {
      await profileEquipmentStage("equipment-ui-projection", async () => {
        await profileEquipmentStage("drafted-size-resolution", async () => Promise.resolve());
      });
    } finally {
      restore();
    }

    expect(starts.map((event) => event.stage)).toEqual(["equipment-ui-projection", "drafted-size-resolution"]);
    expect(completions.map(({ event }) => event.stage)).toEqual(["drafted-size-resolution", "equipment-ui-projection"]);
    for (const { event, owner } of completions) {
      expect(owner).toBe(`owner-${event.id}`);
      expect(event.status).toBe("completed");
      expect(event.durationMs).toBeCloseTo(event.completedAt - event.startedAt, 6);
    }
  });

  it("reports failures without changing the thrown value and ignores observer failures", () => {
    const expected = new Error("expected");
    const restore = registerEquipmentProfileStageObserver({
      start() {
        throw new Error("observer start failed");
      },
      complete() {
        throw new Error("observer completion failed");
      },
    });
    try {
      expect(() =>
        profileEquipmentStage("actor-pricing-fingerprint", () => {
          throw expected;
        })
      ).toThrow(expected);
    } finally {
      restore();
    }
  });
});
