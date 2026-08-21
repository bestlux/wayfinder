import type { DraftState, PendingStep } from "../../types.js";

interface ProjectDraftSkillRanksOptions {
  baseSkillRanks: Record<string, number>;
  draft: Pick<DraftState, "skillIncreases" | "skillTrainings">;
  beforeSlotId?: string;
  additionalTrainingSkillsBySlotId?: Record<string, readonly unknown[]>;
}

type SkillRankOperation = {
  kind: "skill-increase" | "skill-training";
  slotId: string;
};

export function maxProficiencyRank(level: number): number {
  if (level >= 15) return 4;
  if (level >= 7) return 3;
  return 2;
}

export function buildAdditionalTrainingSkillsBySlotId(
  draft: DraftState,
  steps: readonly PendingStep[]
): Record<string, readonly unknown[]> {
  return Object.fromEntries(
    steps.flatMap((step) => {
      if (step.kind !== "skill-training") {
        return [];
      }

      const training = draft.skillTrainings[step.slotId];
      return [
        [
          step.slotId,
          [
            ...step.training.fixedSkills,
            ...step.training.fixedLores,
            ...step.training.loreChoices.map((choice) => training?.loreChoices[choice.key]),
          ],
        ] as const,
      ];
    })
  );
}

export function projectDraftSkillRanks(options: ProjectDraftSkillRanksOptions): Record<string, number> {
  const projected = normalizeBaseSkillRanks(options.baseSkillRanks);
  const trainingSlotIds = new Set([
    ...Object.keys(options.draft.skillTrainings),
    ...Object.keys(options.additionalTrainingSkillsBySlotId ?? {}),
  ]);
  const operations: SkillRankOperation[] = [
    ...Array.from(trainingSlotIds, (slotId): SkillRankOperation => ({ kind: "skill-training", slotId })),
    ...Object.keys(options.draft.skillIncreases).map(
      (slotId): SkillRankOperation => ({ kind: "skill-increase", slotId })
    ),
  ].sort((left, right) => compareProjectedSkillSlotIds(left.slotId, right.slotId));

  for (const operation of operations) {
    if (options.beforeSlotId && compareProjectedSkillSlotIds(operation.slotId, options.beforeSlotId) >= 0) {
      break;
    }

    if (operation.kind === "skill-training") {
      const training = options.draft.skillTrainings[operation.slotId];

      for (const skill of [
        ...Object.values(training?.ruleChoices ?? {}),
        ...(training?.additional ?? []),
        ...(options.additionalTrainingSkillsBySlotId?.[operation.slotId] ?? []),
      ]) {
        setMinimumRank(projected, skill, 1);
      }
      continue;
    }

    const slug = normalizeSkillSlug(options.draft.skillIncreases[operation.slotId]);
    if (slug) {
      projected[slug] = Math.min(4, (projected[slug] ?? 0) + 1);
    }
  }

  return projected;
}

function compareProjectedSkillSlotIds(left: string, right: string): number {
  const levelDelta = projectedSkillSlotLevel(left) - projectedSkillSlotLevel(right);
  if (levelDelta !== 0) {
    return levelDelta;
  }

  const kindDelta = projectedSkillSlotKindWeight(left) - projectedSkillSlotKindWeight(right);
  if (kindDelta !== 0) {
    return kindDelta;
  }

  return left.localeCompare(right);
}

function projectedSkillSlotLevel(slotId: string): number {
  const match = /-level-(\d+)$/.exec(slotId);
  if (match) {
    return Number(match[1]);
  }

  // Slot-ID overrides can omit a level; keep legacy drafted training visible to bounded projections.
  return slotId.startsWith("skill-training-") ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
}

function projectedSkillSlotKindWeight(slotId: string): number {
  if (slotId.startsWith("skill-training-")) {
    return 0;
  }
  if (slotId.startsWith("skill-increase-")) {
    return 1;
  }
  return 2;
}

function normalizeBaseSkillRanks(baseSkillRanks: Record<string, number>): Record<string, number> {
  const projected: Record<string, number> = {};
  for (const [rawSlug, rawRank] of Object.entries(baseSkillRanks)) {
    const slug = normalizeSkillSlug(rawSlug);
    const rank = Number(rawRank);
    if (slug && Number.isFinite(rank)) {
      projected[slug] = Math.max(0, Math.min(4, Math.floor(rank)));
    }
  }
  return projected;
}

function setMinimumRank(ranks: Record<string, number>, rawSlug: unknown, rank: number): void {
  const slug = normalizeSkillSlug(rawSlug);
  if (slug) {
    ranks[slug] = Math.max(ranks[slug] ?? 0, rank);
  }
}

function normalizeSkillSlug(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
