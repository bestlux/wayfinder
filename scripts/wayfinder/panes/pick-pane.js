import { fetchSelectionDocument } from "../../pack/access.js";
import { enrichHtml } from "../../shared/foundry-compat.js";
import { buildPreviewDetails, formatSlug } from "../formatting.js";
export const DEDICATION_SUPPORT_DISCLOSURE = "How much of a dedication Wayfinder can handle varies. It applies what it understands, but benefits written out in prose may need setting up by hand on the PF2E sheet. Worth reading this feat before you apply, and again after.";
export function buildPickItemPane(args) {
    const { step, search, activeFilterCount, selectedValue, selectedLabel, filterGroups, visibleOptions, infoState, suppressionNotice, contextNote, preview, modeLabel, previewValue, } = args;
    return {
        kind: "pick-item",
        templateKind: "pick-item",
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel,
        title: step.title,
        description: step.description,
        search,
        activeFilterCount,
        selectedValue,
        selectedLabel,
        resultCount: visibleOptions.length,
        contextNote,
        infoState,
        suppressionNotice,
        filterGroups,
        options: visibleOptions.map((option) => ({
            ...option,
            selected: option.value === selectedValue,
            previewing: option.value === previewValue,
            sourceLabel: option.source ?? "Unknown Source",
        })),
        preview,
    };
}
export async function buildPreview(option, selectedValue) {
    if (!option) {
        return null;
    }
    const document = await fetchSelectionDocument({
        slotId: "",
        packId: option.packId,
        documentId: option.documentId,
        uuid: option.uuid,
        itemType: option.itemType,
        featType: option.featType,
        name: option.name,
        level: option.level,
    });
    if (!document) {
        return {
            title: option.name,
            img: option.img,
            source: option.source,
            rarity: option.rarity,
            tags: [],
            details: [],
            description: "",
            disclosure: buildPreviewDisclosure(option.disclosure, option.traits),
            selected: option.value === selectedValue,
            selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
            value: option.value,
        };
    }
    const system = document.system ?? {};
    const traits = Array.isArray(system.traits?.value)
        ? system.traits.value.map((trait) => formatSlug(trait))
        : [];
    return {
        title: document.name,
        img: document.img,
        source: system.publication?.title?.trim() || option.source,
        rarity: system.traits?.rarity ?? option.rarity,
        tags: traits,
        details: buildPreviewDetails(document),
        description: await enrichHtml(String(system.description?.value ?? ""), { async: true }),
        disclosure: buildPreviewDisclosure(option.disclosure, traits),
        selected: option.value === selectedValue,
        selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
        value: option.value,
    };
}
export function buildPreviewDisclosure(existingDisclosure, traits) {
    const parts = [existingDisclosure?.trim() ?? ""];
    if (traits.some((trait) => trait.trim().toLowerCase() === "dedication")) {
        parts.push(DEDICATION_SUPPORT_DISCLOSURE);
    }
    const disclosure = parts.filter(Boolean).join(" ");
    return disclosure.length > 0 ? disclosure : null;
}
export function selectedSelection(step, draft) {
    return step.kind === "class-branch"
        ? (draft.branchSelections[step.slotId] ?? null)
        : (draft.selections[step.slotId] ?? null);
}
export function selectedValueFor(step, draft) {
    const selection = selectedSelection(step, draft);
    return selection ? `${selection.packId}:${selection.documentId}` : "";
}
export function resolvePreviewValue(stepId, filteredOptions, allOptions, selectedValue, previewValueByStepId) {
    const current = previewValueByStepId.get(stepId);
    if (current && allOptions.some((option) => option.value === current)) {
        return current;
    }
    if (selectedValue) {
        previewValueByStepId.set(stepId, selectedValue);
        return selectedValue;
    }
    const fallback = filteredOptions[0]?.value ?? allOptions[0]?.value ?? "";
    if (fallback) {
        previewValueByStepId.set(stepId, fallback);
    }
    return fallback;
}
export function matchesSearch(option, search) {
    const query = search.trim().toLowerCase();
    if (!query) {
        return true;
    }
    return [option.name, option.source ?? "", option.rarity ?? ""].some((value) => value.toLowerCase().includes(query));
}
//# sourceMappingURL=pick-pane.js.map