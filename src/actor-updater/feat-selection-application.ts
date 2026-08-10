import {
  type CampaignFeatSlotAuthority,
  campaignFeatAllowsCandidate,
  resolveCampaignFeatSlotSetting,
} from "../campaign-feat-sections.js";
import { fetchSelectionDocument } from "../pack/access.js";
import type { ActorLike, FeatSlotLike, LooseRecord } from "../shared/actor-model.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import type { InsertFeatSelectionDependencies } from "./selection-dependencies.js";
import { stampSelectionFlags } from "./selection-flags.js";
import { createEmbeddedSource } from "./selection-source-application.js";

const DEFAULT_INSERT_DEPS: InsertFeatSelectionDependencies = {
  fetchSelectionDocument,
  createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
  resolveCampaignFeatSlot: resolveCampaignFeatSlotSetting,
};

export async function insertFeatSelection(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null,
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS,
  draft?: DraftState,
  steps: PendingStep[] = []
): Promise<void> {
  const source = await deps.createEmbeddedSource(selection, draft, steps);
  if (!source) {
    return;
  }

  const slotData = resolveFeatSlotData(
    actor,
    selection,
    step,
    source,
    deps.resolveCampaignFeatSlot ?? resolveCampaignFeatSlotSetting
  );
  if (slotData) {
    applyFeatSlotData(source, slotData, step);
  }

  if (typeof actor.createEmbeddedDocuments === "function") {
    const inserted = await actor.createEmbeddedDocuments("Item", [source]);
    await stampSelectionFlags(actor, inserted, selection);
  }
}

function applyFeatSlotData(
  source: LooseRecord,
  slotData: { groupId: string; slotId: string | null },
  step: PendingStep | null
): void {
  source.system ??= {};
  const system = source.system as LooseRecord;
  system.location = slotData.slotId ?? slotData.groupId;
  system.level ??= {};
  if (typeof step?.level === "number") {
    (system.level as LooseRecord).taken = step.level;
  }
}

function resolveFeatSlotData(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null,
  source: LooseRecord,
  resolveCampaignFeatSlot: (sectionId: string, slotId: string) => CampaignFeatSlotAuthority | null
): { groupId: string; slotId: string | null } | null {
  const groupId = resolveFeatGroupId(selection, step);
  if (!groupId) {
    return null;
  }

  const group = (typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId]) as
    | { slots?: Record<string, FeatSlotLike> }
    | null
    | undefined;
  if (step?.slotKind === "campaign-feat") {
    const campaignFeat = step.campaignFeat;
    if (!campaignFeat) {
      throw new Error("PF2E's campaign feat metadata is unavailable; the draft cannot be applied safely.");
    }

    const authority = resolveCampaignFeatSlot(campaignFeat.sectionId, campaignFeat.groupSlotId);
    if (!authority || authority.slot.level !== step.level) {
      throw new Error("PF2E's campaign feat slot configuration changed; the draft cannot be applied safely.");
    }
    if (!campaignFeatAllowsCandidate(authority.supported, authority.filter, featCategory(source), featTraits(source))) {
      throw new Error(
        "The campaign feat no longer matches PF2E's current slot filters; the draft cannot be applied safely."
      );
    }
    if (!group) {
      throw new Error("PF2E's campaign feat group is unavailable; the draft cannot be applied safely.");
    }

    const slot = group.slots?.[campaignFeat.groupSlotId];
    if (slot && (slot.level !== step.level || slot.feat)) {
      throw new Error("PF2E's campaign feat slot is unavailable; the draft cannot be applied safely.");
    }

    return {
      groupId,
      slotId: campaignFeat.groupSlotId,
    };
  }

  if (step?.slotKind === "archetype-feat") {
    if (!group) {
      throw new Error("PF2E's Free Archetype feat group is unavailable; the draft cannot be applied safely.");
    }

    return {
      groupId,
      slotId: `archetype-${step.level}`,
    };
  }

  const slots = Object.values(group?.slots ?? {});
  if (slots.length === 0) {
    return { groupId, slotId: null };
  }

  const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
  const firstOpen = slots.find((slot) => !slot.feat);
  return {
    groupId,
    slotId: matchingLevel?.id ?? firstOpen?.id ?? null,
  };
}

function featCategory(source: LooseRecord): string | null {
  const system = source.system as LooseRecord | undefined;
  const category = normalizedString(system?.category);
  if (category) {
    return category;
  }

  const featType = system?.featType as LooseRecord | undefined;
  return normalizedString(featType?.value);
}

function featTraits(source: LooseRecord): string[] {
  const system = source.system as LooseRecord | undefined;
  const traits = system?.traits as LooseRecord | undefined;
  return Array.isArray(traits?.value)
    ? Array.from(new Set(traits.value.map(normalizedString).filter((value): value is string => !!value)))
    : [];
}

function normalizedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function resolveFeatGroupId(selection: SelectionRef, step: PendingStep | null): string | null {
  switch (step?.slotKind) {
    case "ancestry-feat":
      return "ancestry";
    case "class-feat":
      return "class";
    case "archetype-feat":
      return "archetype";
    case "campaign-feat":
      return step.campaignFeat?.sectionId ?? null;
    case "skill-feat":
      return "skill";
    case "general-feat":
      return "general";
    default:
      switch (selection.featType) {
        case "ancestry":
          return "ancestry";
        case "class":
        case "archetype":
          return "class";
        case "skill":
          return "skill";
        case "general":
          return "general";
        default:
          return null;
      }
  }
}
