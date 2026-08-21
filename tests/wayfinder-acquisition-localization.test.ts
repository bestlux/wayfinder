import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { localizeEquipmentSourceDiagnostic } from "../src/wayfinder/application/acquisition-localization";
import type { EquipmentSourceDiagnosticCode } from "../src/wayfinder/application/equipment-source-policy";
import { localizeAcquisitionEnglish } from "./fixtures/acquisition-localization-fixture";

const english = readLocale("lang/en.json");
const chinese = readLocale("lang/cn.json");
const trees = ["StartingEquipment", "AcquisitionReceipt"] as const;
const implementationCorpus = [
  "src/wayfinder/app-shell.ts",
  "src/wayfinder/application/acquisition-localization.ts",
  "src/wayfinder/panes/starting-equipment-pane.ts",
  "src/wayfinder/panes/acquisition-receipt.ts",
  "src/wayfinder/application/starting-equipment-command-service.ts",
  "templates/wayfinder/starting-equipment-pane.hbs",
  "templates/wayfinder/starting-equipment-policy.hbs",
  "templates/wayfinder/starting-equipment-status.hbs",
  "templates/wayfinder/starting-equipment-state.hbs",
  "templates/wayfinder/starting-equipment-catalogue.hbs",
  "templates/wayfinder/starting-equipment-detail.hbs",
  "templates/wayfinder/starting-equipment-cart.hbs",
  "templates/wayfinder/acquisition-receipt.hbs",
]
  .map((path) => readFileSync(resolve(path), "utf8"))
  .join("\n");

describe("starting-equipment localization", () => {
  it("keeps recursive English and Chinese key parity with nonempty values and matching placeholders", () => {
    for (const tree of trees) {
      const englishEntries = flatten(localeTree(english, tree));
      const chineseEntries = flatten(localeTree(chinese, tree));

      expect([...englishEntries.keys()].sort()).toEqual([...chineseEntries.keys()].sort());
      for (const [key, englishValue] of englishEntries) {
        const chineseValue = chineseEntries.get(key);
        expect(englishValue.trim(), `${tree}.${key} English`).not.toBe("");
        expect(chineseValue?.trim(), `${tree}.${key} Chinese`).not.toBe("");
        expect(placeholders(chineseValue ?? ""), `${tree}.${key} placeholders`).toEqual(placeholders(englishValue));
        expect(englishValue).not.toMatch(/^wayfinder-pf2e\./u);
        expect(chineseValue).not.toMatch(/^wayfinder-pf2e\./u);
      }
    }
  });

  it("keeps every acquisition key referenced by its presentation boundary", () => {
    for (const tree of trees) {
      for (const key of flatten(localeTree(english, tree)).keys()) {
        const fullKey = `wayfinder-pf2e.${tree}.${key}`;
        if (tree === "StartingEquipment" && key.startsWith("Status.")) {
          const suffixReference = `"${key.slice("Status.".length)}"`;
          expect(
            implementationCorpus.includes(fullKey) || implementationCorpus.includes(suffixReference),
            fullKey
          ).toBe(true);
        } else {
          expect(implementationCorpus, fullKey).toContain(fullKey);
        }
      }
    }
  });

  it("leaves no hard-coded visible prose in the acquisition templates", () => {
    for (const path of [
      "templates/wayfinder/starting-equipment-pane.hbs",
      "templates/wayfinder/starting-equipment-policy.hbs",
      "templates/wayfinder/starting-equipment-status.hbs",
      "templates/wayfinder/starting-equipment-state.hbs",
      "templates/wayfinder/starting-equipment-catalogue.hbs",
      "templates/wayfinder/starting-equipment-detail.hbs",
      "templates/wayfinder/starting-equipment-cart.hbs",
      "templates/wayfinder/acquisition-receipt.hbs",
    ]) {
      const template = readFileSync(resolve(path), "utf8");
      const visibleText = [...template.matchAll(/>([^<]+)</gu)]
        .map((match) => (match[1] ?? "").replace(/\{\{[^}]+\}\}/gu, "").replace(/[\s·:×↳+−,.]/gu, ""))
        .filter(Boolean);
      expect(visibleText, path).toEqual([]);
    }
  });

  it("translates every typed equipment-source diagnostic at the presentation boundary", () => {
    const codes: readonly EquipmentSourceDiagnosticCode[] = [
      "equipment-pack-missing",
      "equipment-pack-not-item",
      "equipment-pack-index-failed",
      "equipment-pack-index-corrupt",
      "equipment-source-identity-corrupt",
      "duplicate-equipment-source-identity",
    ];
    for (const code of codes) {
      const message = localizeEquipmentSourceDiagnostic(localizeAcquisitionEnglish, {
        code,
        packId: "pf2e.equipment-srd",
        sourceIdentity: "Compendium.pf2e.equipment-srd.Item.test",
        message: "Internal English diagnostic remains domain-owned.",
      });
      expect(message).not.toBe("Internal English diagnostic remains domain-owned.");
      expect(message).not.toMatch(/^wayfinder-pf2e\./u);
    }
  });

  it("preserves the frozen Wave 2 recovery strings in the English locale", () => {
    const startingEquipment = localeTree(english, "StartingEquipment");
    const apply = startingEquipment.Apply;
    expect(isRecord(apply) ? apply.Partial : null).toBe(
      "Wayfinder partially applied this draft. Retry Apply without changing choices; details are in the console."
    );
    expect(isRecord(apply) ? apply.LateError : null).toBe(
      "The actor reached the reviewed final state, but Foundry reported a late Apply error. Review the actor before closing."
    );
  });
});

function readLocale(path: string): Readonly<Record<string, unknown>> {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as Readonly<Record<string, unknown>>;
}

function localeTree(locale: Readonly<Record<string, unknown>>, tree: string): Readonly<Record<string, unknown>> {
  const module = locale["wayfinder-pf2e"];
  const value = isRecord(module) ? module[tree] : null;
  if (!isRecord(value)) throw new Error(`Missing localization tree: ${tree}`);
  return value;
}

function flatten(root: Readonly<Record<string, unknown>>, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") entries.set(path, value);
    else if (isRecord(value))
      for (const [nestedKey, nestedValue] of flatten(value, path)) entries.set(nestedKey, nestedValue);
    else throw new Error(`Localization leaf is not a string: ${path}`);
  }
  return entries;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1] ?? "").sort();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
