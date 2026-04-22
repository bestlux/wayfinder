import { projectAbilities } from "./build-state/ability-projection.js";
import { getEffectiveSingletonDocument, listActorItems } from "./build-state/singleton-resolution.js";
import { ABILITY_KEYS } from "./constants.js";
const BOOST_LEVELS = [1, 5, 10, 15, 20];
async function getEffectiveBuildState(actor, draft) {
    const [ancestryDocument, heritageDocument, backgroundDocument, classDocument, deityDocument] = await Promise.all([
        getEffectiveSingletonDocument(actor, draft, "ancestry"),
        getEffectiveSingletonDocument(actor, draft, "heritage"),
        getEffectiveSingletonDocument(actor, draft, "background"),
        getEffectiveSingletonDocument(actor, draft, "class"),
        getEffectiveSingletonDocument(actor, draft, "deity"),
    ]);
    const ancestry = ancestryDocument ? buildEffectiveAncestryState(ancestryDocument, draft.boosts) : null;
    const background = backgroundDocument ? buildEffectiveBackgroundState(backgroundDocument, draft.boosts) : null;
    const effectiveClass = classDocument ? buildEffectiveClassState(classDocument, draft.boosts) : null;
    const levelBoosts = buildEffectiveLevelBoosts(actor, draft.boosts);
    const allowedBoosts = buildAllowedBoosts(draft.targetLevel);
    const projectedAbilities = projectAbilities({
        ancestryBoosts: ancestry?.buildBoosts ?? [],
        ancestryFlaws: ancestry?.buildFlaws ?? [],
        backgroundBoosts: background?.buildBoosts ?? [],
        classBoost: effectiveClass?.selectedKeyAbility ?? null,
        levelBoosts,
    });
    const languages = ancestryDocument
        ? buildEffectiveLanguageState(actor, ancestryDocument, projectedAbilities.int.modifier)
        : null;
    return {
        ancestry,
        heritage: heritageDocument,
        background,
        class: effectiveClass,
        deity: deityDocument,
        languages,
        levelBoosts,
        allowedBoosts,
        projectedAbilities,
    };
}
function buildEffectiveAncestryState(document, boosts) {
    const boostEntries = Object.entries(document?.system?.boosts ?? {});
    const committedMode = Array.isArray(document?.system?.alternateAncestryBoosts) ? "alternate" : "standard";
    const mode = boosts.ancestry.modeTouched ? boosts.ancestry.mode : committedMode;
    const selectedBoosts = Object.fromEntries(boostEntries.map(([key, boost]) => [key, boosts.ancestry.selectedBoosts[key] ?? normalizeAbility(boost?.selected)]));
    const lockedBoosts = boostEntries
        .flatMap(([, boost]) => (boost.value.length === 1 ? boost.value : []))
        .filter(isAbilityKey);
    const alternateBoosts = mode === "alternate"
        ? normalizeAbilityList(boosts.ancestry.modeTouched ? boosts.ancestry.alternateBoosts : document?.system?.alternateAncestryBoosts, 2)
        : [];
    const voluntary = normalizeVoluntaryState(boosts.ancestry.voluntary.touched ? boosts.ancestry.voluntary : document?.system?.voluntary);
    const buildBoosts = mode === "alternate"
        ? [...alternateBoosts]
        : Object.values(selectedBoosts).filter((ability) => ability !== null);
    if (voluntary.enabled && voluntary.legacy && voluntary.boost) {
        buildBoosts.push(voluntary.boost);
    }
    return {
        document,
        mode,
        selectedBoosts,
        alternateBoosts,
        lockedBoosts,
        voluntary,
        buildBoosts,
        buildFlaws: voluntary.enabled ? [...voluntary.flaws] : [],
    };
}
function buildEffectiveBackgroundState(document, boosts) {
    const boostEntries = Object.entries(document?.system?.boosts ?? {});
    const selectedBoosts = Object.fromEntries(boostEntries.map(([key, boost]) => [
        key,
        boosts.background.selectedBoosts[key] ?? normalizeAbility(boost?.selected),
    ]));
    return {
        document,
        selectedBoosts,
        buildBoosts: Object.values(selectedBoosts).filter((ability) => ability !== null),
    };
}
function buildEffectiveClassState(document, boosts) {
    const keyAbilityOptions = normalizeAbilityList(document?.system?.keyAbility?.value, 6);
    return {
        document,
        keyAbilityOptions,
        selectedKeyAbility: boosts.class.keyAbility ?? normalizeAbility(document?.system?.keyAbility?.selected),
    };
}
function buildEffectiveLanguageState(actor, ancestryDocument, intelligenceModifier) {
    const grantedLanguages = normalizeStringList(ancestryDocument?.system?.languages?.value);
    const selectableLanguages = normalizeStringList(ancestryDocument?.system?.additionalLanguages?.value).filter((slug) => !grantedLanguages.includes(slug));
    const additionalCount = toNonNegativeNumber(ancestryDocument?.system?.additionalLanguages?.count);
    const sourceLanguages = normalizeStringList(actor?.system?.details?.languages?.value).filter((slug) => !grantedLanguages.includes(slug));
    return {
        sourceLanguages,
        grantedLanguages,
        selectableLanguages,
        maxSelections: additionalCount + Math.max(intelligenceModifier, 0),
    };
}
function buildEffectiveLevelBoosts(actor, boosts) {
    const actorBuildBoosts = actor?.system?.build?.attributes?.boosts ?? {};
    return Object.fromEntries(BOOST_LEVELS.map((level) => {
        const draftSelection = boosts.levels[String(level)];
        const source = Array.isArray(draftSelection) ? draftSelection : actorBuildBoosts[level];
        return [level, normalizeAbilityList(source, 4)];
    }));
}
function buildAllowedBoosts(targetLevel) {
    return Object.fromEntries(BOOST_LEVELS.map((level) => [level, level <= targetLevel ? 4 : 0]));
}
function normalizeAbility(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return isAbilityKey(normalized) ? normalized : null;
}
function normalizeAbilityList(value, maxLength = 6) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.map((entry) => normalizeAbility(entry)).filter((entry) => entry !== null))).slice(0, maxLength);
}
function normalizeStringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
        .filter((entry) => entry.length > 0)));
}
function normalizeVoluntaryState(value) {
    const legacy = value?.legacy === true ||
        (typeof value?.legacy !== "boolean" && Object.prototype.hasOwnProperty.call(value ?? {}, "boost"));
    const flaws = Array.isArray(value?.flaws)
        ? value.flaws
            .map((entry) => normalizeAbility(entry))
            .filter((entry) => entry !== null)
            .slice(0, legacy ? 2 : 6)
        : [];
    const boost = normalizeAbility(value?.boost);
    return {
        enabled: value?.enabled === true || legacy || flaws.length > 0 || boost !== null,
        legacy,
        boost,
        flaws,
    };
}
function isAbilityKey(value) {
    return typeof value === "string" && ABILITY_KEYS.includes(value);
}
function toNonNegativeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}
export { BOOST_LEVELS, getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems };
//# sourceMappingURL=build-state.js.map