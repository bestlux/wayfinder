import type { AbilityKey, PickerFilterKind } from "../types.js";

export type WayfinderAction =
  | { type: "select-step"; stepId: string; focusId?: string }
  | { type: "previous-step" }
  | { type: "next-step" }
  | { type: "preview-option"; stepId: string; value: string }
  | { type: "select-option"; stepId: string; value: string }
  | { type: "toggle-picker-filter-menu"; stepId: string; filterKind: PickerFilterKind }
  | { type: "toggle-picker-filter"; stepId: string; filterKind: PickerFilterKind; value: string }
  | { type: "clear-picker-filters"; stepId: string }
  | { type: "toggle-ancestry-mode"; stepId: string | null }
  | { type: "toggle-voluntary-enabled"; stepId: string | null }
  | { type: "toggle-voluntary-legacy"; stepId: string | null }
  | { type: "toggle-boost-choice"; stepId: string; section: string; attribute: AbilityKey }
  | {
      type: "toggle-voluntary-choice";
      stepId: string;
      attribute: AbilityKey;
      choiceKind: "flaw" | "second-flaw" | "boost";
    }
  | { type: "select-skill-increase"; stepId: string; slug: string }
  | { type: "select-training-rule"; stepId: string; key: string; slug: string }
  | { type: "toggle-training-skill"; stepId: string; slug: string }
  | { type: "select-training-lore-suggestion"; stepId: string; key: string; value: string }
  | { type: "toggle-language-choice"; stepId: string; value: string }
  | { type: "select-singleton-choice"; stepId: string; value: string }
  | { type: "select-class-archetype"; stepId: string; value: string }
  | { type: "select-class-choice"; stepId: string; value: string }
  | { type: "toggle-spell-choice"; stepId: string; value: string }
  | { type: "toggle-spell-rarity-access"; stepId: string }
  | { type: "remove-spell-rarity-attestation"; stepId: string }
  | { type: "initialize-starting-equipment"; stepId: string }
  | { type: "preview-equipment-item"; stepId: string; sourceUuid: string }
  | { type: "add-equipment-item"; stepId: string; sourceUuid: string }
  | { type: "remove-equipment-line"; stepId: string; lineId: string }
  | { type: "change-equipment-quantity"; stepId: string; lineId: string; delta: -1 | 1 }
  | { type: "toggle-equipment-filter"; stepId: string; filterKey: string; value: string }
  | { type: "clear-equipment-filters"; stepId: string }
  | { type: "review-equipment-purchases"; stepId: string }
  | { type: "retain-all-equipment"; stepId: string }
  | { type: "acknowledge-equipment-handoff"; stepId: string }
  | { type: "clear-option"; stepId: string }
  | { type: "target-up" }
  | { type: "target-down" }
  | { type: "save-draft" }
  | { type: "retry-draft-save" }
  | { type: "apply-draft" }
  | { type: "import-existing-history" }
  | { type: "open-feedback" }
  | { type: "clear-draft" };

interface InteractionHandlers {
  onActionClick: (event: Event) => void | Promise<void>;
  onSearchInput: (event: Event) => void;
  onEquipmentSearchInput: (event: Event) => void;
  onScrollableScroll: (event: Event) => void;
  onManualChange: (event: Event) => void | Promise<void>;
  onLoreInputChange: (event: Event) => void | Promise<void>;
}

export function bindWayfinderInteractions(
  root: HTMLElement,
  handlers: InteractionHandlers,
  scrollById: Map<string, number>,
  pendingSearchFocus: { stepId: string; cursor: number } | null
): { pendingSearchFocus: null } {
  for (const element of root.querySelectorAll<HTMLElement>("[data-wayfinder-action]")) {
    element.addEventListener("click", handlers.onActionClick);
  }

  const search = root.querySelector<HTMLInputElement>("[data-wayfinder-search]");
  if (search) {
    search.addEventListener("input", handlers.onSearchInput);
  }

  const equipmentSearch = root.querySelector<HTMLInputElement>("[data-wayfinder-equipment-search]");
  if (equipmentSearch) {
    equipmentSearch.addEventListener("input", handlers.onEquipmentSearchInput);
  }

  for (const scrollable of root.querySelectorAll<HTMLElement>("[data-wayfinder-scroll-id]")) {
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

  const manual = root.querySelector<HTMLInputElement>("[data-wayfinder-manual]");
  if (manual) {
    manual.addEventListener("change", handlers.onManualChange);
  }

  for (const loreInput of root.querySelectorAll<HTMLInputElement>("[data-wayfinder-training-lore]")) {
    loreInput.addEventListener("change", handlers.onLoreInputChange);
  }

  if (pendingSearchFocus) {
    const nextSearch = root.querySelector<HTMLInputElement>(
      `[data-wayfinder-search][data-step-id="${pendingSearchFocus.stepId}"], [data-wayfinder-equipment-search][data-step-id="${pendingSearchFocus.stepId}"]`
    );
    if (nextSearch) {
      nextSearch.focus();
      const caret = Math.min(pendingSearchFocus.cursor, nextSearch.value.length);
      nextSearch.setSelectionRange(caret, caret);
    }
  }

  return { pendingSearchFocus: null };
}

export function parseWayfinderAction(element: HTMLElement | null): WayfinderAction | null {
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
            filterKind: element.dataset.filterKind as PickerFilterKind,
          }
        : null;
    case "toggle-picker-filter":
      return element.dataset.stepId && element.dataset.filterKind && element.dataset.value
        ? {
            type: action,
            stepId: element.dataset.stepId,
            filterKind: element.dataset.filterKind as PickerFilterKind,
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
            attribute: element.dataset.attribute as AbilityKey,
          }
        : null;
    case "toggle-voluntary-choice":
      return element.dataset.attribute && element.dataset.choiceKind && element.dataset.stepId
        ? {
            type: action,
            stepId: element.dataset.stepId,
            attribute: element.dataset.attribute as AbilityKey,
            choiceKind: element.dataset.choiceKind as "flaw" | "second-flaw" | "boost",
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

export function isDraftMutationAction(action: WayfinderAction): boolean {
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
