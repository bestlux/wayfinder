const WAYFINDER_KEYBOARD_FOCUS_SELECTOR = "button, input, select, textarea, a[href], [tabindex]";
const WAYFINDER_APPLY_CONFIRMATION_SELECTOR = "[data-wayfinder-apply-confirmation]";
let wayfinderApplyConfirmationSequence = 0;

export interface FoundryDialogHooksLike {
  on(event: "renderDialogV2", callback: (application: unknown, html: unknown) => void): number;
  off(event: "renderDialogV2", hookId: number): void;
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

export function createWayfinderApplyConfirmationMarker(): string {
  wayfinderApplyConfirmationSequence += 1;
  return `wayfinder-apply-${wayfinderApplyConfirmationSequence}`;
}

/**
 * Scope Foundry's keyboard-focus opt-in to Wayfinder's Apply confirmation.
 * The destructive action remains non-default; initial focus goes to Cancel.
 */
export function prepareWayfinderApplyConfirmationFocus(application: unknown, html: unknown, marker: string): boolean {
  const root = keyboardFocusRoot(html) ?? keyboardFocusRoot(recordElement(application));
  if (!root || !containsWayfinderApplyConfirmation(root, marker)) return false;
  const safeDefault = root.querySelector<HTMLElement>('button[data-action="no"]');
  const apply = root.querySelector<HTMLElement>('button[data-action="yes"]');
  if (!safeDefault || !apply) return false;
  markWayfinderKeyboardFocus(root);
  try {
    safeDefault.focus({ preventScroll: true });
  } catch {
    // The controls remain opted into native Tab traversal even if Foundry removed
    // the button during this render turn.
    return false;
  }
  return safeDefault.ownerDocument.activeElement === safeDefault;
}

export async function withWayfinderApplyConfirmationFocus<T>(
  hooks: FoundryDialogHooksLike | null | undefined,
  marker: string,
  openDialog: () => Promise<T>
): Promise<T> {
  if (!hooks) return openDialog();
  let hookId: number | null = null;
  const cleanup = (): void => {
    if (hookId === null) return;
    const activeHookId = hookId;
    hookId = null;
    hooks.off("renderDialogV2", activeHookId);
  };
  hookId = hooks.on("renderDialogV2", (application, html) => {
    if (!prepareWayfinderApplyConfirmationFocus(application, html, marker)) return;
    cleanup();
  });
  try {
    return await openDialog();
  } finally {
    cleanup();
  }
}

function containsWayfinderApplyConfirmation(root: ParentNode, marker: string): boolean {
  const candidates = [
    ...(isElement(root) && root.matches(WAYFINDER_APPLY_CONFIRMATION_SELECTOR) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(WAYFINDER_APPLY_CONFIRMATION_SELECTOR),
  ];
  return candidates.some((candidate) => candidate.getAttribute("data-wayfinder-apply-confirmation") === marker);
}

function keyboardFocusRoot(value: unknown): ParentNode | null {
  if (isParentNode(value)) return value;
  if (value && typeof value === "object" && isParentNode((value as { 0?: unknown })[0])) {
    return (value as { 0: ParentNode })[0];
  }
  return null;
}

function recordElement(value: unknown): unknown {
  return value && typeof value === "object" ? (value as { element?: unknown }).element : null;
}

function isParentNode(value: unknown): value is ParentNode {
  return Boolean(value && typeof value === "object" && "querySelector" in value && "querySelectorAll" in value);
}

function isElement(value: ParentNode): value is Element {
  return "matches" in value && typeof value.matches === "function";
}
