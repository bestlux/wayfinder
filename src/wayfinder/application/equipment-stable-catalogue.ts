export interface EquipmentStableCatalogueRow {
  readonly sourceUuid: string;
  readonly name: string;
  readonly previewAriaLabel: string;
  readonly levelLabel: string;
  readonly rarity: string;
  readonly rarityLabel: string;
  readonly itemTypeLabel: string;
  readonly sourceLabel: string;
  readonly unavailableReason: string | null;
  readonly priceLabel: string;
  readonly canAdd: boolean;
  readonly previewing: boolean;
}

export interface EquipmentStableCatalogueProjection {
  readonly key: string;
  readonly rows: readonly EquipmentStableCatalogueRow[];
}

export interface EquipmentStableCatalogueOptions {
  readonly viewport: HTMLElement;
  readonly canvas: HTMLElement;
  readonly rowHeightPx?: number;
  readonly rowsBehind?: number;
  readonly rowsAhead?: number;
}

interface EquipmentStableCatalogueRange {
  readonly start: number;
  readonly end: number;
}

interface MountedEquipmentRow {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly level: HTMLElement;
  readonly rarity: HTMLElement;
  readonly meta: HTMLElement;
  readonly price: HTMLElement;
  row: EquipmentStableCatalogueRow;
  index: number;
}

const DEFAULT_ROW_HEIGHT_PX = 48;
const DEFAULT_ROWS_BEHIND = 12;
const DEFAULT_ROWS_AHEAD = 24;

/**
 * A fixed-height catalogue renderer whose viewport and canvas survive scroll changes.
 *
 * Rows are mounted directly from a complete lightweight projection. The controller
 * never asks Foundry to render, hydrate, prepare, or price an item. Transaction and
 * exact-price authority remain outside this browse-only boundary.
 */
export class EquipmentStableCatalogue {
  readonly #viewport: HTMLElement;
  readonly #canvas: HTMLElement;
  readonly #rowHeightPx: number;
  readonly #rowsBehind: number;
  readonly #rowsAhead: number;
  readonly #resizeObserver: ResizeObserver | null;
  readonly #mountedBySourceUuid = new Map<string, MountedEquipmentRow>();
  #projection: EquipmentStableCatalogueProjection | null = null;
  #indexBySourceUuid = new Map<string, number>();
  #mountedRange: EquipmentStableCatalogueRange = { start: 0, end: 0 };
  #lastScrollTop = 0;
  #direction: -1 | 0 | 1 = 0;
  #frame: number | null = null;
  #disposed = false;

  constructor(options: EquipmentStableCatalogueOptions) {
    this.#viewport = options.viewport;
    this.#canvas = options.canvas;
    this.#rowHeightPx = positiveInteger(options.rowHeightPx, DEFAULT_ROW_HEIGHT_PX);
    this.#rowsBehind = nonNegativeInteger(options.rowsBehind, DEFAULT_ROWS_BEHIND);
    this.#rowsAhead = nonNegativeInteger(options.rowsAhead, DEFAULT_ROWS_AHEAD);

    this.#viewport.classList.add("is-stable-catalogue");
    this.#viewport.addEventListener("scroll", this.#onScroll, { passive: true });
    this.#viewport.addEventListener("focusout", this.#onFocusOut);
    const ResizeObserverConstructor = this.#viewport.ownerDocument.defaultView?.ResizeObserver;
    this.#resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(this.#onResize) : null;
    this.#resizeObserver?.observe(this.#viewport);
  }

  setProjection(projection: EquipmentStableCatalogueProjection): void {
    this.#assertActive();
    const indexBySourceUuid = new Map<string, number>();
    projection.rows.forEach((row, index) => {
      if (!row.sourceUuid || indexBySourceUuid.has(row.sourceUuid)) {
        throw new TypeError("Stable equipment catalogue rows require unique source UUIDs.");
      }
      indexBySourceUuid.set(row.sourceUuid, index);
    });

    const focusedSourceUuid = this.#focusedSourceUuid();
    this.#projection = projection;
    this.#indexBySourceUuid = indexBySourceUuid;
    this.#canvas.style.height = `${projection.rows.length * this.#rowHeightPx}px`;
    this.#viewport.dataset.totalResults = String(projection.rows.length);
    this.#viewport.dataset.projectionKey = projection.key;

    if (focusedSourceUuid && !indexBySourceUuid.has(focusedSourceUuid)) {
      this.#viewport.focus({ preventScroll: true });
    }

    const maximumScrollTop = Math.max(0, projection.rows.length * this.#rowHeightPx - this.#viewport.clientHeight);
    if (this.#viewport.scrollTop > maximumScrollTop) this.#viewport.scrollTop = maximumScrollTop;
    this.#lastScrollTop = this.#viewport.scrollTop;
    this.#mountedRange = { start: 0, end: 0 };
    this.#bindRange(this.#emergencyRange(this.#visibleRange()));
    this.#scheduleFrame();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#viewport.removeEventListener("scroll", this.#onScroll);
    this.#viewport.removeEventListener("focusout", this.#onFocusOut);
    this.#resizeObserver?.disconnect();
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#mountedBySourceUuid.clear();
    this.#canvas.replaceChildren();
  }

  #onScroll = (): void => {
    if (!this.#projection || this.#disposed) return;
    const currentScrollTop = this.#viewport.scrollTop;
    this.#direction = currentScrollTop === this.#lastScrollTop ? 0 : currentScrollTop > this.#lastScrollTop ? 1 : -1;
    this.#lastScrollTop = currentScrollTop;
    const visible = this.#visibleRange();
    if (!containsRange(this.#mountedRange, visible)) {
      // Large jumps get real browse rows synchronously; no frame or async work gates coverage.
      this.#bindRange(this.#emergencyRange(visible));
    }
    this.#scheduleFrame();
  };

  #onFocusOut = (): void => {
    requestAnimationFrame(() => {
      const active = this.#viewport.ownerDocument.activeElement;
      if (this.#disposed || (active !== this.#viewport && this.#viewport.contains(active))) return;
      this.#bindRange(this.#overscanRange(this.#visibleRange()));
    });
  };

  #onResize = (): void => {
    if (!this.#projection || this.#disposed) return;
    const visible = this.#visibleRange();
    if (!containsRange(this.#mountedRange, visible)) this.#bindRange(this.#emergencyRange(visible));
    this.#scheduleFrame();
  };

  #scheduleFrame(): void {
    if (this.#frame !== null || this.#disposed) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      if (!this.#projection || this.#disposed) return;
      this.#bindRange(this.#overscanRange(this.#visibleRange()));
    });
  }

  #visibleRange(): EquipmentStableCatalogueRange {
    const total = this.#projection?.rows.length ?? 0;
    if (total === 0) return { start: 0, end: 0 };
    const start = clamp(Math.floor(this.#viewport.scrollTop / this.#rowHeightPx), 0, total - 1);
    const visibleCount = Math.max(1, Math.ceil(this.#viewport.clientHeight / this.#rowHeightPx) + 1);
    return { start, end: Math.min(total, start + visibleCount) };
  }

  #emergencyRange(visible: EquipmentStableCatalogueRange): EquipmentStableCatalogueRange {
    const total = this.#projection?.rows.length ?? 0;
    return {
      start: Math.max(0, visible.start - 1),
      end: Math.min(total, visible.end + 1),
    };
  }

  #overscanRange(visible: EquipmentStableCatalogueRange): EquipmentStableCatalogueRange {
    const total = this.#projection?.rows.length ?? 0;
    const before = this.#direction < 0 ? this.#rowsAhead : this.#rowsBehind;
    const after = this.#direction < 0 ? this.#rowsBehind : this.#rowsAhead;
    return {
      start: Math.max(0, visible.start - before),
      end: Math.min(total, visible.end + after),
    };
  }

  #bindRange(range: EquipmentStableCatalogueRange): void {
    const projection = this.#projection;
    if (!projection) return;
    const focusedSourceUuid = this.#focusedSourceUuid();
    const wanted = new Set<string>();
    const mounted: MountedEquipmentRow[] = [];

    for (let index = range.start; index < range.end; index += 1) {
      const row = projection.rows[index];
      if (!row) continue;
      wanted.add(row.sourceUuid);
      mounted.push(this.#mountOrPatch(row, index, projection.rows.length));
    }

    if (focusedSourceUuid && !wanted.has(focusedSourceUuid)) {
      const focusedIndex = this.#indexBySourceUuid.get(focusedSourceUuid);
      const focusedRow = focusedIndex === undefined ? undefined : projection.rows[focusedIndex];
      if (focusedRow && focusedIndex !== undefined) {
        wanted.add(focusedSourceUuid);
        mounted.push(this.#mountOrPatch(focusedRow, focusedIndex, projection.rows.length));
      }
    }

    for (const [sourceUuid, row] of this.#mountedBySourceUuid) {
      if (wanted.has(sourceUuid)) continue;
      row.root.remove();
      this.#mountedBySourceUuid.delete(sourceUuid);
    }

    mounted.sort((left, right) => left.index - right.index);
    let cursor = this.#canvas.firstChild;
    for (const row of mounted) {
      if (row.root === cursor) {
        cursor = cursor.nextSibling;
        continue;
      }
      this.#canvas.insertBefore(row.root, cursor);
    }
    this.#mountedRange = range;
  }

  #mountOrPatch(row: EquipmentStableCatalogueRow, index: number, total: number): MountedEquipmentRow {
    let mounted = this.#mountedBySourceUuid.get(row.sourceUuid);
    if (!mounted) {
      mounted = createMountedRow(this.#canvas.ownerDocument, row, index);
      this.#mountedBySourceUuid.set(row.sourceUuid, mounted);
    }
    if (mounted.row !== row) patchMountedRow(mounted, row);
    mounted.index = index;
    mounted.root.dataset.resultIndex = String(index);
    mounted.root.setAttribute("aria-posinset", String(index + 1));
    mounted.root.setAttribute("aria-setsize", String(total));
    mounted.root.style.transform = `translateY(${index * this.#rowHeightPx}px)`;
    mounted.root.style.height = `${this.#rowHeightPx}px`;
    return mounted;
  }

  #focusedSourceUuid(): string | null {
    const active = this.#viewport.ownerDocument.activeElement;
    const HTMLElementConstructor = this.#viewport.ownerDocument.defaultView?.HTMLElement;
    if (!HTMLElementConstructor || !(active instanceof HTMLElementConstructor) || !this.#viewport.contains(active)) {
      return null;
    }
    return active.closest<HTMLElement>("[data-source-uuid]")?.dataset.sourceUuid ?? null;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Cannot update a disposed stable equipment catalogue.");
  }
}

function createMountedRow(document: Document, row: EquipmentStableCatalogueRow, index: number): MountedEquipmentRow {
  const root = document.createElement("article");
  root.className = "equipment-result-row equipment-stable-result-row";
  root.setAttribute("role", "listitem");
  root.dataset.sourceUuid = row.sourceUuid;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "equipment-result";
  button.dataset.equipmentItem = "";
  button.dataset.sourceUuid = row.sourceUuid;
  button.dataset.wayfinderAction = "preview-equipment-item";

  const art = document.createElement("span");
  art.className = "equipment-result-art";
  art.setAttribute("aria-hidden", "true");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-box";
  art.append(icon);

  const copy = document.createElement("span");
  copy.className = "equipment-result-copy";
  const title = document.createElement("span");
  title.className = "equipment-result-title";
  const name = document.createElement("span");
  name.className = "equipment-result-name";
  const level = document.createElement("span");
  level.className = "tag equipment-result-level";
  const rarity = document.createElement("span");
  title.append(name, level, rarity);
  const meta = document.createElement("span");
  meta.className = "equipment-result-meta";
  copy.append(title, meta);

  const price = document.createElement("span");
  price.className = "equipment-result-price";
  button.append(art, copy, price);
  root.append(button);

  const mounted = { root, button, name, level, rarity, meta, price, row, index };
  patchMountedRow(mounted, row);
  return mounted;
}

function patchMountedRow(mounted: MountedEquipmentRow, row: EquipmentStableCatalogueRow): void {
  mounted.row = row;
  mounted.root.classList.toggle("is-previewing", row.previewing);
  mounted.root.classList.toggle("is-blocked", !row.canAdd);
  mounted.button.ariaLabel = row.previewAriaLabel;
  mounted.button.setAttribute("aria-pressed", row.previewing ? "true" : "false");
  mounted.name.textContent = row.name;
  mounted.level.textContent = row.levelLabel;
  mounted.rarity.className = `tag rarity-${row.rarity}`;
  mounted.rarity.textContent = row.rarity === "common" ? "" : row.rarityLabel;
  mounted.rarity.hidden = row.rarity === "common";
  mounted.meta.textContent = `${row.itemTypeLabel} · ${row.sourceLabel}${row.unavailableReason ? ` · ${row.unavailableReason}` : ""}`;
  mounted.price.classList.toggle("is-unaffordable", !row.canAdd);
  mounted.price.textContent = row.priceLabel;
}

function containsRange(container: EquipmentStableCatalogueRange, candidate: EquipmentStableCatalogueRange): boolean {
  return container.start <= candidate.start && container.end >= candidate.end;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
