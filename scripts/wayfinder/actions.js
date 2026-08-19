export function bindWayfinderInteractions(root, handlers, scrollById, pendingSearchFocus) {
    for (const element of root.querySelectorAll("[data-wayfinder-action]")) {
        element.addEventListener("click", handlers.onActionClick);
    }
    const search = root.querySelector("[data-wayfinder-search]");
    if (search) {
        search.addEventListener("input", handlers.onSearchInput);
    }
    const equipmentSearch = root.querySelector("[data-wayfinder-equipment-search]");
    if (equipmentSearch) {
        equipmentSearch.addEventListener("input", handlers.onEquipmentSearchInput);
    }
    for (const scrollable of root.querySelectorAll("[data-wayfinder-scroll-id]")) {
        const scrollId = scrollable.dataset.wayfinderScrollId;
        if (!scrollId) {
            continue;
        }
        const previousScrollTop = scrollById.get(scrollId);
        if (typeof previousScrollTop === "number") {
            scrollable.scrollTop = previousScrollTop;
        }
        scrollable.addEventListener("scroll", handlers.onScrollableScroll, { passive: true });
    }
    const manual = root.querySelector("[data-wayfinder-manual]");
    if (manual) {
        manual.addEventListener("change", handlers.onManualChange);
    }
    for (const loreInput of root.querySelectorAll("[data-wayfinder-training-lore]")) {
        loreInput.addEventListener("change", handlers.onLoreInputChange);
    }
    if (pendingSearchFocus) {
        const nextSearch = root.querySelector(`[data-wayfinder-search][data-step-id="${pendingSearchFocus.stepId}"], [data-wayfinder-equipment-search][data-step-id="${pendingSearchFocus.stepId}"]`);
        if (nextSearch) {
            nextSearch.focus();
            const caret = Math.min(pendingSearchFocus.cursor, nextSearch.value.length);
            nextSearch.setSelectionRange(caret, caret);
        }
    }
    return { pendingSearchFocus: null };
}
export function parseWayfinderAction(element) {
    const action = element?.dataset.wayfinderAction;
    if (!action) {
        return null;
    }
    switch (action) {
        case "select-step":
            return element.dataset.stepId
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    ...(element.dataset.focusId ? { focusId: element.dataset.focusId } : {}),
                }
                : null;
        case "previous-step":
        case "next-step":
        case "target-up":
        case "target-down":
        case "save-draft":
        case "retry-draft-save":
        case "apply-draft":
        case "import-existing-history":
        case "open-feedback":
        case "clear-draft":
            return { type: action };
        case "preview-option":
        case "select-option":
        case "toggle-language-choice":
        case "select-singleton-choice":
        case "select-class-archetype":
        case "select-class-choice":
        case "toggle-spell-choice":
            return element.dataset.stepId && element.dataset.value
                ? { type: action, stepId: element.dataset.stepId, value: element.dataset.value }
                : null;
        case "toggle-picker-filter-menu":
            return element.dataset.stepId && element.dataset.filterKind
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    filterKind: element.dataset.filterKind,
                }
                : null;
        case "toggle-picker-filter":
            return element.dataset.stepId && element.dataset.filterKind && element.dataset.value
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    filterKind: element.dataset.filterKind,
                    value: element.dataset.value,
                }
                : null;
        case "clear-picker-filters":
        case "toggle-spell-rarity-access":
        case "remove-spell-rarity-attestation":
        case "initialize-starting-equipment":
        case "clear-equipment-filters":
        case "review-equipment-purchases":
        case "retain-all-equipment":
        case "acknowledge-equipment-handoff":
            return element.dataset.stepId ? { type: action, stepId: element.dataset.stepId } : null;
        case "preview-equipment-item":
        case "add-equipment-item":
            return element.dataset.stepId && element.dataset.sourceUuid
                ? { type: action, stepId: element.dataset.stepId, sourceUuid: element.dataset.sourceUuid }
                : null;
        case "remove-equipment-line":
            return element.dataset.stepId && element.dataset.lineId
                ? { type: action, stepId: element.dataset.stepId, lineId: element.dataset.lineId }
                : null;
        case "change-equipment-quantity": {
            const delta = Number(element.dataset.delta);
            return element.dataset.stepId && element.dataset.lineId && (delta === -1 || delta === 1)
                ? { type: action, stepId: element.dataset.stepId, lineId: element.dataset.lineId, delta }
                : null;
        }
        case "toggle-equipment-filter":
            return element.dataset.stepId && element.dataset.filterKey && element.dataset.value
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    filterKey: element.dataset.filterKey,
                    value: element.dataset.value,
                }
                : null;
        case "toggle-ancestry-mode":
        case "toggle-voluntary-enabled":
        case "toggle-voluntary-legacy":
            return { type: action, stepId: element.dataset.stepId ?? null };
        case "toggle-boost-choice":
            return element.dataset.section && element.dataset.attribute && element.dataset.stepId
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    section: element.dataset.section,
                    attribute: element.dataset.attribute,
                }
                : null;
        case "toggle-voluntary-choice":
            return element.dataset.attribute && element.dataset.choiceKind && element.dataset.stepId
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    attribute: element.dataset.attribute,
                    choiceKind: element.dataset.choiceKind,
                }
                : null;
        case "select-skill-increase":
            return element.dataset.stepId && element.dataset.slug
                ? { type: action, stepId: element.dataset.stepId, slug: element.dataset.slug }
                : null;
        case "select-training-lore-suggestion":
            return element.dataset.stepId && element.dataset.key && element.dataset.value
                ? { type: action, stepId: element.dataset.stepId, key: element.dataset.key, value: element.dataset.value }
                : null;
        case "select-training-rule":
            return element.dataset.stepId && element.dataset.key && element.dataset.slug
                ? { type: action, stepId: element.dataset.stepId, key: element.dataset.key, slug: element.dataset.slug }
                : null;
        case "toggle-training-skill":
            return element.dataset.stepId && element.dataset.slug
                ? { type: action, stepId: element.dataset.stepId, slug: element.dataset.slug }
                : null;
        case "clear-option":
            return element.dataset.stepId ? { type: action, stepId: element.dataset.stepId } : null;
        default:
            return null;
    }
}
export function isDraftMutationAction(action) {
    switch (action.type) {
        case "select-option":
        case "toggle-ancestry-mode":
        case "toggle-voluntary-enabled":
        case "toggle-voluntary-legacy":
        case "toggle-boost-choice":
        case "toggle-voluntary-choice":
        case "select-skill-increase":
        case "select-training-rule":
        case "toggle-training-skill":
        case "select-training-lore-suggestion":
        case "toggle-language-choice":
        case "select-singleton-choice":
        case "select-class-archetype":
        case "select-class-choice":
        case "toggle-spell-choice":
        case "toggle-spell-rarity-access":
        case "remove-spell-rarity-attestation":
        case "initialize-starting-equipment":
        case "add-equipment-item":
        case "remove-equipment-line":
        case "change-equipment-quantity":
        case "review-equipment-purchases":
        case "retain-all-equipment":
        case "acknowledge-equipment-handoff":
        case "clear-option":
        case "target-up":
        case "target-down":
            return true;
        default:
            return false;
    }
}
//# sourceMappingURL=actions.js.map