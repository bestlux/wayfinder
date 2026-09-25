import { SKILL_LABELS } from "../../constants.js";
export const BLOODRAGER_DEDICATION_UUID = "Compendium.pf2e.feats-srd.Item.EcyPTxSwtdqrOtxY";
export const BLOODRAGER_TRADITION_SLOT = "class-choice-bloodrager-dedication-skill-level-2";
export function isBloodragerTraditionChoice(sourceUuid, ruleIndex) {
    return sourceUuid === BLOODRAGER_DEDICATION_UUID && ruleIndex === 0;
}
/** Tradition is a build choice even when its associated skill needs a replacement. */
export function projectBloodragerTrainingSource(source, draft) {
    if (source.sourceSelection?.uuid !== BLOODRAGER_DEDICATION_UUID)
        return source;
    const document = source.sourceDocument;
    const skill = draft?.classChoices[BLOODRAGER_TRADITION_SLOT] ??
        document?.flags?.pf2e?.rulesSelections?.skill ??
        document?.flags?.system?.rulesSelections?.skill ??
        document?.system?.rules?.[0]?.selection;
    const choices = skill === "arcana" || skill === "religion"
        ? [
            {
                key: "feat:bloodrager-dedication:tradition-training",
                flag: "traditionTraining",
                prompt: `Train in ${SKILL_LABELS[skill]}`,
                sourceLabel: "Bloodrager Dedication",
                options: [{ slug: skill, label: SKILL_LABELS[skill] }],
                fallbackPrompt: `Already trained in ${SKILL_LABELS[skill]}: choose another skill`,
                fallbackOptions: Object.entries(SKILL_LABELS).map(([slug, label]) => ({ slug, label })),
                // The native rule stores the tradition. Replacement skill training must not overwrite it.
                persistence: null,
            },
        ]
        : [];
    return {
        ...source,
        trainingOverride: { fixedSkills: [], fixedLores: [], choiceRules: choices, loreChoices: [] },
    };
}
//# sourceMappingURL=bloodrager.js.map