import { STARTING_EQUIPMENT_STATUS_FOCUS_ID } from "./equipment-accessibility.js";

export class StartingEquipmentErrorFocusCoordinator {
  #activeErrorMessage: string | null = null;

  restore(
    root: HTMLElement,
    options: { readonly errorMessage: string | null; readonly pending: boolean }
  ): HTMLElement | null {
    const sameError = options.errorMessage !== null && options.errorMessage === this.#activeErrorMessage;
    this.#activeErrorMessage = options.errorMessage;
    if (options.errorMessage === null) return null;

    const alert = root.querySelector<HTMLElement>(
      `[data-wayfinder-focus-id="${STARTING_EQUIPMENT_STATUS_FOCUS_ID}"][role="alert"]`
    );
    if (!alert) return null;

    const document = root.ownerDocument;
    const active = document.activeElement;
    if (active === alert) return alert;
    const focusWasLost = active === null || active === document.body || !active.isConnected;
    if (!options.pending && (!sameError || !focusWasLost)) {
      return null;
    }

    try {
      alert.focus();
    } catch {
      return null;
    }
    return document.activeElement === alert ? alert : null;
  }
}
