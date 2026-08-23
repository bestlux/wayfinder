import {
  EquipmentStableCatalogue,
  type EquipmentStableCatalogueOptions,
  type EquipmentStableCatalogueProjection,
} from "./equipment-stable-catalogue.js";

export interface EquipmentStableCatalogueHostOptions {
  readonly onPreview?: EquipmentStableCatalogueOptions["onPreview"];
}

export interface EquipmentStableCatalogueHostUpdate {
  readonly root: HTMLElement;
  readonly projection: EquipmentStableCatalogueProjection | null;
  readonly restoreScrollTop?: number;
}

interface MountedEquipmentStableCatalogue {
  readonly host: HTMLElement;
  readonly viewport: HTMLElement;
  readonly canvas: HTMLElement;
  readonly controller: EquipmentStableCatalogue;
}

/**
 * Owns the durable catalogue host across scoped Foundry part replacements.
 *
 * Search, facet, and fallback-window renders replace only catalogue chrome. This
 * module retains the viewport, canvas, and controller while committing the next
 * projection through the controller's narrow interface. A full host replacement
 * is detected by DOM identity and disposes the obsolete controller exactly once.
 */
export class EquipmentStableCatalogueHost {
  readonly #onPreview: EquipmentStableCatalogueHostOptions["onPreview"];
  #mounted: MountedEquipmentStableCatalogue | null = null;

  constructor(options: EquipmentStableCatalogueHostOptions = {}) {
    this.#onPreview = options.onPreview;
  }

  update(update: EquipmentStableCatalogueHostUpdate): boolean {
    const host = update.root.querySelector<HTMLElement>("[data-equipment-stable-host]");
    const viewport = host?.querySelector<HTMLElement>("[data-wayfinder-equipment-virtual-list]") ?? null;
    const canvas = viewport?.querySelector<HTMLElement>("[data-equipment-stable-canvas]") ?? null;
    if (
      !update.projection ||
      !host ||
      !viewport ||
      !canvas ||
      host.dataset.stepId !== update.projection.stepId ||
      viewport.dataset.stepId !== update.projection.stepId
    ) {
      this.dispose();
      return false;
    }

    if (this.#mounted?.host !== host || this.#mounted.viewport !== viewport || this.#mounted.canvas !== canvas) {
      this.dispose();
      const controller = new EquipmentStableCatalogue({
        host,
        viewport,
        canvas,
        previousPageButton: host.querySelector<HTMLButtonElement>("[data-equipment-stable-page='previous']"),
        nextPageButton: host.querySelector<HTMLButtonElement>("[data-equipment-stable-page='next']"),
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

  dispose(): void {
    this.#mounted?.controller.dispose();
    this.#mounted = null;
  }
}
