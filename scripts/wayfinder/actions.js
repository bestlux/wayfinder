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
        case "open-inventory":
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
        case "set-picker-level-range": {
            const minimum = Number(element.dataset.minimum);
            const maximum = Number(element.dataset.maximum);
            return element.dataset.stepId && Number.isInteger(minimum) && Number.isInteger(maximum) && minimum <= maximum
                ? { type: action, stepId: element.dataset.stepId, minimum, maximum }
                : null;
        }
        case "clear-picker-filters":
        case "toggle-spell-rarity-access":
        case "remove-spell-rarity-attestation":
        case "clear-equipment-filters":
        case "set-custom-equipment-lump-sum":
        case "grant-extra-equipment-allowance":
        case "review-equipment-purchases":
        case "retain-all-equipment":
        case "acknowledge-equipment-handoff":
            return element.dataset.stepId ? { type: action, stepId: element.dataset.stepId } : null;
        case "initialize-starting-equipment": {
            const selectedRecipe = equipmentRecipe(element.dataset.recipe);
            return element.dataset.stepId
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    ...(selectedRecipe ? { selectedRecipe } : {}),
                }
                : null;
        }
        case "select-equipment-recipe": {
            const selectedRecipe = equipmentRecipe(element.dataset.recipe);
            return element.dataset.stepId && selectedRecipe
                ? { type: action, stepId: element.dataset.stepId, selectedRecipe }
                : null;
        }
        case "activate-equipment-policy": {
            const startKind = element.dataset.startKind;
            return element.dataset.stepId && (startKind === "new-campaign" || startKind === "replacement-character")
                ? { type: action, stepId: element.dataset.stepId, startKind }
                : null;
        }
        case "request-equipment-start": {
            const startKind = element.dataset.startKind;
            return element.dataset.stepId && (startKind === "new-campaign" || startKind === "replacement-character")
                ? { type: action, stepId: element.dataset.stepId, startKind }
                : null;
        }
        case "approve-equipment-policy-request":
            return element.dataset.stepId && element.dataset.requestId
                ? { type: action, stepId: element.dataset.stepId, requestId: element.dataset.requestId }
                : null;
        case "revoke-equipment-policy-judgment":
            return element.dataset.stepId && element.dataset.judgmentId
                ? { type: action, stepId: element.dataset.stepId, judgmentId: element.dataset.judgmentId }
                : null;
        case "preview-equipment-item":
        case "choose-titan-mauler-equipment":
            return element.dataset.stepId && element.dataset.sourceUuid
                ? { type: action, stepId: element.dataset.stepId, sourceUuid: element.dataset.sourceUuid }
                : null;
        case "add-equipment-item": {
            const funding = element.dataset.funding;
            if (!element.dataset.stepId || !element.dataset.sourceUuid)
                return null;
            if (funding === undefined || funding === "currency") {
                return {
                    type: action,
                    stepId: element.dataset.stepId,
                    sourceUuid: element.dataset.sourceUuid,
                    funding: "currency",
                };
            }
            return funding === "allowance" && element.dataset.allowanceId
                ? {
                    type: action,
                    stepId: element.dataset.stepId,
                    sourceUuid: element.dataset.sourceUuid,
                    funding,
                    allowanceId: element.dataset.allowanceId,
                }
                : null;
        }
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
        case "select-equipment-recipe":
        case "activate-equipment-policy":
        case "request-equipment-start":
        case "approve-equipment-policy-request":
        case "revoke-equipment-policy-judgment":
        case "set-custom-equipment-lump-sum":
        case "grant-extra-equipment-allowance":
        case "add-equipment-item":
        case "choose-titan-mauler-equipment":
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
function equipmentRecipe(value) {
    return value === "permanent-items" || value === "lump-sum" ? value : null;
}
//# sourceMappingURL=actions.js.map