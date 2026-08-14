import { listActorItems } from "../build-state.js";
import {
  type CampaignFeatSlotAuthority,
  campaignFeatAllowsCandidate,
  resolveCampaignFeatSlotSetting,
} from "../campaign-feat-sections.js";
import { fetchSelectionDocument } from "../pack/access.js";
import type { ActorItemLike, ActorLike, FeatSlotLike, LooseRecord } from "../shared/actor-model.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
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

export async function preflightFeatSelection(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null,
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS
): Promise<void> {
  const existing = (listActorItems(actor) as ActorItemLike[]).find((item) => itemMatchesSourceId(item, selection.uuid));
  const source = existing ?? (await deps.fetchSelectionDocument(selection));
  if (!source) {
    throw new Error(`The selected feat ${selection.name} is unavailable; the draft cannot be applied safely.`);
  }

  resolveFeatSlotData(
    actor,
    selection,
    step,
    source as unknown as LooseRecord,
    deps.resolveCampaignFeatSlot ?? resolveCampaignFeatSlotSetting
  );
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
    if (slot && (slot.level !== step.level || (slot.feat && !featSlotAlreadySatisfied(actor, slot, selection)))) {
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

  if (!group) {
    throw new Error(`PF2E's ${groupId} feat group is unavailable; the draft cannot be applied safely.`);
  }

  const slots = Object.values(group.slots ?? {});

  const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
  const canonicalSlotId = canonicalCoreFeatSlotId(groupId, step);
  const canonicalSlot = canonicalSlotId ? group.slots?.[canonicalSlotId] : null;
  if (canonicalSlot?.feat && !featSlotAlreadySatisfied(actor, canonicalSlot, selection)) {
    throw new Error(`PF2E's ${groupId} feat slot at level ${step?.level} is already occupied.`);
  }
  if (matchingLevel || canonicalSlotId) {
    return {
      groupId,
      slotId: matchingLevel?.id ?? canonicalSlotId,
    };
  }

  const firstOpen = slots.find((slot) => !slot.feat);
  return {
    groupId,
    slotId: firstOpen?.id ?? null,
  };
}

function featSlotAlreadySatisfied(actor: ActorLike, slot: FeatSlotLike, selection: SelectionRef): boolean {
  const slotFeat = slot.feat;
  const item =
    slotFeat && typeof slotFeat === "object"
      ? (slotFeat as ActorItemLike)
      : (listActorItems(actor) as ActorItemLike[]).find((candidate) => candidate.id === slotFeat);
  return !!item && itemMatchesSourceId(item, selection.uuid);
}

function canonicalCoreFeatSlotId(groupId: string, step: PendingStep | null): string | null {
  return typeof step?.level === "number" &&
    ["ancestry-feat", "class-feat", "skill-feat", "general-feat"].includes(step.slotKind)
    ? `${groupId}-${step.level}`
    : null;
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
