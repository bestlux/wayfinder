import type { AbilityKey } from "../types.js";

export type WayfinderAction =
  | { type: "select-step"; stepId: string }
  | { type: "previous-step" }
  | { type: "next-step" }
  | { type: "preview-option"; stepId: string; value: string }
  | { type: "select-option"; stepId: string; value: string }
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
  | { type: "select-training-rule"; stepId: string; flag: string; slug: string }
  | { type: "toggle-training-skill"; stepId: string; slug: string }
  | { type: "select-singleton-choice"; stepId: string; value: string }
  | { type: "select-class-choice"; stepId: string; value: string }
  | { type: "toggle-spell-choice"; stepId: string; value: string }
  | { type: "clear-option"; stepId: string }
  | { type: "target-up" }
  | { type: "target-down" }
  | { type: "save-draft" }
  | { type: "apply-draft" }
  | { type: "clear-draft" };

interface InteractionHandlers {
  onActionClick: (event: Event) => void | Promise<void>;
  onSearchInput: (event: Event) => void;
  onScrollableScroll: (event: Event) => void;
  onManualChange: (event: Event) => void;
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

  if (pendingSearchFocus) {
    const nextSearch = root.querySelector<HTMLInputElement>(
      `[data-wayfinder-search][data-step-id="${pendingSearchFocus.stepId}"]`
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
      return element.dataset.stepId ? { type: action, stepId: element.dataset.stepId } : null;
    case "previous-step":
    case "next-step":
    case "target-up":
    case "target-down":
    case "save-draft":
    case "apply-draft":
    case "clear-draft":
      return { type: action };
    case "preview-option":
    case "select-option":
    case "select-singleton-choice":
    case "select-class-choice":
    case "toggle-spell-choice":
      return element.dataset.stepId && element.dataset.value
        ? { type: action, stepId: element.dataset.stepId, value: element.dataset.value }
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
    case "select-training-rule":
      return element.dataset.stepId && element.dataset.flag && element.dataset.slug
        ? { type: action, stepId: element.dataset.stepId, flag: element.dataset.flag, slug: element.dataset.slug }
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
