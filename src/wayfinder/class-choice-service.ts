import { SKILL_LABELS } from "../constants.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import { formatSlug } from "./formatting.js";

interface BuildClassTrainingStepsParams {
  draftClassSelection: SelectionRef | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<any | null>;
  extractSlug: (document: any) => string | null;
  localize: (value: string) => string;
}

interface BuildClassBranchStepsParams {
  draft: DraftState;
  effectiveClassDocument: any | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<any | null>;
  extractSlug: (document: any) => string | null;
  readExistingBranchSelection: (branch: NonNullable<PendingStep["branch"]>) => string | null;
}

export async function buildClassTrainingSteps(params: BuildClassTrainingStepsParams): Promise<PendingStep[]> {
  const { draftClassSelection, targetLevel, fetchSelectionDocument, extractSlug, localize } = params;
  if (!draftClassSelection || targetLevel < 1) {
    return [];
  }

  const classDocument = await fetchSelectionDocument(draftClassSelection);
  if (!classDocument) {
    return [];
  }

  const classSlug = extractSlug(classDocument) ?? "class";
  const rules = Array.isArray(classDocument.system?.rules) ? classDocument.system.rules : [];
  const choiceRules = rules
    .map((rule: any, ruleIndex: number) => toTrainingChoiceRule(rule, ruleIndex, localize))
    .filter((rule): rule is NonNullable<typeof rule> => !!rule);

  const additionalCount = Number(classDocument.system?.trainedSkills?.additional ?? 0);
  const fixedSkills = Array.isArray(classDocument.system?.trainedSkills?.value)
    ? classDocument.system.trainedSkills.value
        .filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry: string) => entry.trim().toLowerCase())
    : [];

  if (choiceRules.length === 0 && additionalCount <= 0) {
    return [];
  }

  return [{
    id: `skill-training-${classSlug}-level-1`,
    level: 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: `${classDocument.name} skill training`,
    description: "Choose the class skill training decisions this class grants at 1st level.",
    required: true,
    slotId: `skill-training-${classSlug}-level-1`,
    training: {
      classSlug,
      className: classDocument.name ?? "Class",
      fixedSkills,
      choiceRules,
      additionalCount
    }
  }];
}

export async function buildClassBranchSteps(params: BuildClassBranchStepsParams): Promise<PendingStep[]> {
  const { draft, effectiveClassDocument, targetLevel, fetchSelectionDocument, extractSlug, readExistingBranchSelection } = params;
  if (!effectiveClassDocument) {
    return [];
  }

  const classSlug = extractSlug(effectiveClassDocument);
  const items = Object.values(effectiveClassDocument?.system?.items ?? {}) as Array<{ level?: number; uuid?: string; name?: string }>;
  const selectorSelections = items
    .filter((entry) =>
      typeof entry?.uuid === "string"
      && entry.uuid.startsWith("Compendium.")
      && Number(entry.level ?? 0) <= targetLevel
    )
    .map((entry) => selectionFromCompendiumUuid(entry.uuid ?? "", entry.name ?? "", "feat"))
    .filter((entry): entry is SelectionRef => entry !== null);

  const selectorDocuments = await Promise.all(selectorSelections.map((selection) => fetchSelectionDocument(selection)));
  const steps: PendingStep[] = [];

  for (let index = 0; index < selectorSelections.length; index += 1) {
    const selectorSelection = selectorSelections[index];
    const selectorDocument = selectorDocuments[index];
    const branch = extractClassBranchMeta(selectorDocument, selectorSelection, classSlug, extractSlug);
    if (!branch) {
      continue;
    }

    const actorSelection = readExistingBranchSelection(branch);
    const draftSelection = draft.branchSelections[branch.slotId];
    if (actorSelection && !draftSelection) {
      continue;
    }

    steps.push({
      id: branch.slotId,
      level: selectorDocument?.system?.level?.value ?? 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: branch.selectorName,
      description: `Choose the ${branch.selectorName.toLowerCase()} option that defines this class path.`,
      required: true,
      slotId: branch.slotId,
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
        maxLevel: selectorDocument?.system?.level?.value ?? 1
      },
      branch
    });
  }

  return steps;
}

function toTrainingChoiceRule(
  rule: any,
  ruleIndex: number,
  localize: (value: string) => string
): NonNullable<PendingStep["training"]>["choiceRules"][number] | null {
  if (rule?.key !== "ChoiceSet" || !Array.isArray(rule?.choices) || typeof rule?.flag !== "string") {
    return null;
  }

  const options = (rule.choices as Array<{ label?: string; value?: string }>)
    .filter((choice) => typeof choice?.value === "string" && choice.value.length > 0)
    .map((choice) => {
      const slug = String(choice.value).trim().toLowerCase();
      return {
        slug,
        label: skillLabel(slug, typeof choice.label === "string" ? choice.label : undefined, localize)
      };
    })
    .filter((choice): choice is { slug: string; label: string } => !!choice);

  if (options.length === 0 || !looksLikeSkillChoiceRule(rule, options.map((option) => option.slug))) {
    return null;
  }

  return {
    ruleIndex,
    flag: rule.flag,
    prompt: localize(String(rule.prompt ?? "Choose a skill")),
    options
  };
}

function extractClassBranchMeta(
  selectorDocument: any,
  selectorSelection: SelectionRef,
  classSlug: string | null,
  extractSlug: (document: any) => string | null
): PendingStep["branch"] | null {
  if (!selectorDocument || selectorDocument.type !== "feat" || selectorDocument?.system?.category !== "classfeature") {
    return null;
  }

  const rules = Array.isArray(selectorDocument.system?.rules) ? selectorDocument.system.rules : [];
  const choiceRuleIndex = rules.findIndex((rule: any) => rule?.key === "ChoiceSet" && typeof rule?.flag === "string");
  if (choiceRuleIndex === -1) {
    return null;
  }

  const choiceRule = rules[choiceRuleIndex];
  const grantRule = rules.find((rule: any) => rule?.key === "GrantItem" && typeof rule?.uuid === "string");
  if (!grantRule) {
    return null;
  }

  const optionTag = extractChoiceTag(choiceRule, String(choiceRule.flag));
  if (!optionTag) {
    return null;
  }

  const selectorSlug = extractSlug(selectorDocument) ?? selectorSelection.documentId;
  const level = Number(selectorDocument?.system?.level?.value ?? 1) || 1;

  return {
    selectorPackId: selectorSelection.packId,
    selectorDocumentId: selectorSelection.documentId,
    selectorUuid: selectorSelection.uuid,
    selectorName: selectorDocument.name ?? selectorSelection.name,
    selectorRuleIndex: choiceRuleIndex,
    flag: String(choiceRule.flag),
    optionTag,
    classSlug,
    slotId: `class-branch-${selectorSlug}-level-${level}`
  } as PendingStep["branch"];
}

function extractChoiceTag(choiceRule: any, flag: string): string | null {
  const filters = Array.isArray(choiceRule?.choices?.filter) ? choiceRule.choices.filter : [];
  const directTag = filters
    .filter((entry: unknown): entry is string => typeof entry === "string")
    .map((entry) => /^item:tag:(.+)$/.exec(entry)?.[1] ?? null)
    .find((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (directTag) {
    return directTag.trim().toLowerCase();
  }

  const uuid = typeof choiceRule?.uuid === "string" ? choiceRule.uuid : "";
  return uuid.includes(`rulesSelections.${flag}`) ? flag.trim().toLowerCase() : null;
}

function selectionFromCompendiumUuid(uuid: string, name: string, itemType: string): SelectionRef | null {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid);
  if (!match) {
    return null;
  }

  return {
    slotId: "",
    packId: match[1],
    documentId: match[2],
    uuid,
    itemType,
    featType: itemType === "feat" ? "classfeature" : null,
    name,
    level: null
  };
}

function looksLikeSkillChoiceRule(rule: any, optionSlugs: string[]): boolean {
  if (optionSlugs.length === 0) {
    return false;
  }

  const recognizedCount = optionSlugs.filter((slug) => isConfiguredSkillSlug(slug)).length;
  if (recognizedCount === optionSlugs.length) {
    return true;
  }

  const hintText = `${String(rule?.flag ?? "")} ${String(rule?.prompt ?? "")}`.toLowerCase();
  return /\bskill\b|\bskills\b|\blore\b/.test(hintText);
}

function isConfiguredSkillSlug(value: string): boolean {
  const slug = value.trim().toLowerCase();
  if (Object.hasOwn(SKILL_LABELS, slug)) {
    return true;
  }

  const configured = globalThis.CONFIG?.PF2E?.skills;
  return !!configured && typeof configured === "object" && Object.hasOwn(configured, slug);
}

function skillLabel(slug: string, label: string | undefined, localize: (value: string) => string): string {
  const localized = typeof label === "string" && label.length > 0 ? localize(label) : "";
  if (localized && localized !== label) {
    return localized;
  }

  const configured = globalThis.CONFIG?.PF2E?.skills?.[slug];
  const configuredLabel = typeof configured === "string" ? configured : configured?.label;
  const fallback = typeof configuredLabel === "string" && configuredLabel.length > 0
    ? configuredLabel
    : (SKILL_LABELS[slug] ?? formatSlug(slug));
  return localize(fallback);
}
