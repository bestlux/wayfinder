import type { AbilityKey, PickerFilterKind, PickerFilterMenuKind } from "../types.js";

export type WayfinderAction =
  | { type: "select-step"; stepId: string; focusId?: string }
  | { type: "toggle-rail-level"; level: number; expanded: boolean }
  | { type: "previous-step" }
  | { type: "next-step" }
  | { type: "preview-option"; stepId: string; value: string }
  | { type: "select-option"; stepId: string; value: string }
  | { type: "toggle-picker-filter-menu"; stepId: string; filterKind: PickerFilterMenuKind }
  | { type: "toggle-picker-filter"; stepId: string; filterKind: PickerFilterKind; value: string }
  | { type: "set-picker-level-range"; stepId: string; minimum: number; maximum: number }
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
  | { type: "initialize-starting-equipment"; stepId: string; selectedRecipe?: "permanent-items" | "lump-sum" }
  | { type: "select-equipment-recipe"; stepId: string; selectedRecipe: "permanent-items" | "lump-sum" }
  | {
      type: "activate-equipment-policy";
      stepId: string;
      startKind: "new-campaign" | "replacement-character";
    }
  | {
      type: "request-equipment-start";
      stepId: string;
      startKind: "new-campaign" | "replacement-character";
    }
  | { type: "approve-equipment-policy-request"; stepId: string; requestId: string }
  | { type: "decline-equipment-policy-request"; stepId: string; requestId: string }
  | { type: "request-equipment-item-exception"; stepId: string; sourceUuid: string }
  | { type: "approve-equipment-item-exception"; stepId: string; sourceUuid: string }
  | { type: "revoke-equipment-policy-judgment"; stepId: string; judgmentId: string }
  | { type: "set-custom-equipment-lump-sum"; stepId: string }
  | { type: "grant-extra-equipment-allowance"; stepId: string }
  | { type: "preview-equipment-item"; stepId: string; sourceUuid: string }
  | {
      type: "add-equipment-item";
      stepId: string;
      sourceUuid: string;
      funding: "currency" | "allowance";
      allowanceId?: string;
    }
  | { type: "choose-titan-mauler-equipment"; stepId: string; sourceUuid: string }
  | { type: "remove-equipment-line"; stepId: string; lineId: string }
  | { type: "change-equipment-quantity"; stepId: string; lineId: string; delta: -1 | 1 }
  | { type: "toggle-equipment-filter"; stepId: string; filterKey: string; value: string }
  | { type: "toggle-equipment-filter-panel"; stepId: string; filterKey: "rarity" | "source" }
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
  | { type: "open-inventory" }
  | { type: "open-feedback" }
  | { type: "clear-draft" };

interface InteractionHandlers {
  onActionClick: (event: Event) => void | Promise<void>;
  onSearchInput: (event: Event) => void;
  onEquipmentSearchInput: (event: Event) => void;
  onEquipmentSourceSearchInput: (event: Event) => void;
  onEquipmentQuantityCommit: (event: Event) => void | Promise<void>;
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

  const equipmentSourceSearch = root.querySelector<HTMLInputElement>("[data-wayfinder-equipment-source-search]");
  if (equipmentSourceSearch) {
    equipmentSourceSearch.addEventListener("input", handlers.onEquipmentSourceSearchInput);
  }

  for (const input of root.querySelectorAll<HTMLInputElement>("[data-wayfinder-equipment-quantity]")) {
    input.dataset.wayfinderCommittedValue = input.value;
    const commit = (event: Event): void => {
      if (input.dataset.wayfinderCommittedValue === input.value) return;
      input.dataset.wayfinderCommittedValue = input.value;
      void handlers.onEquipmentQuantityCommit(event);
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  }

  const scrollables = [
    ...(root.matches("[data-wayfinder-scroll-id]") ? [root] : []),
    ...root.querySelectorAll<HTMLElement>("[data-wayfinder-scroll-id]"),
  ];
  for (const scrollable of scrollables) {
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

export function scrollActiveStepIntoView(root: HTMLElement, reduceMotion = prefersReducedMotion()): void {
  root.querySelector<HTMLElement>(".wizard-step-list .step-link.active")?.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "nearest",
    inline: "nearest",
  });
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
    case "toggle-rail-level": {
      const level = Number(element.dataset.level);
      const open = element.dataset.levelOpen;
      return Number.isInteger(level) && level >= 1 && (open === "true" || open === "false")
        ? { type: action, level, expanded: open !== "true" }
        : null;
    }
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
            filterKind: element.dataset.filterKind as PickerFilterMenuKind,
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
    case "decline-equipment-policy-request":
      return element.dataset.stepId && element.dataset.requestId
        ? { type: action, stepId: element.dataset.stepId, requestId: element.dataset.requestId }
        : null;
    case "request-equipment-item-exception":
    case "approve-equipment-item-exception":
      return element.dataset.stepId && element.dataset.sourceUuid
        ? { type: action, stepId: element.dataset.stepId, sourceUuid: element.dataset.sourceUuid }
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
      if (!element.dataset.stepId || !element.dataset.sourceUuid) return null;
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
    case "toggle-equipment-filter-panel":
      return element.dataset.stepId &&
        (element.dataset.filterKey === "rarity" || element.dataset.filterKey === "source")
        ? { type: action, stepId: element.dataset.stepId, filterKey: element.dataset.filterKey }
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
    case "select-equipment-recipe":
    case "activate-equipment-policy":
    case "request-equipment-start":
    case "approve-equipment-policy-request":
    case "decline-equipment-policy-request":
    case "request-equipment-item-exception":
    case "approve-equipment-item-exception":
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

function equipmentRecipe(value: string | undefined): "permanent-items" | "lump-sum" | null {
  return value === "permanent-items" || value === "lump-sum" ? value : null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
