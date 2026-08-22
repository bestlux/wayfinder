import { describe, expect, it } from "vitest";
import type { ActorItemLike } from "../src/shared/actor-model";
import type { PendingStep, SelectionRef } from "../src/types";
import { isSelectionMaterializedOnActor } from "../src/wayfinder/application/selection-materialization-service";

const selectorUuid = "Compendium.pf2e.feats-srd.Item.rogueDedication";
const selectionUuid = "Compendium.pf2e.feats-srd.Item.catFall";

const selection: SelectionRef = {
  slotId: "grant-choice-rogue-dedication-skill-feat-level-1",
  packId: "pf2e.feats-srd",
  documentId: "catFall",
  uuid: selectionUuid,
  itemType: "feat",
  featType: "skill",
  name: "Cat Fall",
  level: 1,
};

const step: PendingStep = {
  id: selection.slotId,
  slotId: selection.slotId,
  level: 1,
  kind: "pick-item",
  slotKind: "grant-choice",
  title: "Rogue Dedication feat grant",
  description: "",
  required: true,
  filters: { itemType: "feat" },
  grantSelection: {
    slotId: selection.slotId,
    sourceItemType: "feat",
    selectorPackId: "pf2e.feats-srd",
    selectorDocumentId: "rogueDedication",
    selectorUuid,
    selectorName: "Rogue Dedication",
    selectorRuleIndex: 3,
    grantRuleIndex: 4,
    flag: "skillFeat",
    itemType: "feat",
    classSlug: null,
    dependsOn: null,
    filters: { itemType: "feat" },
  },
};

describe("selection materialization", () => {
  it("accepts a retry when PF2E already materialized the selected native grant with exact bidirectional provenance", () => {
    const items: ActorItemLike[] = [
      actorItem("rogue-dedication", selectorUuid, {
        itemGrants: { catFall: { id: "cat-fall", onDelete: "detach" } },
      }),
      actorItem("cat-fall", selectionUuid, {
        grantedBy: { id: "rogue-dedication", onDelete: "cascade" },
      }),
    ];

    expect(isSelectionMaterializedOnActor(items, selection, step)).toBe(true);
  });

  it.each([
    {
      label: "unowned duplicate",
      items: [actorItem("cat-fall", selectionUuid)],
    },
    {
      label: "wrong granter source",
      items: [
        actorItem("wrong-parent", "Compendium.pf2e.feats-srd.Item.other", {
          itemGrants: { catFall: { id: "cat-fall" } },
        }),
        actorItem("cat-fall", selectionUuid, { grantedBy: { id: "wrong-parent" } }),
      ],
    },
    {
      label: "missing reverse grant link",
      items: [
        actorItem("rogue-dedication", selectorUuid),
        actorItem("cat-fall", selectionUuid, { grantedBy: { id: "rogue-dedication" } }),
      ],
    },
  ])("rejects a $label as proof of native-grant recovery", ({ items }) => {
    expect(isSelectionMaterializedOnActor(items, selection, step)).toBe(false);
  });
});

function actorItem(
  id: string,
  sourceId: string,
  pf2e: NonNullable<NonNullable<ActorItemLike["flags"]>["pf2e"]> = {}
): ActorItemLike {
  return {
    id,
    name: id,
    type: "feat",
    flags: { core: { sourceId }, pf2e },
    system: {},
  };
}
