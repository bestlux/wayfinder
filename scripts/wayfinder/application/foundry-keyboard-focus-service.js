const WAYFINDER_KEYBOARD_FOCUS_SELECTOR = "button, input, select, textarea, a[href], [tabindex]";
const WAYFINDER_APPLY_CONFIRMATION_SELECTOR = "[data-wayfinder-apply-confirmation]";
let wayfinderApplyConfirmationSequence = 0;
/**
 * Foundry reserves Tab for its canvas cycle-view keybinding unless the active
 * element explicitly declares keyboard focus. Mark Wayfinder's interactive
 * controls and programmatic focus anchors at the render boundary so native
 * browser traversal remains available on both full and partial renders.
 */
export function markWayfinderKeyboardFocus(root) {
    const controls = root.querySelectorAll(WAYFINDER_KEYBOARD_FOCUS_SELECTOR);
    for (const control of controls)
        control.dataset.keyboardFocus = "true";
    return controls.length;
}
export function createWayfinderApplyConfirmationMarker() {
    wayfinderApplyConfirmationSequence += 1;
    return `wayfinder-apply-${wayfinderApplyConfirmationSequence}`;
}
/**
 * Scope Foundry's keyboard-focus opt-in to Wayfinder's Apply confirmation.
 * The destructive action remains non-default; initial focus goes to Cancel.
 */
export function prepareWayfinderApplyConfirmationFocus(application, html, marker) {
    const root = keyboardFocusRoot(html) ?? keyboardFocusRoot(recordElement(application));
    if (!root || !containsWayfinderApplyConfirmation(root, marker))
        return false;
    const safeDefault = root.querySelector('button[data-action="no"]');
    const apply = root.querySelector('button[data-action="yes"]');
    if (!safeDefault || !apply)
        return false;
    markWayfinderKeyboardFocus(root);
    try {
        safeDefault.focus({ preventScroll: true });
    }
    catch {
        // The controls remain opted into native Tab traversal even if Foundry removed
        // the button during this render turn.
        return false;
    }
    return safeDefault.ownerDocument.activeElement === safeDefault;
}
export async function withWayfinderApplyConfirmationFocus(hooks, marker, openDialog) {
    if (!hooks)
        return openDialog();
    let hookId = null;
    const cleanup = () => {
        if (hookId === null)
            return;
        const activeHookId = hookId;
        hookId = null;
        hooks.off("renderDialogV2", activeHookId);
    };
    hookId = hooks.on("renderDialogV2", (application, html) => {
        if (!prepareWayfinderApplyConfirmationFocus(application, html, marker))
            return;
        cleanup();
    });
    try {
        return await openDialog();
    }
    finally {
        cleanup();
    }
}
function containsWayfinderApplyConfirmation(root, marker) {
    const candidates = [
        ...(isElement(root) && root.matches(WAYFINDER_APPLY_CONFIRMATION_SELECTOR) ? [root] : []),
        ...root.querySelectorAll(WAYFINDER_APPLY_CONFIRMATION_SELECTOR),
    ];
    return candidates.some((candidate) => candidate.getAttribute("data-wayfinder-apply-confirmation") === marker);
}
function keyboardFocusRoot(value) {
    if (isParentNode(value))
        return value;
    if (value && typeof value === "object" && isParentNode(value[0])) {
        return value[0];
    }
    return null;
}
function recordElement(value) {
    return value && typeof value === "object" ? value.element : null;
}
function isParentNode(value) {
    return Boolean(value && typeof value === "object" && "querySelector" in value && "querySelectorAll" in value);
}
function isElement(value) {
    return "matches" in value && typeof value.matches === "function";
}
//# sourceMappingURL=foundry-keyboard-focus-service.js.map