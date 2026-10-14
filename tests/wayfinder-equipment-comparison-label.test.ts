import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcquisitionLocalize } from "../src/wayfinder/application/acquisition-localization";
import { localizeEquipmentComparison } from "../src/wayfinder/panes/equipment-comparison-label";
import { localizeAcquisitionEnglish } from "./fixtures/acquisition-localization-fixture";

afterEach(() => vi.unstubAllGlobals());

describe("equipment comparison copy", () => {
  it("localizes damage types through PF2E and preserves source modifiers and additional-effect qualification", () => {
    vi.stubGlobal("CONFIG", { PF2E: { damageTypes: { slashing: "PF2E.Damage.RollFlavor.slashing" } } });
    const localize: AcquisitionLocalize = (key, values) =>
      key === "PF2E.Damage.RollFlavor.slashing" ? "slashing" : localizeAcquisitionEnglish(key, values);
    const comparison = localizeEquipmentComparison(
      {
        kind: "weapon",
        primary: { dice: 3, die: "d12", modifier: -2, damageType: "slashing" },
        hasAdditionalEffects: true,
        includesStriking: true,
      },
      localize
    );
    expect(comparison.label).toBe("Damage: 3d12−2 slashing · effects");
    expect(comparison.explanation).toContain("default use");
  });

  it("uses flat damage without zero dice and readable custom types when PF2E localization is unavailable", () => {
    expect(
      localizeEquipmentComparison(
        {
          kind: "weapon",
          primary: { dice: 0, die: null, modifier: 1, damageType: "acid" },
          hasAdditionalEffects: true,
          includesStriking: false,
        },
        localizeAcquisitionEnglish
      ).label
    ).toBe("Damage: 1 acid · effects");
    vi.stubGlobal("CONFIG", { PF2E: { damageTypes: { custom: "missing-localization" } } });
    expect(
      localizeEquipmentComparison(
        {
          kind: "weapon",
          primary: { dice: 1, die: "d6", modifier: 2, damageType: "custom" },
          hasAdditionalEffects: false,
          includesStriking: false,
        },
        localizeAcquisitionEnglish
      ).label
    ).toBe("Damage: 1d6+2 custom");
  });

  it("distinguishes absent comparisons, unavailable statistics and explicit zero shield AC", () => {
    expect(localizeEquipmentComparison(null, localizeAcquisitionEnglish)).toEqual({ label: null, explanation: null });
    expect(
      localizeEquipmentComparison(
        { kind: "weapon", primary: null, hasAdditionalEffects: true, includesStriking: false },
        localizeAcquisitionEnglish
      ).label
    ).toBe("Damage — see details");
    expect(localizeEquipmentComparison({ kind: "shield", acBonus: null }, localizeAcquisitionEnglish).label).toBe(
      "AC unavailable — see details"
    );
    expect(localizeEquipmentComparison({ kind: "shield", acBonus: 0 }, localizeAcquisitionEnglish).label).toBe(
      "AC +0 when raised"
    );
  });

  it("localizes the same weapon and shield facts in Simplified Chinese", () => {
    const chinese = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"));
    const localize: AcquisitionLocalize = (key, values) => {
      if (key === "PF2E.Damage.RollFlavor.slashing") return "挥砍";
      const template = key.split(".").reduce((value, part) => value?.[part], chinese);
      if (typeof template !== "string") throw new Error(`Missing localization: ${key}`);
      return template.replace(/\{([^}]+)\}/gu, (_match, name: string) => String(values?.[name] ?? ""));
    };
    vi.stubGlobal("CONFIG", { PF2E: { damageTypes: { slashing: "PF2E.Damage.RollFlavor.slashing" } } });
    expect(
      localizeEquipmentComparison(
        {
          kind: "weapon",
          primary: { dice: 1, die: "d8", modifier: 0, damageType: "slashing" },
          hasAdditionalEffects: false,
          includesStriking: false,
        },
        localize
      ).label
    ).toBe("伤害：1d8 挥砍");
    expect(localizeEquipmentComparison({ kind: "shield", acBonus: 2 }, localize).label).toBe("举盾时 AC +2");
  });
});
