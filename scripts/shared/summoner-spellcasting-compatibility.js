import { MODULE_ID } from "../constants.js";
const SUMMONER_DESTINATION_KEY = /^summoner-(arcane|divine|occult|primal)-spontaneous$/;
export function summonerSpellcastingCompatibilityIssues(actorItems, steps) {
    const summonerSteps = steps.filter((step) => step.kind === "spell-choice" &&
        step.spellChoice.classSlug === "summoner" &&
        SUMMONER_DESTINATION_KEY.test(step.spellChoice.destination.key));
    if (summonerSteps.length === 0)
        return [];
    return actorItems.flatMap((value) => {
        if (!value || typeof value !== "object")
            return [];
        const item = value;
        const destinationKey = item.flags?.[MODULE_ID]?.destinationKey;
        if (item.type !== "spellcastingEntry" ||
            typeof destinationKey !== "string" ||
            !SUMMONER_DESTINATION_KEY.test(destinationKey)) {
            return [];
        }
        const tradition = String(item.system?.tradition?.value ?? "")
            .trim()
            .toLowerCase();
        const conflictingStep = summonerSteps.find((step) => step.spellChoice &&
            (tradition !== step.spellChoice.destination.tradition ||
                (destinationKey !== step.spellChoice.destination.key &&
                    (String(item.system?.prepared?.value ?? "")
                        .trim()
                        .toLowerCase() !== step.spellChoice.destination.prepared ||
                        String(item.system?.ability?.value ?? "")
                            .trim()
                            .toLowerCase() !== step.spellChoice.destination.ability))));
        if (!conflictingStep?.spellChoice)
            return [];
        const name = item.name?.trim() || "Summoner spellcasting";
        return [
            {
                code: "dependency-review",
                stepId: conflictingStep.id,
                slotId: conflictingStep.slotId,
                title: "Summoner spellcasting",
                message: `This eidolon needs ${conflictingStep.spellChoice.destination.tradition} spontaneous spellcasting using Charisma, but the existing Wayfinder entry "${name}" does not match. Ask your GM to review its spells and correct the entry on the actor sheet before applying.`,
            },
        ];
    });
}
export function withSummonerSpellcastingCompatibilityReadiness(readiness, actorItems, steps) {
    const issues = summonerSpellcastingCompatibilityIssues(actorItems, steps);
    if (issues.length === 0)
        return readiness;
    return {
        ...readiness,
        ready: false,
        blockers: [...readiness.blockers, ...issues],
        firstBlocker: readiness.firstBlocker ?? issues[0] ?? null,
    };
}
//# sourceMappingURL=summoner-spellcasting-compatibility.js.map