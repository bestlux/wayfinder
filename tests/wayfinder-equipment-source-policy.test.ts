import { describe, expect, it } from "vitest";
import {
  discoverInstalledEquipmentPackDescriptors,
  normalizePf2eEquipmentSources,
} from "../src/wayfinder/application/equipment-source-policy";

describe("equipment source isolation", () => {
  it("enables installed PF2E equipment descriptors when the raw world entry is absent", () => {
    const installedEquipmentPacks = discoverInstalledEquipmentPackDescriptors({
      packs: packs([
        pack("pf2e.equipment-srd", "Item"),
        pack("battlezoo.dragon-equipment", "Item"),
        pack("battlezoo.dragon-feats", "Item"),
      ]),
      pf2eEquipmentPacks: {
        "pf2e.equipment-srd": { name: "Equipment", package: "pf2e" },
        "battlezoo.dragon-equipment": { name: "Dragon Equipment", package: "battlezoo" },
      },
    });

    expect(
      normalizePf2eEquipmentSources({
        installedEquipmentPacks,
        allowedPackFamilies: ["pf2e", "battlezoo"],
        compendiumBrowserPacks: { equipment: { "pf2e.equipment-srd": { load: true } } },
        compendiumBrowserSources: { sources: {} },
      }).effectivePackIds
    ).toEqual(["battlezoo.dragon-equipment", "pf2e.equipment-srd"]);
    expect(installedEquipmentPacks.map((descriptor) => descriptor.id)).not.toContain("battlezoo.dragon-feats");
  });

  it("honors explicit load false without inheriting role-dependent source visibility", () => {
    const result = normalizePf2eEquipmentSources({
      installedEquipmentPacks: descriptors("pf2e.equipment-srd", "battlezoo.dragon-equipment"),
      allowedPackFamilies: ["pf2e", "battlezoo"],
      compendiumBrowserPacks: { equipment: { "battlezoo.dragon-equipment": { load: false } } },
      compendiumBrowserSources: {
        ignoreAsGM: true,
        showEmptySources: true,
        showUnknownSources: false,
        sources: { enabled: {}, disabled: { load: false } },
      },
    });

    expect(result).toMatchObject({
      effectivePackIds: ["pf2e.equipment-srd"],
      enabledSourceSlugs: ["enabled"],
      knownSourceSlugs: ["disabled", "enabled"],
      showEmptySources: true,
      showUnknownSources: false,
    });
  });

  it("fails malformed settings into the bounded installed equipment projection", () => {
    const result = normalizePf2eEquipmentSources({
      installedEquipmentPacks: descriptors("pf2e.equipment-srd", "battlezoo.dragon-equipment"),
      allowedPackFamilies: ["pf2e"],
      compendiumBrowserPacks: { equipment: "corrupt", feat: { "pf2e.feats-srd": { load: true } } },
      compendiumBrowserSources: { sources: ["corrupt"], ignoreAsGM: false },
    });

    expect(result).toEqual({
      effectivePackIds: ["pf2e.equipment-srd"],
      enabledSourceSlugs: [],
      knownSourceSlugs: [],
      showEmptySources: false,
      showUnknownSources: false,
      diagnostics: [],
    });
  });

  it("returns stable diagnostics for allowed stale and non-Item equipment descriptors", () => {
    const result = normalizePf2eEquipmentSources({
      installedEquipmentPacks: [
        ...descriptors("pf2e.equipment-srd"),
        {
          id: "broken.journals",
          family: "broken",
          label: "Broken Journals",
          packageName: "broken",
          documentName: "JournalEntry",
        },
      ],
      allowedPackFamilies: ["missing", "broken", "pf2e"],
      compendiumBrowserPacks: {
        equipment: {
          "missing.items": {},
          "broken.journals": { load: true },
          "missing.disabled": { load: false },
        },
      },
      compendiumBrowserSources: {},
    });

    expect(result.effectivePackIds).toEqual(["pf2e.equipment-srd"]);
    expect(result.diagnostics).toEqual([
      {
        code: "equipment-pack-not-item",
        packId: "broken.journals",
        sourceIdentity: null,
        message: "Equipment pack broken.journals is not an Item compendium and was excluded.",
      },
      {
        code: "equipment-pack-missing",
        packId: "missing.items",
        sourceIdentity: null,
        message: "Enabled equipment pack missing.items is not installed or is unavailable to the current user.",
      },
    ]);
  });
});

function descriptors(...ids: string[]) {
  return ids.map((id) => ({
    id,
    family: id.split(".")[0]!,
    label: id,
    packageName: id.split(".")[0]!,
    documentName: "Item",
  }));
}

function pack(id: string, documentName: string) {
  return {
    collection: id,
    documentName,
    metadata: { id, type: documentName, label: id, packageName: id.split(".")[0] },
  };
}

function packs(values: readonly ReturnType<typeof pack>[]) {
  return new Map(values.map((value) => [value.collection, value]));
}
