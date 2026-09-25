import type { SelectionRef } from "../../types.js";
import type { ClassArchetypeProfile } from "./registry.js";

function feature(documentId: string, name: string, slug: string): Omit<SelectionRef, "slotId"> {
  return {
    packId: "pf2e.classfeatures",
    documentId,
    uuid: `Compendium.pf2e.classfeatures.Item.${documentId}`,
    itemType: "feat",
    featType: "classfeature",
    name,
    slug,
    level: 1,
  };
}

function dedication(documentId: string, name: string, slug: string): Omit<SelectionRef, "slotId"> {
  return {
    packId: "pf2e.feats-srd",
    documentId,
    uuid: `Compendium.pf2e.feats-srd.Item.${documentId}`,
    itemType: "feat",
    featType: "class",
    name,
    slug,
    level: 2,
  };
}

export const BLOODRAGER: ClassArchetypeProfile = {
  value: "bloodrager",
  label: "Bloodrager",
  detail:
    "Choose the bloodrager instinct, train in Athletics and Medicine, and gain arcane or divine cantrips through the required 2nd-level dedication. Guided through level 5; combining this path with Free Archetype requires manual GM setup.",
  img: "icons/skills/wounds/blood-cells-vessel-red-orange.webp",
  decisionSlotId: "class-archetype-instinct-level-1",
  classSlug: "barbarian",
  selectorTag: "barbarian-instinct",
  selector: {
    selection: feature("dU7xRpg4kFd01hwZ", "Instinct", "instinct"),
    flag: "instinct",
    ruleIndex: 0,
  },
  selection: feature("qwvO0B9t7LgQCVbV", "Bloodrager", "bloodrager"),
  initialTraining: { fixedSkills: ["athletics", "medicine"], additional: 2 },
  reservedClassFeatLevels: [2],
  dedicationName: "Bloodrager Dedication",
  projectedFeatGrants: [
    {
      minimumLevel: 2,
      selection: dedication("EcyPTxSwtdqrOtxY", "Bloodrager Dedication", "bloodrager-dedication"),
      staticFeatGrants: [],
    },
  ],
  fallbackFeatChoices: [],
  internalClassFeatureChoices: [],
};

export const VINDICATOR: ClassArchetypeProfile = {
  value: "vindicator",
  label: "Vindicator",
  detail:
    "Follow a deity as a vindicator, replacing the standard hunter's edge and Nature training, with divine warden magic and a required 2nd-level dedication. Guided through level 5; combining this path with Free Archetype requires manual GM setup.",
  img: "icons/magic/holy/saint-stained-glass.webp",
  decisionSlotId: "class-archetype-hunters-edge-level-1",
  classSlug: "ranger",
  selectorTag: "ranger-hunters-edge",
  selector: {
    selection: feature("mzkkj9LEWjJPBhaq", "Hunter's Edge", "hunters-edge"),
    flag: "huntersEdge",
    ruleIndex: 0,
  },
  selection: feature("QOOwC3S41CKGkxlN", "Vindicator", "vindicator"),
  initialTraining: { fixedSkills: ["religion", "survival"] },
  reservedClassFeatLevels: [2],
  dedicationName: "Vindicator Dedication",
  projectedFeatGrants: [
    {
      minimumLevel: 2,
      selection: dedication("vU86WnzVmfTde7xc", "Vindicator Dedication", "vindicator-dedication"),
      staticFeatGrants: [],
    },
  ],
  fallbackFeatChoices: [],
  internalClassFeatureChoices: [],
};
