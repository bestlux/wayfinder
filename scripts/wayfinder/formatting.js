import { ABILITY_KEYS } from "../constants.js";
export function buildPreviewDetails(document) {
    const system = document.system ?? {};
    switch (document.type) {
        case "ancestry":
            return [
                row("Hit Points", system.hp),
                row("Size", formatSlug(system.size)),
                row("Speed", system.speed ? `${system.speed} ft` : null),
                row("Vision", formatSlug(system.vision)),
                row("Boosts", formatBoosts(system.boosts)),
                row("Flaw", formatFlaws(system.flaws)),
                row("Languages", Array.isArray(system.languages?.value)
                    ? system.languages.value.map((value) => formatSlug(value)).join(", ")
                    : null),
            ].filter(Boolean);
        case "heritage":
            return [
                row("Ancestry", system.ancestry?.name ?? formatSlug(system.ancestry?.slug)),
                row("Rarity", formatSlug(system.traits?.rarity)),
            ].filter(Boolean);
        case "background":
            return [
                row("Boosts", formatBoosts(system.boosts)),
                row("Skills", Array.isArray(system.trainedSkills?.value)
                    ? system.trainedSkills.value.map((value) => formatSlug(value)).join(", ")
                    : null),
                row("Lore", Array.isArray(system.trainedSkills?.lore) ? system.trainedSkills.lore.join(", ") : null),
                row("Granted Item", system.items
                    ? Object.values(system.items)
                        .map((item) => item.name)
                        .join(", ")
                    : null),
            ].filter(Boolean);
        case "class":
            return [
                row("Hit Points", system.hp),
                row("Key Ability", Array.isArray(system.keyAbility?.value)
                    ? system.keyAbility.value.map((value) => value.toUpperCase()).join(" or ")
                    : null),
                row("Perception", rankLabel(system.perception)),
                row("Saving Throws", formatSavingThrows(system.savingThrows)),
                row("Skill Training", typeof system.trainedSkills?.additional === "number"
                    ? `Trained in ${system.trainedSkills.additional} additional skills`
                    : null),
            ].filter(Boolean);
        case "feat":
            return [
                row("Level", system.level?.value),
                row("Category", formatSlug(system.category ?? system.featType?.value ?? document.featType)),
                row("Actions", formatActions(system)),
                row("Prerequisites", Array.isArray(system.prerequisites?.value)
                    ? system.prerequisites.value.map((entry) => entry.value ?? entry).join(", ")
                    : null),
            ].filter(Boolean);
        default:
            return [row("Level", system.level?.value)].filter(Boolean);
    }
}
export function row(label, value) {
    if (value === null || value === undefined) {
        return null;
    }
    const rendered = String(value).trim();
    return rendered ? { label, value: rendered } : null;
}
export function sameMembers(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
}
export function formatSlug(value) {
    if (typeof value !== "string" || value.length === 0) {
        return "";
    }
    return value
        .split(/[-_ ]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
export function formatBoosts(boosts) {
    if (!boosts || typeof boosts !== "object") {
        return "";
    }
    const slots = Object.values(boosts)
        .map((entry) => (Array.isArray(entry?.value) ? entry.value : []))
        .filter((values) => values.length > 0);
    return slots
        .map((values) => {
        if (values.length >= ABILITY_KEYS.length)
            return "Free";
        return values.map((value) => value.toUpperCase()).join(" or ");
    })
        .join("; ");
}
export function formatFlaws(flaws) {
    if (!flaws || typeof flaws !== "object") {
        return "";
    }
    return Object.values(flaws)
        .flatMap((entry) => (Array.isArray(entry?.value) ? entry.value : []))
        .map((value) => value.toUpperCase())
        .join(", ");
}
export function formatSavingThrows(saves) {
    if (!saves || typeof saves !== "object") {
        return "";
    }
    return [
        saves.fortitude ? `Fort ${rankLabel(saves.fortitude)}` : null,
        saves.reflex ? `Ref ${rankLabel(saves.reflex)}` : null,
        saves.will ? `Will ${rankLabel(saves.will)}` : null,
    ]
        .filter(Boolean)
        .join(" • ");
}
export function rankLabel(rank) {
    const numeric = Number(rank);
    switch (numeric) {
        case 0:
            return "Untrained";
        case 1:
            return "Trained";
        case 2:
            return "Expert";
        case 3:
            return "Master";
        case 4:
            return "Legendary";
        default:
            return String(rank ?? "");
    }
}
export function formatActions(system) {
    const actionType = system?.actionType?.value;
    const actions = system?.actions?.value;
    if (actionType === "passive") {
        return "Passive";
    }
    if (actionType === "free") {
        return "Free Action";
    }
    if (actionType === "reaction") {
        return "Reaction";
    }
    if (actionType === "action" && actions) {
        return `${actions} Action${Number(actions) === 1 ? "" : "s"}`;
    }
    return "";
}
//# sourceMappingURL=formatting.js.map