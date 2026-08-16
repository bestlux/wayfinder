import { describe, expect, it } from "vitest";
import { CHARACTER_WEALTH_POLICY_REF, getCharacterWealthRow } from "../src/wayfinder/domain/character-wealth-policy.js";

const permanentRecipeCurrencyCopper = [
  1_500, 2_000, 2_500, 3_000, 5_000, 8_000, 12_500, 18_000, 25_000, 35_000, 50_000, 70_000, 100_000, 150_000, 225_000,
  325_000, 500_000, 750_000, 1_200_000, 2_000_000,
];
const lumpSumCopper = [
  1_500, 3_000, 7_500, 14_000, 27_000, 45_000, 72_000, 110_000, 160_000, 230_000, 320_000, 450_000, 640_000, 930_000,
  1_350_000, 2_000_000, 3_000_000, 4_500_000, 6_900_000, 11_200_000,
];

describe("Character Wealth policy", () => {
  it("exposes one stable semantic policy reference without generator provenance", () => {
    expect(CHARACTER_WEALTH_POLICY_REF).toEqual({
      policyId: "pf2e-remaster-character-wealth",
      policyVersion: 1,
      dataDigest: "sha256:5132c172229b4e61e14e197f733a509b1b8869782f021102af878b6ea3e37b73",
    });
    expect(Object.isFrozen(CHARACTER_WEALTH_POLICY_REF)).toBe(true);
    expect(Object.keys(CHARACTER_WEALTH_POLICY_REF).sort()).toEqual(["dataDigest", "policyId", "policyVersion"]);
  });

  it("returns every reviewed remaster row exactly", () => {
    for (let characterLevel = 1; characterLevel <= 20; characterLevel += 1) {
      const row = getCharacterWealthRow(characterLevel);
      expect(row).toEqual({
        characterLevel,
        permanentItemAllowances: expectedAllowances(characterLevel),
        permanentRecipeCurrencyCopper: permanentRecipeCurrencyCopper[characterLevel - 1],
        lumpSumCopper: lumpSumCopper[characterLevel - 1],
      });
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.permanentItemAllowances)).toBe(true);
      expect(row.permanentItemAllowances.every(Object.isFrozen)).toBe(true);
    }
  });

  it.each([
    0,
    21,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid character level %s", (characterLevel) => {
    expect(() => getCharacterWealthRow(characterLevel)).toThrow(RangeError);
  });
});

function expectedAllowances(characterLevel: number) {
  if (characterLevel === 1) return [];
  if (characterLevel === 2) return [{ itemLevel: 1, count: 1 }];
  if (characterLevel === 3) {
    return [
      { itemLevel: 2, count: 1 },
      { itemLevel: 1, count: 2 },
    ];
  }
  if (characterLevel === 4) {
    return [
      { itemLevel: 3, count: 1 },
      { itemLevel: 2, count: 2 },
      { itemLevel: 1, count: 1 },
    ];
  }
  return [
    { itemLevel: characterLevel - 1, count: 1 },
    { itemLevel: characterLevel - 2, count: 2 },
    { itemLevel: characterLevel - 3, count: 1 },
    { itemLevel: characterLevel - 4, count: 2 },
  ];
}
