import type {
  ClassBranchStep,
  ClassChoiceStep,
  PendingStep,
  PickItemStep,
  SelectionRef,
  SkillTrainingStep,
} from "../../types.js";
import {
  createClassBranchStep,
  createClassChoiceStep,
  createPickItemStep,
  createSkillTrainingStep,
} from "../domain/step-types.js";
import { formatSlug } from "../formatting.js";
import {
  buildChoiceRollOptions,
  type ClassFeatureSelectionSource,
  discoverClassBranchMeta,
  discoverClassChoiceMeta,
  discoverGrantedItemMeta,
  discoverSkillTrainingMeta,
  getClassFeatureSources,
} from "./rule-discovery.js";

interface BuildClassFeatureStepArgs {
  effectiveClassDocument: unknown | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
}

interface BuildClassChoiceStepArgs extends BuildClassFeatureStepArgs {
  effectiveDeityDocument: unknown | null;
  localize: (value: string) => string;
}

export function buildClassTrainingStepsFromRules(args: {
  effectiveClassDocument: unknown | null;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}): SkillTrainingStep[] {
  const { effectiveClassDocument, extractSlug, localize } = args;
  if (!effectiveClassDocument) {
    return [];
  }

  const training = discoverSkillTrainingMeta({
    classDocument: effectiveClassDocument,
    extractSlug,
    localize,
  });
  if (!training) {
    return [];
  }

  return [
    createSkillTrainingStep(
      1,
      `${training.className} skill training`,
      "Choose the class skill training decisions this class grants at 1st level.",
      training
    ),
  ];
}

export async function buildClassBranchStepsFromRules(args: BuildClassFeatureStepArgs): Promise<ClassBranchStep[]> {
  const context = await loadClassFeatureContext(args);
  if (!context) {
    return [];
  }

  return buildClassBranchStepsFromFeatures(context.classFeatures, context.classSlug, args.extractSlug);
}

export async function buildClassGrantedItemStepsFromRules(args: BuildClassFeatureStepArgs): Promise<PickItemStep[]> {
  const context = await loadClassFeatureContext(args);
  if (!context) {
    return [];
  }

  return buildClassGrantedItemStepsFromFeatures(context.classFeatures, context.classSlug);
}

export async function buildClassChoiceStepsFromRules(args: BuildClassChoiceStepArgs): Promise<ClassChoiceStep[]> {
  const context = await loadClassFeatureContext(args);
  if (!context) {
    return [];
  }

  return buildClassChoiceStepsFromFeatures({
    classFeatures: context.classFeatures,
    classSlug: context.classSlug,
    effectiveDeityDocument: args.effectiveDeityDocument,
    extractSlug: args.extractSlug,
    localize: args.localize,
  });
}

export async function buildClassStepsFromRules(args: BuildClassChoiceStepArgs): Promise<PendingStep[]> {
  const trainingSteps = buildClassTrainingStepsFromRules(args);
  const context = await loadClassFeatureContext(args);
  if (!context) {
    return trainingSteps;
  }

  return [
    ...trainingSteps,
    ...buildClassBranchStepsFromFeatures(context.classFeatures, context.classSlug, args.extractSlug),
    ...buildClassGrantedItemStepsFromFeatures(context.classFeatures, context.classSlug),
    ...buildClassChoiceStepsFromFeatures({
      classFeatures: context.classFeatures,
      classSlug: context.classSlug,
      effectiveDeityDocument: args.effectiveDeityDocument,
      extractSlug: args.extractSlug,
      localize: args.localize,
    }),
  ];
}

async function loadClassFeatureContext(
  args: BuildClassFeatureStepArgs
): Promise<{ classSlug: string | null; classFeatures: ClassFeatureSelectionSource[] } | null> {
  const { effectiveClassDocument, targetLevel, fetchSelectionDocument, extractSlug } = args;
  if (!effectiveClassDocument) {
    return null;
  }

  return {
    classSlug: extractSlug(effectiveClassDocument),
    classFeatures: await getClassFeatureSources(effectiveClassDocument, targetLevel, fetchSelectionDocument),
  };
}

function buildClassBranchStepsFromFeatures(
  classFeatures: ClassFeatureSelectionSource[],
  classSlug: string | null,
  extractSlug: (document: unknown) => string | null
): ClassBranchStep[] {
  const steps: ClassBranchStep[] = [];

  for (const feature of classFeatures) {
    const branch = discoverClassBranchMeta({
      selectorDocument: feature.document,
      selectorSelection: feature.selection,
      classSlug,
      extractSlug,
    });
    if (!branch) {
      continue;
    }

    steps.push(createClassBranchStep(feature.level, branch));
  }

  return steps;
}

function buildClassGrantedItemStepsFromFeatures(
  classFeatures: ClassFeatureSelectionSource[],
  classSlug: string | null
): PickItemStep[] {
  const steps: PickItemStep[] = [];

  for (const feature of classFeatures) {
    const grant = discoverGrantedItemMeta({
      selectorDocument: feature.document,
      selectorSelection: feature.selection,
      classSlug,
    });
    if (!grant) {
      continue;
    }

    steps.push(
      createPickItemStep(
        grant.itemType,
        feature.level,
        grant.itemType === "deity" ? "Choose a deity" : `Choose ${grant.selectorName.toLowerCase()}`,
        grant.itemType === "deity"
          ? "Choose the deity that grants your divine skill, favored weapon, sanctification, and divine font."
          : `Choose the ${grant.selectorName.toLowerCase()} this class feature grants.`,
        {
          itemType: grant.itemType,
        },
        {
          slotId: grant.slotId,
          grantSelection: grant,
        }
      )
    );
  }

  return steps;
}

function buildClassChoiceStepsFromFeatures(args: {
  classFeatures: ClassFeatureSelectionSource[];
  classSlug: string | null;
  effectiveDeityDocument: unknown | null;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}): ClassChoiceStep[] {
  const steps: ClassChoiceStep[] = [];
  const rollOptions = buildChoiceRollOptions(args.effectiveDeityDocument);

  for (const feature of args.classFeatures) {
    const choices = discoverClassChoiceMeta({
      sourceDocument: feature.document,
      sourceSelection: feature.selection,
      classSlug: args.classSlug,
      extractSlug: args.extractSlug,
      localize: args.localize,
      rollOptions,
    });

    for (const choice of choices) {
      steps.push(
        createClassChoiceStep(feature.level, choice, {
          title: buildClassChoiceTitle(choice, args.localize),
          description: buildClassChoiceDescription(choice),
        })
      );
    }
  }

  return steps;
}

function buildClassChoiceTitle(choice: ClassChoiceStep["classChoice"], localize: (value: string) => string): string {
  const localized = localize(choice.sourceName);
  const flagLabel = formatSlug(choice.flag);
  if (choice.flag === "sanctification") {
    return "Sanctification";
  }
  if (choice.flag === "divineFont") {
    return "Divine Font";
  }

  return localized && localized !== choice.sourceName ? `${localized}: ${flagLabel}` : flagLabel;
}

function buildClassChoiceDescription(choice: ClassChoiceStep["classChoice"]): string {
  const classLabel = choice.classSlug ? formatSlug(choice.classSlug).toLowerCase() : "class";
  if (choice.flag === "sanctification") {
    return `Choose the sanctification your deity allows for this ${classLabel}.`;
  }
  if (choice.flag === "divineFont") {
    return `Choose the divine font your deity grants for this ${classLabel}.`;
  }

  return `Choose the ${formatSlug(choice.flag).toLowerCase()} this class feature grants.`;
}
