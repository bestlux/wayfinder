import { cloneData } from "../../shared/cloning.js";
import { materializeStructuredCreatureSizeChoice } from "../../shared/structured-creature-size-choice.js";
export function materializedPhysicalItemSize(size) {
    const sizes = {
        tiny: "tiny",
        small: "med",
        medium: "med",
        large: "lg",
        huge: "huge",
        gargantuan: "grg",
    };
    return sizes[size];
}
export async function resolvePreparedDraftedEquipmentSize(input) {
    const preparedActor = await input.prepareDraftedActor(input);
    const system = record(record(preparedActor).system);
    const traits = record(system.traits);
    const rawNaturalSize = traits.naturalSize;
    const rawActorSize = record(traits.size).value;
    const rawEquipmentSize = rawNaturalSize ?? rawActorSize;
    const size = equipmentSize(record(rawEquipmentSize).value ?? rawEquipmentSize);
    if (!size)
        throw new TypeError("Equipment requires a selected ancestry with a supported authoritative size.");
    return size;
}
export async function prepareTransientDraftedEquipmentActor(input) {
    const selections = Object.values(input.draft.selections).filter((selection) => selection.itemType === "ancestry" || selection.itemType === "heritage");
    const ancestrySelections = selections.filter((selection) => selection.itemType === "ancestry");
    const heritageSelections = selections.filter((selection) => selection.itemType === "heritage");
    if (ancestrySelections.length !== 1 || heritageSelections.length > 1) {
        throw new TypeError("Equipment size preparation requires one drafted ancestry and at most one heritage.");
    }
    const itemSources = [];
    for (const selection of selections) {
        if (selection.itemType !== "ancestry" && selection.itemType !== "heritage")
            continue;
        const document = await input.fetchDocumentByUuid(selection.uuid);
        const source = documentSource(document);
        if (!source || record(source).type !== selection.itemType) {
            throw new TypeError(`The drafted ${selection.itemType} document cannot prepare authoritative actor size.`);
        }
        const stamped = cloneData(source);
        applyDraftedSingletonChoices(stamped, selection.itemType, input.draft.singletonChoices);
        stamped._id = transientId();
        itemSources.push(stamped);
    }
    const actorToObject = record(input.actor).toObject;
    if (typeof actorToObject !== "function") {
        throw new TypeError("Equipment size preparation requires a PF2E actor document.");
    }
    const actorSource = cloneData(actorToObject.call(input.actor, true));
    const actorSystem = record(actorSource.system);
    const details = record(actorSystem.details);
    const level = record(details.level);
    level.value = input.targetLevel;
    details.level = level;
    actorSystem.details = details;
    actorSource.system = actorSystem;
    actorSource._id = transientId();
    actorSource.name = `Wayfinder drafted-size preparation ${input.targetLevel}`;
    actorSource.items = itemSources;
    const actorClass = record(record(CONFIG).Actor).documentClass;
    if (typeof actorClass !== "function")
        throw new Error("PF2E actor preparation is unavailable.");
    return new actorClass(actorSource, { temporary: true });
}
function applyDraftedSingletonChoices(source, itemType, choices) {
    const system = record(source.system);
    const slug = typeof system.slug === "string" && system.slug ? system.slug : null;
    const rules = Array.isArray(system.rules) ? system.rules : [];
    if (!slug)
        return;
    const prefix = `singleton-choice-${itemType}-${slug}-`;
    for (const [slotId, value] of Object.entries(choices)) {
        if (!slotId.startsWith(prefix) || !value)
            continue;
        const match = /^(.+)-level-\d+$/u.exec(slotId.slice(prefix.length));
        const flag = match?.[1];
        if (!flag)
            continue;
        const sourceRuleIndex = rules.findIndex((candidate) => record(candidate).key === "ChoiceSet" && record(candidate).flag === flag);
        const rule = rules[sourceRuleIndex];
        if (!rule)
            throw new TypeError(`The drafted ${itemType} size choice ${flag} no longer exists.`);
        const installedValue = materializeStructuredCreatureSizeChoice({
            sourceItemType: itemType,
            rules,
            sourceRuleIndex,
            selectedValue: value,
        });
        record(rule).selection = installedValue;
        const flags = record(source.flags);
        const pf2e = record(flags.pf2e);
        const rulesSelections = record(pf2e.rulesSelections);
        rulesSelections[flag] = installedValue;
        pf2e.rulesSelections = rulesSelections;
        flags.pf2e = pf2e;
        source.flags = flags;
    }
}
function documentSource(document) {
    const toObject = record(document).toObject;
    if (typeof toObject !== "function")
        return null;
    const source = toObject.call(document, true);
    return source && typeof source === "object" ? cloneData(source) : null;
}
function equipmentSize(rawSize) {
    if (typeof rawSize !== "string")
        return null;
    const sizes = {
        tiny: "tiny",
        sm: "small",
        small: "small",
        med: "medium",
        medium: "medium",
        lg: "large",
        large: "large",
        huge: "huge",
        grg: "gargantuan",
        gargantuan: "gargantuan",
    };
    return sizes[rawSize.trim().toLowerCase()] ?? null;
}
function transientId() {
    const randomId = record(record(globalThis).foundry).utils;
    const mint = record(randomId).randomID;
    if (typeof mint === "function")
        return mint(16);
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
//# sourceMappingURL=equipment-size-preparation-service.js.map