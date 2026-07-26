export const BOOST_LEVELS = [1, 5, 10, 15, 20];
const STANDARD_MILESTONES = [
    { level: 5, batchLevel: 5, requiredCount: 4, grantCount: 4 },
    { level: 10, batchLevel: 10, requiredCount: 4, grantCount: 4 },
    { level: 15, batchLevel: 15, requiredCount: 4, grantCount: 4 },
    { level: 20, batchLevel: 20, requiredCount: 4, grantCount: 4 },
];
const GRADUAL_MILESTONES = [5, 10, 15, 20].flatMap((batchLevel) => [1, 2, 3, 4].map((requiredCount) => ({
    level: batchLevel - 4 + requiredCount,
    batchLevel: batchLevel,
    requiredCount,
    grantCount: 1,
})));
export function abilityBoostMilestones(gradualBoostsEnabled) {
    return gradualBoostsEnabled ? GRADUAL_MILESTONES : STANDARD_MILESTONES;
}
export function allowedAbilityBoosts(batchLevel, targetLevel, gradualBoostsEnabled) {
    if (batchLevel === 1) {
        return targetLevel >= 1 ? 4 : 0;
    }
    if (!gradualBoostsEnabled) {
        return targetLevel >= batchLevel ? 4 : 0;
    }
    return 4 - Math.max(0, Math.min(4, batchLevel - targetLevel));
}
export function isGradualAbilityBoostsEnabled() {
    const foundryGame = globalThis.game;
    return foundryGame?.settings?.get?.("pf2e", "gradualBoostsVariant") === true;
}
//# sourceMappingURL=ability-boost-progression.js.map