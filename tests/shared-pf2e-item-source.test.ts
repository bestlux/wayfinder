import { describe, expect, it } from "vitest";
import type { ActorItemLike, EmbeddedItemSource, LooseRecord } from "../src/shared/actor-model";
import {
  applyRuleSelectionToSource,
  buildGrantedItemUpdate,
  buildItemGrantRecord,
  queueRuleSelectionUpdate,
  stampGrantedItemSource,
  stampImportedItemSource,
} from "../src/shared/pf2e-item-source";

describe("shared PF2E item source helpers", () => {
  it("stamps imported item sources with Foundry/PF2E source metadata and module flags", () => {
    const source: EmbeddedItemSource = {
      _id: "compendium-id",
      flags: {
        "wayfinder-pf2e": {
          custom: true,
        },
      },
    };

    stampImportedItemSource(source, {
      sourceId: "Compendium.pf2e.feats-srd.Item.Titan Swing",
      slotId: "grant-choice-none-background-wanderlust-feat-level-1",
    });

    expect(source._id).toBeUndefined();
    expect(source._stats?.compendiumSource).toBe("Compendium.pf2e.feats-srd.Item.Titan Swing");
    expect(source.flags?.core?.sourceId).toBe("Compendium.pf2e.feats-srd.Item.Titan Swing");
    expect(source.flags?.["wayfinder-pf2e"]).toMatchObject({
      custom: true,
      importedBy: "wayfinder-pf2e",
      slotId: "grant-choice-none-background-wanderlust-feat-level-1",
    });
  });

  it("stamps granted item sources and builds matching update records", () => {
    const source: EmbeddedItemSource = {
      flags: {
        core: {
          sourceId: "old-source",
        },
      },
    };

    stampGrantedItemSource(source, {
      sourceId: "Compendium.pf2e.feats-srd.Item.Everyday Form",
      slotId: "grant-choice-none-heritage-steadfast-tanuki-feat-level-1",
      granterId: "heritage-id",
    });

    expect(source.flags?.core?.sourceId).toBe("Compendium.pf2e.feats-srd.Item.Everyday Form");
    expect(source.flags?.pf2e?.grantedBy).toEqual({
      id: "heritage-id",
      onDelete: "cascade",
    });
    expect(source.flags?.["wayfinder-pf2e"]?.slotId).toBe("grant-choice-none-heritage-steadfast-tanuki-feat-level-1");

    expect(
      buildGrantedItemUpdate("created-id", {
        sourceId: "Compendium.pf2e.feats-srd.Item.Everyday Form",
        slotId: "grant-choice-none-heritage-steadfast-tanuki-feat-level-1",
        granterId: "heritage-id",
      })
    ).toEqual({
      _id: "created-id",
      "flags.core.sourceId": "Compendium.pf2e.feats-srd.Item.Everyday Form",
      "flags.pf2e.grantedBy": {
        id: "heritage-id",
        onDelete: "cascade",
      },
      "flags.wayfinder-pf2e.importedBy": "wayfinder-pf2e",
      "flags.wayfinder-pf2e.slotId": "grant-choice-none-heritage-steadfast-tanuki-feat-level-1",
    });
  });

  it("applies rule selections to embedded sources and queued item updates without mutating actor items", () => {
    const source: EmbeddedItemSource = {
      system: {
        rules: [{ key: "ChoiceSet", flag: "school" }],
      },
    };

    applyRuleSelectionToSource(source, 0, "school", "cascade-bearers");

    expect(source.system?.rules?.[0]?.selection).toBe("cascade-bearers");
    expect(source.flags?.pf2e?.rulesSelections).toEqual({
      school: "cascade-bearers",
    });

    const item: ActorItemLike = {
      id: "source-item-id",
      system: {
        rules: [{ key: "ChoiceSet", flag: "trainedSkill" }],
      },
    };
    const updates = new Map<string, LooseRecord>();

    queueRuleSelectionUpdate(updates, item, 0, "trainedSkill", "arcana");

    expect(item.system?.rules?.[0]?.selection).toBeUndefined();
    expect(updates.get("source-item-id")).toEqual({
      _id: "source-item-id",
      "system.rules": [{ key: "ChoiceSet", flag: "trainedSkill", selection: "arcana" }],
      "flags.pf2e.rulesSelections.trainedSkill": "arcana",
    });
  });

  it("builds PF2E item grant records with optional nested metadata", () => {
    expect(buildItemGrantRecord("granted-id")).toEqual({
      id: "granted-id",
      onDelete: "detach",
    });
    expect(buildItemGrantRecord("granted-id", { nested: null })).toEqual({
      id: "granted-id",
      onDelete: "detach",
      nested: null,
    });
  });
});
