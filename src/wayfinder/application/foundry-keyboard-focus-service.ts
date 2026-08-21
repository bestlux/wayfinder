const WAYFINDER_KEYBOARD_FOCUS_SELECTOR = "button, input, select, textarea, a[href], [tabindex]";
const WAYFINDER_APPLY_CONFIRMATION_SELECTOR = "[data-wayfinder-apply-confirmation]";
const WAYFINDER_APPLY_FOCUS_ATTEMPTS = 2;
let wayfinderApplyConfirmationSequence = 0;

export interface WayfinderApplyConfirmationFocusHandoff {
  readonly marker: string;
  cancel(): void;
  onRender(application: unknown): void;
}

interface ScheduledAnimationFrame {
  readonly cancel: (handle: number) => void;
  readonly handle: number;
}

/**
 * Foundry reserves Tab for its canvas cycle-view keybinding unless the active
 * element explicitly declares keyboard focus. Mark Wayfinder's interactive
 * controls and programmatic focus anchors at the render boundary so native
 * browser traversal remains available on both full and partial renders.
 */
export function markWayfinderKeyboardFocus(root: ParentNode): number {
  const controls = root.querySelectorAll<HTMLElement>(WAYFINDER_KEYBOARD_FOCUS_SELECTOR);
  for (const control of controls) control.dataset.keyboardFocus = "true";
  return controls.length;
}

/**
 * DialogV2 dispatches its render callback before ApplicationV2's final
 * autofocus and late bringToFront window focus. Defer the safe focus handoff
 * to an animation frame so it survives both later lifecycle steps.
 */
export function createWayfinderApplyConfirmationFocusHandoff(): WayfinderApplyConfirmationFocusHandoff {
  wayfinderApplyConfirmationSequence += 1;
  const marker = `wayfinder-apply-${wayfinderApplyConfirmationSequence}`;
  let application: unknown = null;
  let canceled = false;
  let scheduled: ScheduledAnimationFrame | null = null;

  const cancelScheduled = (): void => {
    if (!scheduled) return;
    scheduled.cancel(scheduled.handle);
    scheduled = null;
  };
  const cancel = (): void => {
    canceled = true;
    cancelScheduled();
    application = null;
  };
  const scheduleFocus = (attempt: number): void => {
    if (canceled) return;
    const root = keyboardFocusRoot(recordElement(application));
    const view = root?.ownerDocument?.defaultView;
    if (!root || !view || !prepareWayfinderApplyConfirmationControls(root, marker)) return;
    cancelScheduled();
    const handle = view.requestAnimationFrame(() => {
      scheduled = null;
      if (canceled) return;
      const currentRoot = keyboardFocusRoot(recordElement(application));
      const safeDefault = currentRoot && prepareWayfinderApplyConfirmationControls(currentRoot, marker);
      if (!safeDefault) return;
      try {
        safeDefault.focus({ preventScroll: true });
      } catch {
        // A replaced control can throw for this frame. Retry once against the
        // current dialog element, then rely on dialog settlement cleanup.
      }
      if (safeDefault.ownerDocument.activeElement !== safeDefault && attempt + 1 < WAYFINDER_APPLY_FOCUS_ATTEMPTS) {
        scheduleFocus(attempt + 1);
      }
    });
    scheduled = { cancel: view.cancelAnimationFrame.bind(view), handle };
  };

  return {
    marker,
    cancel,
    onRender(renderedApplication: unknown): void {
      if (canceled) return;
      application = renderedApplication;
      scheduleFocus(0);
    },
  };
}

function prepareWayfinderApplyConfirmationControls(root: ParentNode, marker: string): HTMLElement | null {
  if (!containsWayfinderApplyConfirmation(root, marker)) return null;
  const safeDefault = root.querySelector<HTMLElement>('button[data-action="no"]');
  const apply = root.querySelector<HTMLElement>('button[data-action="yes"]');
  if (!safeDefault || !apply) return null;
  markWayfinderKeyboardFocus(root);
  return safeDefault;
}

function containsWayfinderApplyConfirmation(root: ParentNode, marker: string): boolean {
  const candidates = [
    ...(isElement(root) && root.matches(WAYFINDER_APPLY_CONFIRMATION_SELECTOR) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(WAYFINDER_APPLY_CONFIRMATION_SELECTOR),
  ];
  return candidates.some((candidate) => candidate.getAttribute("data-wayfinder-apply-confirmation") === marker);
}

function keyboardFocusRoot(value: unknown): (ParentNode & { readonly ownerDocument?: Document }) | null {
  return isParentNode(value) ? value : null;
}

function recordElement(value: unknown): unknown {
  return value && typeof value === "object" ? (value as { element?: unknown }).element : null;
}

function isParentNode(value: unknown): value is ParentNode & { readonly ownerDocument?: Document } {
  return Boolean(value && typeof value === "object" && "querySelector" in value && "querySelectorAll" in value);
}

function isElement(value: ParentNode): value is Element {
  return "matches" in value && typeof value.matches === "function";
}
