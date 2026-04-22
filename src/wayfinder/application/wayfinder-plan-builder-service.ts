import type { inspectActor } from "../../actor-inspector.js";
import type { BuildStateActor } from "../../build-state/document-types.js";
import { getEffectiveBuildState } from "../../build-state.js";
import { fetchSelectionDocument } from "../../pack-service.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import type {
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  DraftState,
  PendingStep,
  SelectionRef,
  SingletonChoiceMeta,
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
  readExistingLanguageSelections,
  readExistingSingletonChoiceSelection,
  readExistingSingletonSourceSelection,
} from "../existing-selection-service.js";
import { buildLanguageChoiceSteps } from "../language-choice-service.js";
import { buildWayfinderPlan } from "../plan-service.js";
import { buildSingletonChoiceSteps, type SingletonChoiceSourceContext } from "../singleton-choice-service.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../spell-choice-service.js";

type ActorSnapshot = ReturnType<typeof inspectActor>;
type SingletonItemType = "ancestry" | "heritage" | "background" | "class" | "deity";
type ActorLike = BuildStateActor;
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
  buildSingletonChoiceSteps: typeof buildSingletonChoiceSteps;
  buildLanguageChoiceSteps: typeof buildLanguageChoiceSteps;
  buildClassBranchSteps: typeof buildClassBranchSteps;
  buildClassGrantedItemSteps: typeof buildClassGrantedItemSteps;
  buildClassChoiceSteps: typeof buildClassChoiceSteps;
  buildSpellChoiceSteps: typeof buildSpellChoiceSteps;
  findDraftSelectionByType: (draft: DraftState, itemType: SingletonItemType) => SelectionRef | null;
  readExistingSingletonSourceSelection: (actor: ActorLike, itemType: SingletonItemType) => SelectionRef | null;
  readExistingBranchSelection: (actor: ActorLike, branch: ClassBranchMeta) => string | null;
  readExistingGrantedSelection: (actor: ActorLike, grant: ClassGrantMeta) => string | null;
  readExistingLanguageSelections: (actor: ActorLike) => string[];
  readExistingClassChoiceSelection: (actor: ActorLike, choice: ClassChoiceMeta) => string | null;
  readExistingSingletonChoiceSelection: (actor: ActorLike, choice: SingletonChoiceMeta) => string | null;
  readExistingSpellChoiceSelections: (actor: ActorLike, choice: SpellChoiceMeta) => SelectionRef[];
  fetchSelectionDocument: (selection: SelectionRef) => Promise<DocumentLike | null>;
  extractDocumentSlug: (document: DocumentLike) => string | null;
}

const DEFAULT_DEPS: BuildWayfinderAppPlanDependencies = {
  buildWayfinderPlan,
  buildClassFeatSteps,
  buildClassTrainingSteps,
  buildSingletonChoiceSteps,
  buildLanguageChoiceSteps,
  buildClassBranchSteps,
  buildClassGrantedItemSteps,
  buildClassChoiceSteps,
  buildSpellChoiceSteps,
  findDraftSelectionByType,
  readExistingSingletonSourceSelection,
  readExistingBranchSelection,
  readExistingGrantedSelection,
  readExistingLanguageSelections,
  readExistingClassChoiceSelection,
  readExistingSingletonChoiceSelection,
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
        effectiveBuildState: await getEffectiveBuildState(args.actor, planDraft),
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
      }),
    buildSingletonChoiceSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildSingletonChoiceSteps({
        draft: planDraft,
        targetLevel,
        sources: await resolveSingletonChoiceSources(planDraft, args, deps),
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
        readExistingSingletonChoiceSelection: (choice) => deps.readExistingSingletonChoiceSelection(args.actor, choice),
      }),
    buildLanguageChoiceSteps: async (planSnapshot, planDraft, targetLevel) =>
      deps.buildLanguageChoiceSteps({
        snapshot: planSnapshot,
        targetLevel,
        draft: planDraft,
        effectiveBuildState: await getEffectiveBuildState(args.actor, planDraft),
        readExistingLanguageSelections: () => deps.readExistingLanguageSelections(args.actor),
        localizeLanguage: (slug) => localizeLanguageLabel(slug),
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

function localizeLanguageLabel(slug: string): string {
  const globals = globalThis as typeof globalThis & {
    CONFIG?: {
      PF2E?: {
        languages?: Record<string, string | undefined>;
      };
    };
  };
  const configLanguages = globals.CONFIG?.PF2E?.languages ?? {};
  const languageKey = configLanguages[slug];
  if (typeof languageKey === "string" && languageKey.length > 0) {
    return game.i18n.localize(languageKey);
  }

  return slug
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function findPlanStepBySlotId(
  args: BuildWayfinderAppPlanArgs,
  slotId: string,
  deps: BuildWayfinderAppPlanDependencies = DEFAULT_DEPS
): Promise<PendingStep | null> {
  const plan = await buildWayfinderAppPlan(args, deps);
  return plan.steps.find((step) => step.slotId === slotId) ?? null;
}

async function resolveSingletonChoiceSources(
  draft: DraftState,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<SingletonChoiceSourceContext[]> {
  const itemTypes = [
    "ancestry",
    "heritage",
    "background",
    "class",
    "deity",
  ] as const satisfies readonly SingletonItemType[];
  const documents = await Promise.all(itemTypes.map((itemType) => args.resolveDocument(itemType)));

  return itemTypes
    .map((itemType, index) => {
      const sourceSelection =
        deps.findDraftSelectionByType(draft, itemType) ??
        deps.readExistingSingletonSourceSelection(args.actor, itemType);
      return {
        sourceItemType: itemType,
        sourceSelection,
        sourceDocument: documents[index],
      } satisfies SingletonChoiceSourceContext;
    })
    .filter((entry) => !!entry.sourceSelection && !!entry.sourceDocument);
}
