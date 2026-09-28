import { discoverClassChoiceMeta } from "../class-choice/rule-discovery.js";
import { projectStoredClassChoiceSelection } from "../class-choice/selection-value.js";
import { getDocumentRules } from "../rule-data.js";
import { findClassFeatureDocumentByOtherTag } from "./tradition-utils.js";
import { asSpellChoiceSchoolDocument } from "./types.js";
export const SUMMONER_SPELL_CHOICE_PREFIX = "spell-choice-summoner-";
export function isSummonerTraditionChoice(choice) {
    return choice?.classSlug === "summoner" && choice.flag === "eidolonTradition";
}
export function isEidolonTraditionChoiceSlotId(slotId) {
    return /^class-choice-.+-eidolonTradition-level-\d+$/.test(slotId);
}
export function resolveSummonerSpellTradition(args) {
    // Sources are ordered with drafted branches first, ahead of owned class features.
    const source = args.sources.find(({ document }) => document && findClassFeatureDocumentByOtherTag([document], "summoner-eidolon"));
    if (!source)
        return null;
    const rules = getDocumentRules(source.document);
    const effects = rules.filter((rule) => rule.key === "ActiveEffectLike" && rule.mode === "override" && rule.path === "flags.system.eidolon.tradition");
    if (effects.length !== 1)
        return null;
    const effect = effects[0];
    if (isTradition(effect.value))
        return effect.value;
    if (effect.value !== "{item|flags.system.rulesSelections.eidolonTradition.tradition}")
        return null;
    const choice = discoverClassChoiceMeta({
        sourceDocument: source.document,
        sourceSelection: source.selection,
        classSlug: "summoner",
        extractSlug: (document) => args.extractSlug(asSpellChoiceSchoolDocument(document)),
        localize: (value) => value,
        rollOptions: new Set(["class:summoner"]),
    }).find((entry) => isSummonerTraditionChoice(entry));
    if (!choice)
        return null;
    const value = Object.hasOwn(args.draft.classChoices, choice.slotId)
        ? args.draft.classChoices[choice.slotId]
        : projectStoredClassChoiceSelection(choice, source.existingRulesSelections?.[choice.flag]);
    return isTradition(value) && choice.options.some((option) => option.value === value) ? value : null;
}
function isTradition(value) {
    return value === "arcane" || value === "divine" || value === "occult" || value === "primal";
}
//# sourceMappingURL=summoner-tradition.js.map