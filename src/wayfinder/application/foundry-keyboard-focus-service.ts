const WAYFINDER_KEYBOARD_FOCUS_SELECTOR = "button, input, select, textarea, a[href], [tabindex]";

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
