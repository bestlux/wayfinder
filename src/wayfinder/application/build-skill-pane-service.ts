import { SKILL_LABELS } from "../../constants.js";
import type { DraftState, PendingStep } from "../../types.js";
import { formatSlug } from "../formatting.js";
import { buildSkillIncreasePane, buildSkillTrainingPane, compareSkillIncreaseSlotIds } from "../panes/skill-pane.js";
import type { SkillIncreaseStepPane, SkillTrainingStepPane } from "../view-models.js";

type SkillPane = SkillIncreaseStepPane | SkillTrainingStepPane;
type SkillDocumentType = "background" | "class";
type LooseSkillDocument = {
  system?: {
    trainedSkills?: {
      value?: unknown[];
    } | null;
  } | null;
};

interface BuildSkillPaneDependencies {
  baseSkillRanks: Record<string, number>;
  resolveDocument: (itemType: SkillDocumentType) => Promise<unknown | null>;
  configSkills: Record<string, unknown> | null;
  localize: (value: string) => string;
  isTrainingStepComplete: (step: PendingStep) => boolean;
}

interface ProjectSkillRanksDependencies {
  baseSkillRanks: Record<string, number>;
  resolveDocument: (itemType: SkillDocumentType) => Promise<unknown | null>;
}

export async function buildSkillPane(
  step: PendingStep,
  draft: DraftState,
  deps: BuildSkillPaneDependencies
): Promise<SkillPane | null> {
  if (step.kind !== "skill-training" && step.kind !== "skill-increase") {
    return null;
  }

  const projectedRanks = await projectSkillRanks(draft, step.slotId, {
    baseSkillRanks: deps.baseSkillRanks,
    resolveDocument: deps.resolveDocument,
  });
  const skillEntries = buildSkillList(projectedRanks, {
    configSkills: deps.configSkills,
    localize: deps.localize,
  });

  if (step.kind === "skill-training") {
    return buildSkillTrainingPane(step, draft, projectedRanks, skillEntries, {
      isTrainingStepComplete: deps.isTrainingStepComplete,
    });
  }

  return buildSkillIncreasePane(step, draft, projectedRanks, skillEntries);
}

export async function projectSkillRanks(
  draft: DraftState,
  upToSlotId: string,
  deps: ProjectSkillRanksDependencies
): Promise<Record<string, number>> {
  const projected = { ...deps.baseSkillRanks };
  const [backgroundDocument, classDocument] = await Promise.all([
    deps.resolveDocument("background"),
    deps.resolveDocument("class"),
  ]);

  for (const slug of extractFixedTrainedSkills(backgroundDocument)) {
    projected[slug] = Math.max(projected[slug] ?? 0, 1);
  }

  for (const slug of extractFixedTrainedSkills(classDocument)) {
    projected[slug] = Math.max(projected[slug] ?? 0, 1);
  }

  const sortedTrainingSlotIds = Object.keys(draft.skillTrainings).sort((left, right) => left.localeCompare(right));

  for (const slotId of sortedTrainingSlotIds) {
    if (slotId >= upToSlotId) {
      break;
    }

    const training = draft.skillTrainings[slotId];
    if (!training) {
      continue;
    }

    for (const slug of [...Object.values(training.ruleChoices), ...training.additional]) {
      if (!slug) {
        continue;
      }

      projected[slug] = Math.max(projected[slug] ?? 0, 1);
    }
  }

  const sortedSlotIds = Object.keys(draft.skillIncreases).sort(compareSkillIncreaseSlotIds);

  for (const slotId of sortedSlotIds) {
    if (slotId >= upToSlotId) {
      break;
    }

    const slug = draft.skillIncreases[slotId];
    if (slug && typeof projected[slug] === "number") {
      projected[slug] = Math.min(4, projected[slug] + 1);
    } else if (slug) {
      projected[slug] = 1;
    }
  }

  return projected;
}

function extractFixedTrainedSkills(document: unknown): string[] {
  const typedDocument = document as LooseSkillDocument | null;
  const skills = Array.isArray(typedDocument?.system?.trainedSkills?.value)
    ? typedDocument.system.trainedSkills.value
    : [];
  return skills
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map((entry) => entry.trim().toLowerCase());
}

function buildSkillList(
  actorSkillRanks: Record<string, number>,
  deps: Pick<BuildSkillPaneDependencies, "configSkills" | "localize">
): Array<{ slug: string; label: string }> {
  const result: Array<{ slug: string; label: string }> = [];
  const seen = new Set<string>();

  if (deps.configSkills && typeof deps.configSkills === "object") {
    for (const slug of Object.keys(deps.configSkills)) {
      const sourceLabel = resolveConfigSkillLabel(deps.configSkills[slug]);
      const label = skillLabel(slug, sourceLabel, deps.localize);
      result.push({ slug, label });
      seen.add(slug);
    }
  } else {
    for (const [slug, label] of Object.entries(SKILL_LABELS)) {
      result.push({ slug, label: skillLabel(slug, label, deps.localize) });
      seen.add(slug);
    }
  }

  for (const slug of Object.keys(actorSkillRanks)) {
    if (!seen.has(slug)) {
      result.push({ slug, label: skillLabel(slug, undefined, deps.localize) });
    }
  }

  return result.sort((left, right) => left.label.localeCompare(right.label));
}

function resolveConfigSkillLabel(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }

  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const label = (entry as { label?: unknown }).label;
  return typeof label === "string" ? label : undefined;
}

function skillLabel(slug: string, sourceLabel: string | undefined, localize: (value: string) => string): string {
  const localized = typeof sourceLabel === "string" && sourceLabel.length > 0 ? localize(sourceLabel) : "";
  if (localized && localized !== sourceLabel) {
    return localized;
  }

  const fallback = SKILL_LABELS[slug];
  if (fallback) {
    return localize(fallback);
  }

  return formatSlug(slug);
}
