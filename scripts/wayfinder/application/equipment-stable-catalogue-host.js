import { EquipmentStableCatalogue, } from "./equipment-stable-catalogue.js";
/**
 * Owns the durable catalogue host across scoped Foundry part replacements.
 *
 * Search, facet, and fallback-window renders replace only catalogue chrome. This
 * module retains the viewport, canvas, and controller while committing the next
 * projection through the controller's narrow interface. A full host replacement
 * is detected by DOM identity and disposes the obsolete controller exactly once.
 */
export class EquipmentStableCatalogueHost {
    #onPreview;
    #mounted = null;
    constructor(options = {}) {
        this.#onPreview = options.onPreview;
    }
    update(update) {
        const host = update.root.querySelector("[data-equipment-stable-host]");
        const viewport = host?.querySelector("[data-wayfinder-equipment-virtual-list]") ?? null;
        const canvas = viewport?.querySelector("[data-equipment-stable-canvas]") ?? null;
        if (!update.projection ||
            !host ||
            !viewport ||
            !canvas ||
            host.dataset.stepId !== update.projection.stepId ||
            viewport.dataset.stepId !== update.projection.stepId) {
            this.dispose();
            return false;
        }
        if (this.#mounted?.host !== host || this.#mounted.viewport !== viewport || this.#mounted.canvas !== canvas) {
            this.dispose();
            const controller = new EquipmentStableCatalogue({
                host,
                viewport,
                canvas,
                previousPageButton: host.querySelector("[data-equipment-stable-page='previous']"),
                nextPageButton: host.querySelector("[data-equipment-stable-page='next']"),
                onPreview: this.#onPreview,
            });
            this.#mounted = { host, viewport, canvas, controller };
        }
        this.#mounted.controller.setProjection(update.projection);
        if (update.restoreScrollTop !== undefined) {
            this.#mounted.controller.restoreScrollTop(update.restoreScrollTop);
        }
        return true;
    }
    dispose() {
        this.#mounted?.controller.dispose();
        this.#mounted = null;
    }
}
//# sourceMappingURL=equipment-stable-catalogue-host.js.map