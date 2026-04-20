import { BOOST_LEVELS, getEffectiveBuildState, listActorItems } from "../build-state.js";
const DEFAULT_DEPS = {
    getEffectiveBuildState,
};
export async function applyBoostDraft(actor, draft, deps = DEFAULT_DEPS) {
    const buildState = await deps.getEffectiveBuildState(actor, draft);
    const updates = [];
    const actorItems = listActorItems(actor);
    const ancestryItem = actorItems.find((item) => item?.type === "ancestry");
    if (ancestryItem && buildState.ancestry) {
        const ancestryUpdate = { _id: ancestryItem.id };
        if (buildState.ancestry.mode === "alternate") {
            ancestryUpdate["system.alternateAncestryBoosts"] = buildState.ancestry.alternateBoosts;
        }
        else {
            ancestryUpdate["system.-=alternateAncestryBoosts"] = null;
        }
        for (const [slot, value] of Object.entries(buildState.ancestry.selectedBoosts)) {
            ancestryUpdate[`system.boosts.${slot}.selected`] = value;
        }
        ancestryUpdate["system.voluntary.flaws"] = buildState.ancestry.voluntary.enabled
            ? buildState.ancestry.voluntary.flaws
            : [];
        if (buildState.ancestry.voluntary.enabled && buildState.ancestry.voluntary.legacy) {
            ancestryUpdate["system.voluntary.boost"] = buildState.ancestry.voluntary.boost;
        }
        else {
            ancestryUpdate["system.voluntary.-=boost"] = null;
        }
        updates.push(ancestryUpdate);
    }
    const backgroundItem = actorItems.find((item) => item?.type === "background");
    if (backgroundItem && buildState.background) {
        const backgroundUpdate = { _id: backgroundItem.id };
        for (const [slot, value] of Object.entries(buildState.background.selectedBoosts)) {
            backgroundUpdate[`system.boosts.${slot}.selected`] = value;
        }
        updates.push(backgroundUpdate);
    }
    const classItem = actorItems.find((item) => item?.type === "class");
    if (classItem && buildState.class) {
        updates.push({
            _id: classItem.id,
            "system.keyAbility.selected": buildState.class.selectedKeyAbility ?? null,
        });
    }
    if (updates.length > 0 && typeof actor.updateEmbeddedDocuments === "function") {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
    const actorBoostUpdate = Object.fromEntries(BOOST_LEVELS.map((level) => [`system.build.attributes.boosts.${level}`, buildState.levelBoosts[level]]));
    if (typeof actor.update === "function") {
        await actor.update(actorBoostUpdate);
    }
}
//# sourceMappingURL=boost-application.js.map