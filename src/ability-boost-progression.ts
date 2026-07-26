import type { BoostLevel } from "./types.js";

export interface AbilityBoostMilestone {
  level: number;
  batchLevel: BoostLevel;
  requiredCount: number;
  grantCount: number;
}

export const BOOST_LEVELS = [1, 5, 10, 15, 20] as const satisfies readonly BoostLevel[];

const STANDARD_MILESTONES: readonly AbilityBoostMilestone[] = [
  { level: 5, batchLevel: 5, requiredCount: 4, grantCount: 4 },
  { level: 10, batchLevel: 10, requiredCount: 4, grantCount: 4 },
  { level: 15, batchLevel: 15, requiredCount: 4, grantCount: 4 },
  { level: 20, batchLevel: 20, requiredCount: 4, grantCount: 4 },
];

const GRADUAL_MILESTONES: readonly AbilityBoostMilestone[] = [5, 10, 15, 20].flatMap((batchLevel) =>
  [1, 2, 3, 4].map((requiredCount) => ({
    level: batchLevel - 4 + requiredCount,
    batchLevel: batchLevel as BoostLevel,
    requiredCount,
    grantCount: 1,
  }))
);

export function abilityBoostMilestones(gradualBoostsEnabled: boolean): readonly AbilityBoostMilestone[] {
  return gradualBoostsEnabled ? GRADUAL_MILESTONES : STANDARD_MILESTONES;
}

export function allowedAbilityBoosts(
  batchLevel: BoostLevel,
  targetLevel: number,
  gradualBoostsEnabled: boolean
): number {
  if (batchLevel === 1) {
    return targetLevel >= 1 ? 4 : 0;
  }

  if (!gradualBoostsEnabled) {
    return targetLevel >= batchLevel ? 4 : 0;
  }

  return 4 - Math.max(0, Math.min(4, batchLevel - targetLevel));
}

export function isGradualAbilityBoostsEnabled(): boolean {
  const foundryGame = (
    globalThis as typeof globalThis & {
      game?: {
        settings?: {
          get?: (scope: string, key: string) => unknown;
        };
      };
    }
  ).game;

  return foundryGame?.settings?.get?.("pf2e", "gradualBoostsVariant") === true;
}
