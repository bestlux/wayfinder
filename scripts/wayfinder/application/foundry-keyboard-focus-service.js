const WAYFINDER_KEYBOARD_FOCUS_SELECTOR = "button, input, select, textarea, a[href], [tabindex]";
const WAYFINDER_APPLY_CONFIRMATION_SELECTOR = "[data-wayfinder-apply-confirmation]";
const WAYFINDER_APPLY_FOCUS_ATTEMPTS = 2;
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
/**
 * DialogV2 dispatches its render callback before ApplicationV2's final
 * autofocus and late bringToFront window focus. Defer the safe focus handoff
 * to an animation frame so it survives both later lifecycle steps.
 */
export function createWayfinderApplyConfirmationFocusHandoff() {
    wayfinderApplyConfirmationSequence += 1;
    const marker = `wayfinder-apply-${wayfinderApplyConfirmationSequence}`;
    let application = null;
    let canceled = false;
    let scheduled = null;
    const cancelScheduled = () => {
        if (!scheduled)
            return;
        scheduled.cancel(scheduled.handle);
        scheduled = null;
    };
    const cancel = () => {
        canceled = true;
        cancelScheduled();
        application = null;
    };
    const scheduleFocus = (attempt) => {
        if (canceled)
            return;
        const root = keyboardFocusRoot(recordElement(application));
        const view = root?.ownerDocument?.defaultView;
        if (!root || !view || !prepareWayfinderApplyConfirmationControls(root, marker))
            return;
        cancelScheduled();
        const handle = view.requestAnimationFrame(() => {
            scheduled = null;
            if (canceled)
                return;
            const currentRoot = keyboardFocusRoot(recordElement(application));
            const safeDefault = currentRoot && prepareWayfinderApplyConfirmationControls(currentRoot, marker);
            if (!safeDefault)
                return;
            try {
                safeDefault.focus({ preventScroll: true });
            }
            catch {
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
        onRender(renderedApplication) {
            if (canceled)
                return;
            application = renderedApplication;
            scheduleFocus(0);
        },
    };
}
function prepareWayfinderApplyConfirmationControls(root, marker) {
    if (!containsWayfinderApplyConfirmation(root, marker))
        return null;
    const safeDefault = root.querySelector('button[data-action="no"]');
    const apply = root.querySelector('button[data-action="yes"]');
    if (!safeDefault || !apply)
        return null;
    markWayfinderKeyboardFocus(root);
    return safeDefault;
}
function containsWayfinderApplyConfirmation(root, marker) {
    const candidates = [
        ...(isElement(root) && root.matches(WAYFINDER_APPLY_CONFIRMATION_SELECTOR) ? [root] : []),
        ...root.querySelectorAll(WAYFINDER_APPLY_CONFIRMATION_SELECTOR),
    ];
    return candidates.some((candidate) => candidate.getAttribute("data-wayfinder-apply-confirmation") === marker);
}
function keyboardFocusRoot(value) {
    return isParentNode(value) ? value : null;
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