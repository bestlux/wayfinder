import type { inspectActor } from "../../actor-inspector.js";
import { fetchSelectionDocument } from "../../pack-service.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import type {
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  DraftState,
  PendingStep,
  SelectionRef,
  SpellChoiceMeta,
} from "../../types.js";
import {
  buildClassBranchSteps,
  buildClassChoiceSteps,
  buildClassFeatSteps,
  buildClassGrantedItemSteps,
  buildClassTrainingSteps,
} from "../class-choice-service.js";
import { findDraftSelectionByType } from "../draft-decisions.js";
import {
  readExistingBranchSelection,
  readExistingClassChoiceSelection,
  readExistingGrantedSelection,
} from "../existing-selection-service.js";
import { buildWayfinderPlan } from "../plan-service.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../spell-choice-service.js";

type ActorSnapshot = ReturnType<typeof inspectActor>;
type SingletonItemType = "ancestry" | "heritage" | "background" | "class" | "deity";
type ActorLike = unknown;
type DocumentLike = unknown;

export interface BuildWayfinderAppPlanArgs {
  actor: ActorLike;
  snapshot: ActorSnapshot;
  draft: DraftState;
  resolveDocument: (itemType: SingletonItemType) => Promise<DocumentLike | null>;
  resolveArcaneSchoolDocument: () => Promise<DocumentLike | null>;
  localize: (value: string) => string;
}

interface BuildWayfinderAppPlanDependencies {
  buildWayfinderPlan: typeof buildWayfinderPlan;
  buildClassFeatSteps: typeof buildClassFeatSteps;
  buildClassTrainingSteps: typeof buildClassTrainingSteps;
  buildClassBranchSteps: typeof buildClassBranchSteps;
  buildClassGrantedItemSteps: typeof buildClassGrantedItemSteps;
  buildClassChoiceSteps: typeof buildClassChoiceSteps;
  buildSpellChoiceSteps: typeof buildSpellChoiceSteps;
  findDraftSelectionByType: (draft: DraftState, itemType: SingletonItemType) => SelectionRef | null;
  readExistingBranchSelection: (actor: ActorLike, branch: ClassBranchMeta) => string | null;
  readExistingGrantedSelection: (actor: ActorLike, grant: ClassGrantMeta) => string | null;
  readExistingClassChoiceSelection: (actor: ActorLike, choice: ClassChoiceMeta) => string | null;
  readExistingSpellChoiceSelections: (actor: ActorLike, choice: SpellChoiceMeta) => SelectionRef[];
  fetchSelectionDocument: (selection: SelectionRef) => Promise<DocumentLike | null>;
  extractDocumentSlug: (document: DocumentLike) => string | null;
}

const DEFAULT_DEPS: BuildWayfinderAppPlanDependencies = {
  buildWayfinderPlan,
  buildClassFeatSteps,
  buildClassTrainingSteps,
  buildClassBranchSteps,
  buildClassGrantedItemSteps,
  buildClassChoiceSteps,
  buildSpellChoiceSteps,
  findDraftSelectionByType,
  readExistingBranchSelection,
  readExistingGrantedSelection,
  readExistingClassChoiceSelection,
  readExistingSpellChoiceSelections,
  fetchSelectionDocument,
  extractDocumentSlug,
};

export async function buildWayfinderAppPlan(
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies = DEFAULT_DEPS
) {
  return deps.buildWayfinderPlan(args.snapshot, args.draft, {
    buildClassFeatSteps: async (planSnapshot, _planDraft, targetLevel) =>
      deps.buildClassFeatSteps({
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fulfilledCount: planSnapshot.featCounts.class + planSnapshot.featCounts.archetype,
      }),
    buildClassTrainingSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildClassTrainingSteps({
        draftClassSelection: deps.findDraftSelectionByType(planDraft, "class"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
      }),
    buildClassBranchSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildClassBranchSteps({
        draft: planDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        readExistingBranchSelection: (branch) => deps.readExistingBranchSelection(args.actor, branch),
      }),
    buildClassGrantedItemSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildClassGrantedItemSteps({
        draft: planDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        readExistingGrantedSelection: (grant) => deps.readExistingGrantedSelection(args.actor, grant),
      }),
    buildClassChoiceSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildClassChoiceSteps({
        draft: planDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        effectiveDeityDocument: await args.resolveDocument("deity"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
        readExistingClassChoiceSelection: (choice) => deps.readExistingClassChoiceSelection(args.actor, choice),
      }),
    buildSpellChoiceSteps: async (planSnapshot, planDraft, targetLevel) => {
      const effectiveClassDocument = await args.resolveDocument("class");
      const effectiveDeityDocument = await args.resolveDocument("deity");
      const effectiveSchoolDocument = await args.resolveArcaneSchoolDocument();
      const readExistingSelections = (choice: SpellChoiceMeta) =>
        deps.readExistingSpellChoiceSelections(args.actor, choice);

      return deps.buildSpellChoiceSteps({
        draft: planDraft,
        currentLevel: planSnapshot.level,
        effectiveClassDocument,
        effectiveDeityDocument,
        effectiveSchoolDocument,
        targetLevel,
        extractSlug: deps.extractDocumentSlug,
        readExistingSpellChoiceSelections: readExistingSelections,
      });
    },
  });
}

export async function findPlanStepBySlotId(
  args: BuildWayfinderAppPlanArgs,
  slotId: string,
  deps: BuildWayfinderAppPlanDependencies = DEFAULT_DEPS
): Promise<PendingStep | null> {
  const plan = await buildWayfinderAppPlan(args, deps);
  return plan.steps.find((step) => step.slotId === slotId) ?? null;
}
