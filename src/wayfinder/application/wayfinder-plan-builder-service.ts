import type { inspectActor } from "../../actor-inspector.js";
import type { BuildStateActor } from "../../build-state/document-types.js";
import { getEffectiveBuildState, listActorItems } from "../../build-state.js";
import { MODULE_ID } from "../../constants.js";
import { fetchSelectionDocument } from "../../pack/access.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { sourceIdOf } from "../../shared/source-id.js";
import type {
  ChoicePredicate,
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  DraftState,
  FlagChoiceMeta,
  PendingStep,
  SelectionRef,
  SingletonChoiceMeta,
  SpellChoiceMeta,
} from "../../types.js";
import type { ChoiceFilterActorContext } from "../choice-set-filters.js";
import {
  projectedClassArchetypeFeatSelections,
  reservedClassFeatSlotIds,
  selectedClassArchetypeSelection,
  withExistingClassArchetypeChoice,
} from "../class-archetype/registry.js";
import { buildClassArchetypeFallbackFeatSteps, buildClassArchetypeSteps } from "../class-archetype/service.js";
import type { ClassFeatureSelectionSource } from "../class-choice/step-builders.js";
import {
  buildClassBranchSteps,
  buildClassChoiceSteps,
  buildClassFeatSteps,
  buildClassGrantedItemSteps,
  buildClassSkillFeatSteps,
  buildClassTrainingSteps,
} from "../class-choice-service.js";
import { findDraftSelectionByType } from "../draft-decisions.js";
import {
  readExistingBranchSelection,
  readExistingClassChoiceSelection,
  readExistingFlagChoiceSelection,
  readExistingGrantedSelection,
  readExistingLanguageSelections,
  readExistingSingletonChoiceSelection,
  readExistingSingletonSourceSelection,
} from "../existing-selection-service.js";
import { buildFlagChoiceSteps, type FlagChoiceSourceContext } from "../flag-choice-service.js";
import { buildGrantChoiceSteps, type GrantChoiceSourceContext } from "../grant-choice-service.js";
import { buildLanguageChoiceSteps } from "../language-choice-service.js";
import { buildWayfinderPlan } from "../plan-service.js";
import { documentFeatureLevel, getDocumentRules, matchesChoicePredicateList, toNonEmptyString } from "../rule-data.js";
import { buildSingletonChoiceSteps, type SingletonChoiceSourceContext } from "../singleton-choice-service.js";
import type { SkillTrainingSourceContext } from "../skill-training/source-discovery.js";
import { SLOT_PREFIXES } from "../slot-ids.js";
import { buildFeatSpellChoiceSteps } from "../spell-choice/feat-step-builder.js";
import { asSpellChoiceClassDocument } from "../spell-choice/types.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../spell-choice-service.js";

type ActorSnapshot = ReturnType<typeof inspectActor>;
type SingletonItemType = "ancestry" | "heritage" | "background" | "class" | "deity";
type ActorLike = BuildStateActor;
type DocumentLike = unknown;

const SINGLETON_ITEM_TYPES = [
  "ancestry",
  "heritage",
  "background",
  "class",
  "deity",
] as const satisfies readonly SingletonItemType[];

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
  buildClassSkillFeatSteps: typeof buildClassSkillFeatSteps;
  buildClassTrainingSteps: typeof buildClassTrainingSteps;
  buildGrantChoiceSteps: typeof buildGrantChoiceSteps;
  buildFlagChoiceSteps: typeof buildFlagChoiceSteps;
  buildSingletonChoiceSteps: typeof buildSingletonChoiceSteps;
  buildLanguageChoiceSteps: typeof buildLanguageChoiceSteps;
  buildClassArchetypeSteps: typeof buildClassArchetypeSteps;
  buildClassBranchSteps: typeof buildClassBranchSteps;
  buildClassGrantedItemSteps: typeof buildClassGrantedItemSteps;
  buildClassChoiceSteps: typeof buildClassChoiceSteps;
  buildSpellChoiceSteps: typeof buildSpellChoiceSteps;
  findDraftSelectionByType: (draft: DraftState, itemType: SingletonItemType) => SelectionRef | null;
  readExistingSingletonSourceSelection: (actor: ActorLike, itemType: SingletonItemType) => SelectionRef | null;
  readExistingBranchSelection: (actor: ActorLike, branch: ClassBranchMeta) => string | null;
  readExistingGrantedSelection: (actor: ActorLike, grant: ClassGrantMeta) => string | null;
  readExistingFlagChoiceSelection: (actor: ActorLike, choice: FlagChoiceMeta) => string | null;
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
  buildClassSkillFeatSteps,
  buildClassTrainingSteps,
  buildGrantChoiceSteps,
  buildFlagChoiceSteps,
  buildSingletonChoiceSteps,
  buildLanguageChoiceSteps,
  buildClassArchetypeSteps,
  buildClassBranchSteps,
  buildClassGrantedItemSteps,
  buildClassChoiceSteps,
  buildSpellChoiceSteps,
  findDraftSelectionByType,
  readExistingSingletonSourceSelection,
  readExistingBranchSelection,
  readExistingGrantedSelection,
  readExistingFlagChoiceSelection,
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
  const classArchetypeDraft = withExistingClassArchetypeChoice(args.draft, listActorItems(args.actor));
  return deps.buildWayfinderPlan(args.snapshot, args.draft, {
    buildClassFeatSteps: async (planSnapshot, _planDraft, targetLevel) =>
      deps.buildClassFeatSteps({
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fulfilledCount: planSnapshot.featCounts.class,
        fulfilledStepIds: planSnapshot.fulfilledStepIds,
        reservedStepIds: reservedClassFeatSlotIds(classArchetypeDraft),
      }),
    buildClassSkillFeatSteps: async (planSnapshot, _planDraft, targetLevel) =>
      deps.buildClassSkillFeatSteps({
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fulfilledCount: countAppliedWayfinderSlotSelections(args.actor, "skill-feat"),
        fulfilledStepIds: planSnapshot.fulfilledStepIds,
      }),
    buildClassTrainingSteps: async (_planSnapshot, planDraft, targetLevel) => {
      const effectiveBuildState = await getEffectiveBuildState(args.actor, planDraft);
      const draftedClassSelection = deps.findDraftSelectionByType(planDraft, "class");
      return deps.buildClassTrainingSteps({
        draftClassSelection: draftedClassSelection ?? deps.readExistingSingletonSourceSelection(args.actor, "class"),
        includeBaseClassTraining: !!draftedClassSelection,
        sourceSelections: draftedClassSelection
          ? [
              {
                sourceItemType: "ancestry",
                sourceSelection:
                  deps.findDraftSelectionByType(planDraft, "ancestry") ??
                  deps.readExistingSingletonSourceSelection(args.actor, "ancestry"),
                sourceDocument: effectiveBuildState.ancestry?.document ?? null,
              },
              {
                sourceItemType: "heritage",
                sourceSelection:
                  deps.findDraftSelectionByType(planDraft, "heritage") ??
                  deps.readExistingSingletonSourceSelection(args.actor, "heritage"),
                sourceDocument: effectiveBuildState.heritage,
              },
              {
                sourceItemType: "background",
                sourceSelection:
                  deps.findDraftSelectionByType(planDraft, "background") ??
                  deps.readExistingSingletonSourceSelection(args.actor, "background"),
                sourceDocument: effectiveBuildState.background?.document ?? null,
              },
              ...(await resolveSkillTrainingFeatSources(classArchetypeDraft, targetLevel, args, deps)),
            ]
          : await resolveProjectedClassArchetypeSkillTrainingSources(classArchetypeDraft, targetLevel, args, deps),
        targetLevel,
        effectiveBuildState,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
      });
    },
    buildGrantChoiceSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildGrantChoiceSteps({
        draft: planDraft,
        targetLevel,
        hasClassSelection: !!(
          deps.findDraftSelectionByType(planDraft, "class") ??
          deps.readExistingSingletonSourceSelection(args.actor, "class")
        ),
        hasDeitySelection: !!(
          deps.findDraftSelectionByType(planDraft, "deity") ??
          deps.readExistingSingletonSourceSelection(args.actor, "deity")
        ),
        sources: await resolveGrantChoiceSources(classArchetypeDraft, targetLevel, args, deps),
        extractSlug: deps.extractDocumentSlug,
        readExistingGrantedSelection: (grant) => deps.readExistingGrantedSelection(args.actor, grant),
      }),
    buildFlagChoiceSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildFlagChoiceSteps({
        draft: planDraft,
        targetLevel,
        sources: await resolveFlagChoiceSources(classArchetypeDraft, targetLevel, args, deps),
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
        actorContext: await resolveFlagChoiceActorContext(args, deps),
        readExistingFlagChoiceSelection: (choice) => deps.readExistingFlagChoiceSelection(args.actor, choice),
      }),
    buildSingletonChoiceSteps: async (_planSnapshot, planDraft, targetLevel) =>
      deps.buildSingletonChoiceSteps({
        draft: planDraft,
        targetLevel,
        sources: await resolveSingletonChoiceSources(classArchetypeDraft, targetLevel, args, deps),
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
        availableLanguageSlugs: listAvailableLanguageSlugs(),
        readExistingLanguageSelections: () => deps.readExistingLanguageSelections(args.actor),
        localizeLanguage: (slug) => localizeLanguageLabel(slug),
      }),
    buildClassArchetypeSteps: async (_planSnapshot, planDraft, targetLevel) => [
      ...(await deps.buildClassArchetypeSteps({
        draft: planDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        readExistingBranchSelection: (branch) => deps.readExistingBranchSelection(args.actor, branch),
      })),
      ...buildClassArchetypeFallbackFeatSteps({
        draft: classArchetypeDraft,
        actorItems: listActorItems(args.actor),
        targetLevel,
        projectedSingletonSources: await resolveDraftedSingletonSources(classArchetypeDraft, args, deps),
      }),
    ],
    buildClassBranchSteps: async (_planSnapshot, _planDraft, targetLevel) =>
      deps.buildClassBranchSteps({
        draft: classArchetypeDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        readExistingBranchSelection: (branch) => deps.readExistingBranchSelection(args.actor, branch),
      }),
    buildClassGrantedItemSteps: async (_planSnapshot, _planDraft, targetLevel) =>
      deps.buildClassGrantedItemSteps({
        draft: classArchetypeDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        readExistingGrantedSelection: (grant) => deps.readExistingGrantedSelection(args.actor, grant),
      }),
    buildClassChoiceSteps: async (_planSnapshot, _planDraft, targetLevel) =>
      deps.buildClassChoiceSteps({
        draft: classArchetypeDraft,
        effectiveClassDocument: await args.resolveDocument("class"),
        effectiveDeityDocument: await args.resolveDocument("deity"),
        additionalClassFeatures: await resolveSelectedClassFeatureChoiceSources(classArchetypeDraft, args, deps),
        targetLevel,
        fetchSelectionDocument: deps.fetchSelectionDocument,
        extractSlug: deps.extractDocumentSlug,
        localize: args.localize,
        readExistingClassChoiceSelection: (choice) => deps.readExistingClassChoiceSelection(args.actor, choice),
      }),
    buildSpellChoiceSteps: async (planSnapshot, _planDraft, targetLevel) => {
      const effectiveClassDocument = await args.resolveDocument("class");
      const effectiveDeityDocument = await args.resolveDocument("deity");
      const effectiveSchoolDocument = await args.resolveArcaneSchoolDocument();
      const readExistingSelections = (choice: SpellChoiceMeta) =>
        deps.readExistingSpellChoiceSelections(args.actor, choice);

      return [
        ...(await deps.buildSpellChoiceSteps({
          draft: classArchetypeDraft,
          currentLevel: planSnapshot.level,
          effectiveClassDocument,
          effectiveDeityDocument,
          effectiveSchoolDocument,
          effectiveClassFeatureDocuments: await resolveSpellChoiceClassFeatureDocuments(
            classArchetypeDraft,
            args,
            deps
          ),
          targetLevel,
          extractSlug: deps.extractDocumentSlug,
          readExistingSpellChoiceSelections: readExistingSelections,
        })),
        ...buildFeatSpellChoiceSteps({
          draft: classArchetypeDraft,
          effectiveClassDocument: asSpellChoiceClassDocument(effectiveClassDocument),
          featSources: await resolveSpellChoiceFeatSources(classArchetypeDraft, targetLevel, args, deps),
          extractSlug: deps.extractDocumentSlug,
          readExistingSpellChoiceSelections: readExistingSelections,
        }),
      ];
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

function listAvailableLanguageSlugs(): string[] {
  const globals = globalThis as typeof globalThis & {
    CONFIG?: {
      PF2E?: {
        languages?: Record<string, unknown>;
      };
    };
    game?: {
      pf2e?: {
        settings?: {
          campaign?: {
            languages?: {
              unavailable?: unknown;
            };
          };
        };
      };
    };
  };
  const unavailable = normalizeLanguageSet(globals.game?.pf2e?.settings?.campaign?.languages?.unavailable);
  return Object.keys(globals.CONFIG?.PF2E?.languages ?? {})
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => slug.length > 0 && !unavailable.has(slug));
}

function normalizeLanguageSet(value: unknown): Set<string> {
  if (value instanceof Set) {
    return new Set(Array.from(value).filter((slug): slug is string => typeof slug === "string"));
  }

  if (Array.isArray(value)) {
    return new Set(value.filter((slug): slug is string => typeof slug === "string"));
  }

  return new Set();
}

async function resolveFlagChoiceActorContext(
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<ChoiceFilterActorContext> {
  const [ancestryDocument, classDocument] = await Promise.all([
    args.resolveDocument("ancestry"),
    args.resolveDocument("class"),
  ]);

  return {
    ancestrySlug: deps.extractDocumentSlug(ancestryDocument),
    classSlug: deps.extractDocumentSlug(classDocument),
  };
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
  targetLevel: number,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<SingletonChoiceSourceContext[]> {
  const itemTypes = SINGLETON_ITEM_TYPES;
  const documents = await Promise.all(itemTypes.map((itemType) => args.resolveDocument(itemType)));

  const singletonItemSources = itemTypes
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
  const featSelections = dedupeSelectionsByUuid([
    ...Object.values(draft.selections).filter(isSingletonChoiceFeatSelection),
    ...projectedClassArchetypeFeatSelections(draft, targetLevel),
    ...readExistingSkillTrainingFeatSelections(args.actor),
  ]);
  const featDocuments = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));

  return [
    ...singletonItemSources,
    ...featSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = featDocuments[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "feat",
              sourceSelection,
              sourceDocument,
            } satisfies SingletonChoiceSourceContext,
          ]
        : [];
    }),
  ];
}

async function resolveDraftedSingletonSources(
  draft: DraftState,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<Array<{ sourceItemType: SingletonItemType; sourceDocument: DocumentLike | null }>> {
  const itemTypes = SINGLETON_ITEM_TYPES.filter((itemType) => !!deps.findDraftSelectionByType(draft, itemType));
  const documents = await Promise.all(itemTypes.map((itemType) => args.resolveDocument(itemType)));
  return itemTypes.map((sourceItemType, index) => ({
    sourceItemType,
    sourceDocument: documents[index],
  }));
}

async function resolveSkillTrainingFeatSources(
  draft: DraftState,
  targetLevel: number,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<SkillTrainingSourceContext[]> {
  const classFeatureSelections = resolveSelectedClassFeatureSelections(draft, args.actor);
  const featSelections = dedupeSelectionsByUuid([
    ...Object.values(draft.selections).filter(isSkillTrainingFeatSelection),
    ...projectedClassArchetypeFeatSelections(draft, targetLevel),
    ...readExistingSkillTrainingFeatSelections(args.actor),
  ]);
  const [classFeatureDocuments, documents] = await Promise.all([
    Promise.all(classFeatureSelections.map((selection) => deps.fetchSelectionDocument(selection))),
    Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection))),
  ]);

  return [
    ...classFeatureSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = classFeatureDocuments[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "classfeature",
              sourceSelection,
              sourceDocument,
            } satisfies SkillTrainingSourceContext,
          ]
        : [];
    }),
    ...featSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = documents[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "feat",
              sourceSelection,
              sourceDocument,
            } satisfies SkillTrainingSourceContext,
          ]
        : [];
    }),
  ];
}

async function resolveProjectedClassArchetypeSkillTrainingSources(
  draft: DraftState,
  targetLevel: number,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<SkillTrainingSourceContext[]> {
  const actorSourceIds = new Set(
    listActorItems(args.actor)
      .map((item) => sourceIdOf(item)?.trim().toLowerCase())
      .filter((sourceId): sourceId is string => !!sourceId)
  );
  const isNotActorOwned = (selection: SelectionRef): boolean =>
    !actorSourceIds.has(selection.uuid.trim().toLowerCase());
  const classFeatureSelections = resolveSelectedClassFeatureSelections(draft, args.actor).filter(isNotActorOwned);
  const featSelections = projectedClassArchetypeFeatSelections(draft, targetLevel).filter(isNotActorOwned);
  const [classFeatureDocuments, featDocuments] = await Promise.all([
    Promise.all(classFeatureSelections.map((selection) => deps.fetchSelectionDocument(selection))),
    Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection))),
  ]);

  return [
    ...classFeatureSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = classFeatureDocuments[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "classfeature",
              sourceSelection,
              sourceDocument,
            } satisfies SkillTrainingSourceContext,
          ]
        : [];
    }),
    ...featSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = featDocuments[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "feat",
              sourceSelection,
              sourceDocument,
            } satisfies SkillTrainingSourceContext,
          ]
        : [];
    }),
  ];
}

async function resolveGrantChoiceSources(
  draft: DraftState,
  targetLevel: number,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<GrantChoiceSourceContext[]> {
  const sourceItemTypes = ["ancestry", "heritage", "background"] as const;
  const sourceDocuments = await Promise.all(sourceItemTypes.map((itemType) => args.resolveDocument(itemType)));
  const featSelections = dedupeSelectionsByUuid([
    ...Object.values(draft.selections).filter(isGrantChoiceSourceFeatSelection),
    ...projectedClassArchetypeFeatSelections(draft, targetLevel),
    ...readExistingSkillTrainingFeatSelections(args.actor).filter(isGrantChoiceSourceFeatSelection),
  ]);
  const featDocuments = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));
  const classFeatureSelections = resolveSelectedClassFeatureSelections(draft, args.actor);
  const classFeatureDocuments = await Promise.all(
    classFeatureSelections.map((selection) => deps.fetchSelectionDocument(selection))
  );

  return [
    ...sourceItemTypes.flatMap((sourceItemType, index) => {
      const sourceSelection =
        deps.findDraftSelectionByType(draft, sourceItemType) ??
        deps.readExistingSingletonSourceSelection(args.actor, sourceItemType);
      const sourceDocument = sourceDocuments[index];
      return sourceSelection && sourceDocument
        ? [
            {
              sourceItemType,
              sourceSelection,
              sourceDocument,
            } satisfies GrantChoiceSourceContext,
          ]
        : [];
    }),
    ...featSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = featDocuments[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "feat",
              sourceSelection,
              sourceDocument,
            } satisfies GrantChoiceSourceContext,
          ]
        : [];
    }),
    ...classFeatureSelections.flatMap((sourceSelection, index) => {
      const sourceDocument = classFeatureDocuments[index];
      return sourceDocument
        ? [
            {
              sourceItemType: "classfeature",
              sourceSelection,
              sourceDocument,
            } satisfies GrantChoiceSourceContext,
          ]
        : [];
    }),
  ];
}

async function resolveFlagChoiceSources(
  draft: DraftState,
  targetLevel: number,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<FlagChoiceSourceContext[]> {
  return resolveGrantChoiceSources(draft, targetLevel, args, deps);
}

function isAncestryFeatSelection(selection: SelectionRef): boolean {
  return selection.itemType === "feat" && selection.featType === "ancestry";
}

function isGrantChoiceSourceFeatSelection(selection: SelectionRef): boolean {
  return selection.itemType === "feat" && selection.featType !== "classfeature";
}

async function resolveSpellChoiceClassFeatureDocuments(
  draft: DraftState,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<DocumentLike[]> {
  const selections = resolveSelectedClassFeatureSelections(draft, args.actor);
  const documents = await Promise.all(selections.map((selection) => deps.fetchSelectionDocument(selection)));
  return documents.filter((document): document is DocumentLike => document !== null);
}

async function resolveSelectedClassFeatureChoiceSources(
  draft: DraftState,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
): Promise<ClassFeatureSelectionSource[]> {
  const effectiveClassDocument = await args.resolveDocument("class");
  const classSlug = effectiveClassDocument ? deps.extractDocumentSlug(effectiveClassDocument) : null;
  const directSelections = resolveSelectedClassFeatureSelections(draft, args.actor);
  const directDocuments = await Promise.all(
    directSelections.map((selection) => deps.fetchSelectionDocument(selection))
  );
  const directSources = directSelections.flatMap((selection, index) => {
    const document = directDocuments[index];
    return document
      ? [
          {
            level: documentFeatureLevel(document),
            selection,
            document,
            existingRulesSelections: readExistingRulesSelections(args.actor, selection.uuid),
          },
        ]
      : [];
  });

  const staticGrantSelections = dedupeSelectionsByUuid(
    directSources.flatMap((source) =>
      staticClassFeatureGrantSelections({
        actor: args.actor,
        classSlug,
        draft,
        extractSlug: deps.extractDocumentSlug,
        source,
      })
    )
  );
  const staticGrantDocuments = await Promise.all(
    staticGrantSelections.map((selection) => deps.fetchSelectionDocument(selection))
  );
  const staticGrantSources = staticGrantSelections.flatMap((selection, index) => {
    const document = staticGrantDocuments[index];
    return document
      ? [
          {
            level: documentFeatureLevel(document),
            selection,
            document,
            existingRulesSelections: readExistingRulesSelections(args.actor, selection.uuid),
          },
        ]
      : [];
  });

  return dedupeClassFeatureSourcesByUuid([...directSources, ...staticGrantSources]);
}

function resolveSelectedClassFeatureSelections(draft: DraftState, actor: ActorLike): SelectionRef[] {
  return dedupeSelectionsByUuid([
    ...(selectedClassArchetypeSelection(draft) ? [selectedClassArchetypeSelection(draft)!] : []),
    ...Object.values(draft.branchSelections),
    ...Object.values(draft.selections).filter((selection) => isGrantChoiceClassFeatureSelection(selection)),
    ...readExistingClassFeatureSelections(actor),
  ]);
}

function staticClassFeatureGrantSelections(args: {
  actor: ActorLike;
  classSlug: string | null;
  draft: DraftState;
  extractSlug: (document: unknown) => string | null;
  source: { selection: SelectionRef; document: DocumentLike };
}): SelectionRef[] {
  const rollOptions = buildClassFeatureRollOptions(args);
  return getDocumentRules(args.source.document).flatMap((rule) => {
    if (rule.key !== "GrantItem") {
      return [];
    }

    const predicate = Array.isArray(rule.predicate) ? (rule.predicate as ChoicePredicate[]) : [];
    if (predicate.length > 0 && !matchesChoicePredicateList(predicate, (statement) => rollOptions.has(statement))) {
      return [];
    }

    const uuid = toNonEmptyString(rule.uuid);
    const parsed = uuid ? parseCompendiumItemUuid(uuid) : null;
    if (!uuid || !parsed || parsed.packId !== "pf2e.classfeatures") {
      return [];
    }

    return [
      {
        slotId: `static-classfeature-grant-${parsed.documentId}`,
        packId: parsed.packId,
        documentId: parsed.documentId,
        uuid,
        itemType: "feat",
        featType: "classfeature",
        name: parsed.documentId,
        level: null,
      } satisfies SelectionRef,
    ];
  });
}

function buildClassFeatureRollOptions(args: {
  actor: ActorLike;
  classSlug: string | null;
  draft: DraftState;
  extractSlug: (document: unknown) => string | null;
  source: { selection: SelectionRef; document: DocumentLike };
}): Set<string> {
  const sourceSlug = args.extractSlug(args.source.document) ?? args.source.selection.documentId;
  const sourceLevel = documentFeatureLevel(args.source.document);
  const existingRulesSelections = readExistingRulesSelections(args.actor, args.source.selection.uuid);
  const rollOptions = new Set<string>();
  if (args.classSlug) {
    rollOptions.add(`class:${args.classSlug}`.toLowerCase());
  }

  for (const rule of getDocumentRules(args.source.document)) {
    if (rule.key !== "ChoiceSet") {
      continue;
    }

    const choiceKey = classChoiceKeyForRule(rule, sourceSlug);
    if (!choiceKey) {
      continue;
    }

    const slotId = `class-choice-${sourceSlug}-${choiceKey}-level-${sourceLevel}`;
    const ruleFlag = toNonEmptyString(rule.flag);
    const selected =
      toNonEmptyString(args.draft.classChoices[slotId]) ??
      toNonEmptyString(existingRulesSelections[choiceKey]) ??
      (ruleFlag ? toNonEmptyString(existingRulesSelections[ruleFlag]) : null);
    if (!selected) {
      continue;
    }

    const rollOption = toNonEmptyString(rule.rollOption);
    if (rollOption) {
      rollOptions.add(`${rollOption}:${selected}`.toLowerCase());
    }
    rollOptions.add(`${choiceKey}:${selected}`.toLowerCase());
    if (ruleFlag && ruleFlag !== choiceKey) {
      rollOptions.add(`${ruleFlag}:${selected}`.toLowerCase());
    }
  }

  return rollOptions;
}

function classChoiceKeyForRule(rule: Record<string, unknown>, sourceSlug: string): string | null {
  const flag = toNonEmptyString(rule.flag) ?? toNonEmptyString(rule.slug);
  return flag ? sanitizeChoiceFlag(flag) : toDromedaryFlag(sourceSlug);
}

function sanitizeChoiceFlag(value: string): string {
  return value.replace(/[^-a-z0-9]/gi, "");
}

function toDromedaryFlag(value: string): string | null {
  const parts = value
    .trim()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
}

function readExistingRulesSelections(actor: ActorLike, sourceUuid: string): Record<string, unknown> {
  const item = listActorItems(actor).find((entry) => sourceIdOf(entry) === sourceUuid) as
    | {
        flags?: {
          pf2e?: { rulesSelections?: Record<string, unknown> | null };
          system?: { rulesSelections?: Record<string, unknown> | null };
        };
      }
    | null
    | undefined;

  return {
    ...(item?.flags?.system?.rulesSelections ?? {}),
    ...(item?.flags?.pf2e?.rulesSelections ?? {}),
  };
}

function dedupeClassFeatureSourcesByUuid<T extends { selection: SelectionRef }>(sources: T[]): T[] {
  const byUuid = new Map<string, T>();
  for (const source of sources) {
    byUuid.set(source.selection.uuid, source);
  }
  return Array.from(byUuid.values());
}

function isGrantChoiceClassFeatureSelection(selection: SelectionRef): boolean {
  return selection.slotId.startsWith("grant-choice-") && selection.packId === "pf2e.classfeatures";
}

function isSkillTrainingFeatSelection(selection: SelectionRef): boolean {
  return isFeatSourceSelection(selection);
}

function isSingletonChoiceFeatSelection(selection: SelectionRef): boolean {
  return isFeatSourceSelection(selection);
}

function isFeatSourceSelection(selection: SelectionRef): boolean {
  return (
    selection.itemType === "feat" &&
    selection.featType !== "classfeature" &&
    !selection.slotId.startsWith(SLOT_PREFIXES.flagChoice)
  );
}

function readExistingClassFeatureSelections(actor: ActorLike): SelectionRef[] {
  return listActorItems(actor)
    .map((item) => selectionFromClassFeatureItem(item))
    .filter((selection): selection is SelectionRef => selection !== null);
}

function selectionFromClassFeatureItem(item: unknown): SelectionRef | null {
  const typedItem = item as {
    type?: unknown;
    name?: unknown;
    system?: {
      category?: unknown;
      featType?: { value?: unknown };
      level?: { value?: unknown };
    };
    flags?: {
      [MODULE_ID]?: {
        slotId?: unknown;
      };
    };
  } | null;
  if (!typedItem || typedItem.type !== "feat") {
    return null;
  }

  const featType = typedItem.system?.featType?.value ?? typedItem.system?.category;
  if (featType !== "classfeature") {
    return null;
  }

  const sourceId = sourceIdOf(typedItem);
  const parsed = sourceId ? parseCompendiumItemUuid(sourceId) : null;
  if (!sourceId || !parsed) {
    return null;
  }

  const existingSlotId =
    typeof typedItem.flags?.[MODULE_ID]?.slotId === "string" && typedItem.flags[MODULE_ID].slotId.length > 0
      ? typedItem.flags[MODULE_ID].slotId
      : null;
  const level = toPositiveInteger(typedItem.system?.level?.value) ?? 1;

  return {
    slotId: existingSlotId ?? `existing-classfeature-${parsed.documentId}`,
    packId: parsed.packId,
    documentId: parsed.documentId,
    uuid: sourceId,
    itemType: "feat",
    featType: "classfeature",
    name: typeof typedItem.name === "string" ? typedItem.name : parsed.documentId,
    level,
  };
}

async function resolveSpellChoiceFeatSources(
  draft: DraftState,
  targetLevel: number,
  args: BuildWayfinderAppPlanArgs,
  deps: BuildWayfinderAppPlanDependencies
) {
  const featSelections = dedupeSelectionsByUuid([
    ...Object.values(draft.selections).filter(isAncestryFeatSelection),
    ...projectedClassArchetypeFeatSelections(draft, targetLevel),
    ...readExistingSkillTrainingFeatSelections(args.actor).filter(isAncestryFeatSelection),
  ]);
  const documents = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));

  return featSelections.flatMap((sourceSelection, index) => {
    const sourceDocument = documents[index];
    return sourceDocument ? [{ sourceSelection, sourceDocument }] : [];
  });
}

function readExistingSkillTrainingFeatSelections(actor: ActorLike): SelectionRef[] {
  return listActorItems(actor)
    .map((item) => selectionFromSkillTrainingFeatItem(item))
    .filter((selection): selection is SelectionRef => selection !== null);
}

function countAppliedWayfinderSlotSelections(actor: ActorLike, slotKind: string): number {
  const slotPrefix = `${slotKind}-level-`;
  const slotIds = new Set<string>();
  for (const item of listActorItems(actor)) {
    const typedItem = item as {
      type?: unknown;
      flags?: {
        [MODULE_ID]?: {
          slotId?: unknown;
        };
      };
    } | null;
    const slotId = typedItem?.flags?.[MODULE_ID]?.slotId;
    if (typedItem?.type === "feat" && typeof slotId === "string" && slotId.startsWith(slotPrefix)) {
      slotIds.add(slotId);
    }
  }

  return slotIds.size;
}

function selectionFromSkillTrainingFeatItem(item: unknown): SelectionRef | null {
  const typedItem = item as {
    type?: unknown;
    name?: unknown;
    system?: {
      featType?: { value?: unknown };
      category?: unknown;
      level?: { value?: unknown };
    };
    flags?: {
      [MODULE_ID]?: {
        slotId?: unknown;
      };
    };
  } | null;
  if (!typedItem || typedItem.type !== "feat") {
    return null;
  }

  const featType = typedItem.system?.featType?.value ?? typedItem.system?.category;
  const existingSlotId =
    typeof typedItem.flags?.[MODULE_ID]?.slotId === "string" && typedItem.flags[MODULE_ID].slotId.length > 0
      ? typedItem.flags[MODULE_ID].slotId
      : null;
  const isSupportedFeat = featType !== "classfeature";
  if (!isSupportedFeat) {
    return null;
  }

  const sourceId = sourceIdOf(typedItem);
  if (!sourceId) {
    return null;
  }

  const parsed = parseCompendiumItemUuid(sourceId);
  if (!parsed) {
    return null;
  }

  const level = toPositiveInteger(typedItem.system?.level?.value) ?? 1;
  const slotId = existingSlotId ?? `${featType || "feat"}-feat-level-${level}`;

  return {
    slotId,
    packId: parsed.packId,
    documentId: parsed.documentId,
    uuid: sourceId,
    itemType: "feat",
    featType: typeof featType === "string" ? featType : null,
    name: typeof typedItem.name === "string" ? typedItem.name : "",
    level,
  };
}

function dedupeSelectionsByUuid(selections: SelectionRef[]): SelectionRef[] {
  const seen = new Set<string>();
  const result: SelectionRef[] = [];
  for (const selection of selections) {
    if (seen.has(selection.uuid)) {
      continue;
    }

    seen.add(selection.uuid);
    result.push(selection);
  }

  return result;
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1 ? Math.floor(numeric) : null;
}
