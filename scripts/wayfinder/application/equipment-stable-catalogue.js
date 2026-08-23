const DEFAULT_ROW_HEIGHT_PX = 64;
const DEFAULT_ROWS_BEHIND = 12;
const DEFAULT_ROWS_AHEAD = 24;
const ROW_HEIGHT_CUSTOM_PROPERTY = "--wayfinder-equipment-result-row-height";
/**
 * A fixed-height catalogue renderer whose viewport and canvas survive scroll changes.
 *
 * Rows are mounted directly from a complete lightweight projection. The controller
 * never asks Foundry to render, hydrate, prepare, or price an item. Transaction and
 * exact-price authority remain outside this browse-only boundary.
 */
export class EquipmentStableCatalogue {
    #host;
    #viewport;
    #canvas;
    #rowHeightPx;
    #rowHeightFromCss;
    #rowsBehind;
    #rowsAhead;
    #resizeObserver;
    #previousPageButton;
    #nextPageButton;
    #onPreview;
    #mountedBySourceUuid = new Map();
    #projection = null;
    #indexBySourceUuid = new Map();
    #mountedRange = { start: 0, end: 0 };
    #orderIndexBuildCount = 0;
    #lastScrollTop = 0;
    #direction = 0;
    #frame = null;
    #disposed = false;
    constructor(options) {
        this.#host = options.host;
        this.#viewport = options.viewport;
        this.#canvas = options.canvas;
        this.#rowHeightFromCss = options.rowHeightPx === undefined;
        this.#rowHeightPx = this.#rowHeightFromCss
            ? measuredCssRowHeight(this.#canvas, DEFAULT_ROW_HEIGHT_PX)
            : positiveInteger(options.rowHeightPx, DEFAULT_ROW_HEIGHT_PX);
        this.#rowsBehind = nonNegativeInteger(options.rowsBehind, DEFAULT_ROWS_BEHIND);
        this.#rowsAhead = nonNegativeInteger(options.rowsAhead, DEFAULT_ROWS_AHEAD);
        this.#previousPageButton = options.previousPageButton ?? null;
        this.#nextPageButton = options.nextPageButton ?? null;
        this.#onPreview = options.onPreview;
        this.#viewport.classList.add("is-stable-catalogue");
        this.#viewport.addEventListener("scroll", this.#onScroll, { passive: true });
        this.#viewport.addEventListener("focusout", this.#onFocusOut);
        this.#canvas.addEventListener("click", this.#onCanvasClick);
        this.#previousPageButton?.addEventListener("click", this.#onPreviousPage);
        this.#nextPageButton?.addEventListener("click", this.#onNextPage);
        const ResizeObserverConstructor = this.#viewport.ownerDocument.defaultView?.ResizeObserver;
        this.#resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(this.#onResize) : null;
        this.#resizeObserver?.observe(this.#viewport);
    }
    setProjection(projection) {
        this.#assertActive();
        this.#refreshRowHeight();
        this.#patchProjectionDatasets(projection);
        const preservesOrder = this.#projection !== null &&
            this.#projection.orderKey === projection.orderKey &&
            this.#projection.sourceUuids.length === projection.sourceUuids.length;
        if (preservesOrder) {
            this.#projection = projection;
            const range = this.#mountedRange.end > this.#mountedRange.start
                ? this.#mountedRange
                : this.#emergencyRange(this.#visibleRange());
            this.#bindRange(range);
            this.#scheduleFrame();
            return;
        }
        const indexBySourceUuid = new Map();
        projection.sourceUuids.forEach((sourceUuid, index) => {
            if (!sourceUuid || indexBySourceUuid.has(sourceUuid)) {
                throw new TypeError("Stable equipment catalogue rows require unique source UUIDs.");
            }
            indexBySourceUuid.set(sourceUuid, index);
        });
        const focusedSourceUuid = this.#focusedSourceUuid();
        this.#projection = projection;
        this.#indexBySourceUuid = indexBySourceUuid;
        this.#orderIndexBuildCount += 1;
        this.#canvas.style.height = `${projection.sourceUuids.length * this.#rowHeightPx}px`;
        this.#viewport.dataset.orderIndexBuildCount = String(this.#orderIndexBuildCount);
        if (focusedSourceUuid && !indexBySourceUuid.has(focusedSourceUuid)) {
            this.#viewport.focus({ preventScroll: true });
        }
        const maximumScrollTop = Math.max(0, projection.sourceUuids.length * this.#rowHeightPx - this.#viewport.clientHeight);
        if (this.#viewport.scrollTop > maximumScrollTop)
            this.#viewport.scrollTop = maximumScrollTop;
        this.#lastScrollTop = this.#viewport.scrollTop;
        this.#mountedRange = { start: 0, end: 0 };
        this.#bindRange(this.#emergencyRange(this.#visibleRange()));
        this.#scheduleFrame();
    }
    restoreScrollTop(scrollTop) {
        this.#assertActive();
        const totalHeight = (this.#projection?.sourceUuids.length ?? 0) * this.#rowHeightPx;
        const maximumScrollTop = Math.max(0, totalHeight - this.#viewport.clientHeight);
        this.#viewport.scrollTop = clamp(Number.isFinite(scrollTop) ? scrollTop : 0, 0, maximumScrollTop);
        this.#lastScrollTop = this.#viewport.scrollTop;
        this.#mountedRange = { start: 0, end: 0 };
        this.#bindRange(this.#emergencyRange(this.#visibleRange()));
        this.#scheduleFrame();
    }
    dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#viewport.removeEventListener("scroll", this.#onScroll);
        this.#viewport.removeEventListener("focusout", this.#onFocusOut);
        this.#canvas.removeEventListener("click", this.#onCanvasClick);
        this.#previousPageButton?.removeEventListener("click", this.#onPreviousPage);
        this.#nextPageButton?.removeEventListener("click", this.#onNextPage);
        this.#resizeObserver?.disconnect();
        if (this.#frame !== null)
            cancelAnimationFrame(this.#frame);
        this.#frame = null;
        this.#mountedBySourceUuid.clear();
        this.#canvas.replaceChildren();
        this.#viewport.classList.remove("is-stable-catalogue");
    }
    #onScroll = () => {
        if (!this.#projection || this.#disposed)
            return;
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
    #onFocusOut = () => {
        requestAnimationFrame(() => {
            const active = this.#viewport.ownerDocument.activeElement;
            if (this.#disposed || (active !== this.#viewport && this.#viewport.contains(active)))
                return;
            this.#bindRange(this.#overscanRange(this.#visibleRange()));
        });
    };
    #onResize = () => {
        if (!this.#projection || this.#disposed)
            return;
        this.#refreshRowHeight();
        const visible = this.#visibleRange();
        if (!containsRange(this.#mountedRange, visible))
            this.#bindRange(this.#emergencyRange(visible));
        this.#scheduleFrame();
    };
    #onCanvasClick = (event) => {
        const target = event.target;
        const ElementConstructor = this.#canvas.ownerDocument.defaultView?.Element;
        if (!ElementConstructor || !(target instanceof ElementConstructor))
            return;
        const button = target.closest("[data-equipment-item]");
        if (!button || !this.#canvas.contains(button))
            return;
        const mounted = this.#mountedBySourceUuid.get(button.dataset.sourceUuid ?? "");
        const projection = this.#projection;
        if (!mounted || !projection)
            return;
        event.preventDefault();
        this.#onPreview?.(mounted.row, button, projection.stepId);
    };
    #onPreviousPage = (event) => {
        event.preventDefault();
        this.#scrollPage(-1);
    };
    #onNextPage = (event) => {
        event.preventDefault();
        this.#scrollPage(1);
    };
    #scheduleFrame() {
        if (this.#frame !== null || this.#disposed)
            return;
        this.#frame = requestAnimationFrame(() => {
            this.#frame = null;
            if (!this.#projection || this.#disposed)
                return;
            this.#bindRange(this.#overscanRange(this.#visibleRange()));
        });
    }
    #visibleRange() {
        const total = this.#projection?.sourceUuids.length ?? 0;
        if (total === 0)
            return { start: 0, end: 0 };
        const start = clamp(Math.floor(this.#viewport.scrollTop / this.#rowHeightPx), 0, total - 1);
        const visibleCount = Math.max(1, Math.ceil(this.#viewport.clientHeight / this.#rowHeightPx) + 1);
        return { start, end: Math.min(total, start + visibleCount) };
    }
    #emergencyRange(visible) {
        const total = this.#projection?.sourceUuids.length ?? 0;
        return {
            start: Math.max(0, visible.start - 1),
            end: Math.min(total, visible.end + 1),
        };
    }
    #overscanRange(visible) {
        const total = this.#projection?.sourceUuids.length ?? 0;
        const before = this.#direction < 0 ? this.#rowsAhead : this.#rowsBehind;
        const after = this.#direction < 0 ? this.#rowsBehind : this.#rowsAhead;
        return {
            start: Math.max(0, visible.start - before),
            end: Math.min(total, visible.end + after),
        };
    }
    #bindRange(range) {
        const projection = this.#projection;
        if (!projection)
            return;
        const focusedSourceUuid = this.#focusedSourceUuid();
        const wanted = new Set();
        const mounted = [];
        for (let index = range.start; index < range.end; index += 1) {
            const row = this.#rowAt(index);
            wanted.add(row.sourceUuid);
            mounted.push(this.#mountOrPatch(row, index, projection.sourceUuids.length));
        }
        if (focusedSourceUuid && !wanted.has(focusedSourceUuid)) {
            const focusedIndex = this.#indexBySourceUuid.get(focusedSourceUuid);
            const focusedRow = focusedIndex === undefined ? undefined : this.#rowAt(focusedIndex);
            if (focusedRow && focusedIndex !== undefined) {
                wanted.add(focusedSourceUuid);
                mounted.push(this.#mountOrPatch(focusedRow, focusedIndex, projection.sourceUuids.length));
            }
        }
        for (const [sourceUuid, row] of this.#mountedBySourceUuid) {
            if (wanted.has(sourceUuid))
                continue;
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
        this.#updatePagingFallback();
    }
    #scrollPage(direction) {
        const projection = this.#projection;
        if (!projection || projection.sourceUuids.length === 0)
            return;
        const visible = this.#visibleRange();
        const pageSize = Math.max(1, visible.end - visible.start - 1);
        const targetIndex = clamp(visible.start + direction * pageSize, 0, projection.sourceUuids.length - 1);
        this.#viewport.scrollTop = targetIndex * this.#rowHeightPx;
        this.#onScroll();
        requestAnimationFrame(() => {
            this.#mountedBySourceUuid.get(projection.sourceUuids[targetIndex])?.button.focus({ preventScroll: true });
        });
    }
    #updatePagingFallback() {
        const visible = this.#visibleRange();
        const total = this.#projection?.sourceUuids.length ?? 0;
        if (this.#previousPageButton)
            this.#previousPageButton.disabled = visible.start === 0;
        if (this.#nextPageButton)
            this.#nextPageButton.disabled = visible.end >= total;
    }
    #mountOrPatch(row, index, total) {
        let mounted = this.#mountedBySourceUuid.get(row.sourceUuid);
        if (!mounted) {
            mounted = createMountedRow(this.#canvas.ownerDocument, row, index);
            this.#mountedBySourceUuid.set(row.sourceUuid, mounted);
        }
        if (mounted.row !== row)
            patchMountedRow(mounted, row);
        mounted.index = index;
        mounted.root.dataset.resultIndex = String(index);
        mounted.root.setAttribute("aria-posinset", String(index + 1));
        mounted.root.setAttribute("aria-setsize", String(total));
        mounted.root.style.transform = `translateY(${index * this.#rowHeightPx}px)`;
        mounted.root.style.height = `${this.#rowHeightPx}px`;
        return mounted;
    }
    #focusedSourceUuid() {
        const active = this.#viewport.ownerDocument.activeElement;
        const HTMLElementConstructor = this.#viewport.ownerDocument.defaultView?.HTMLElement;
        if (!HTMLElementConstructor || !(active instanceof HTMLElementConstructor) || !this.#viewport.contains(active)) {
            return null;
        }
        return active.closest("[data-source-uuid]")?.dataset.sourceUuid ?? null;
    }
    #assertActive() {
        if (this.#disposed)
            throw new Error("Cannot update a disposed stable equipment catalogue.");
    }
    #patchProjectionDatasets(projection) {
        const datasets = [this.#host.dataset, this.#viewport.dataset];
        for (const dataset of datasets) {
            dataset.stepId = projection.stepId;
            dataset.totalResults = String(projection.totalResultCount);
            dataset.resultOffset = String(projection.resultOffset);
            dataset.resultLimit = String(projection.resultLimit);
            dataset.wayfinderRenderedQuery = projection.renderedQuery;
            dataset.wayfinderViewRevision = String(projection.viewRevision);
            dataset.wayfinderSourceRevision = String(projection.sourceRevision);
            dataset.wayfinderCriteriaRevision = String(projection.criteriaRevision);
            dataset.projectionKey = projection.key;
            dataset.orderKey = projection.orderKey;
        }
        this.#viewport.setAttribute("aria-busy", "false");
    }
    #refreshRowHeight() {
        if (!this.#rowHeightFromCss)
            return;
        const next = measuredCssRowHeight(this.#canvas, DEFAULT_ROW_HEIGHT_PX);
        if (Math.abs(next - this.#rowHeightPx) < 0.5)
            return;
        const prior = this.#rowHeightPx;
        const anchor = prior > 0 ? this.#viewport.scrollTop / prior : 0;
        this.#rowHeightPx = next;
        this.#canvas.style.height = `${(this.#projection?.sourceUuids.length ?? 0) * next}px`;
        this.#viewport.scrollTop = anchor * next;
        this.#lastScrollTop = this.#viewport.scrollTop;
        this.#mountedRange = { start: 0, end: 0 };
    }
    #rowAt(index) {
        const projection = this.#projection;
        if (!projection)
            throw new Error("Stable equipment catalogue has no active projection.");
        const sourceUuid = projection.sourceUuids[index];
        if (!sourceUuid)
            throw new RangeError(`Stable equipment catalogue row ${index} is outside the projection.`);
        const row = projection.rowAt(index);
        if (row.sourceUuid !== sourceUuid) {
            throw new Error("Stable equipment catalogue row drifted from its ordered source identity.");
        }
        return row;
    }
}
function createMountedRow(document, row, index) {
    const root = document.createElement("article");
    root.className = "equipment-result-row equipment-stable-result-row";
    root.setAttribute("role", "listitem");
    root.dataset.sourceUuid = row.sourceUuid;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "equipment-result";
    button.dataset.equipmentItem = "";
    // Stable rows are mounted after the app's render-boundary focus pass. Foundry
    // reserves Tab unless dynamically created controls opt into keyboard focus.
    button.dataset.keyboardFocus = "true";
    button.dataset.sourceUuid = row.sourceUuid;
    button.dataset.wayfinderAction = "preview-equipment-item";
    const art = document.createElement("span");
    art.className = "equipment-result-art";
    art.setAttribute("aria-hidden", "true");
    const icon = document.createElement("i");
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
    const mounted = { root, button, name, level, rarity, meta, price, icon, row, index };
    patchMountedRow(mounted, row);
    return mounted;
}
function patchMountedRow(mounted, row) {
    mounted.row = row;
    const visuallyBlocked = !row.canAdd && row.pricePending !== true;
    mounted.root.classList.toggle("is-previewing", row.previewing);
    mounted.root.classList.toggle("is-blocked", visuallyBlocked);
    mounted.root.dataset.pricePending = row.pricePending ? "true" : "false";
    mounted.button.ariaLabel = row.previewAriaLabel;
    mounted.button.setAttribute("aria-pressed", row.previewing ? "true" : "false");
    mounted.button.dataset.filterRarity = row.rarity;
    mounted.button.dataset.filterSource = row.sourceLabel;
    mounted.button.dataset.filterType = row.itemType;
    mounted.button.dataset.wayfinderFocusId = row.previewFocusId;
    mounted.icon.className = `fa-solid ${row.typeIcon}`;
    mounted.name.textContent = row.name;
    mounted.level.textContent = row.levelLabel;
    mounted.rarity.className = `tag rarity-${row.rarity}`;
    mounted.rarity.textContent = row.rarity === "common" ? "" : row.rarityLabel;
    mounted.rarity.hidden = row.rarity === "common";
    mounted.meta.textContent = `${row.itemTypeLabel} · ${row.sourceLabel}${row.unavailableReason ? ` · ${row.unavailableReason}` : ""}`;
    mounted.price.classList.toggle("is-unaffordable", visuallyBlocked);
    mounted.price.textContent = row.priceLabel;
}
function containsRange(container, candidate) {
    return container.start <= candidate.start && container.end >= candidate.end;
}
function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
function nonNegativeInteger(value, fallback) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function measuredCssRowHeight(canvas, fallback) {
    const probe = canvas.ownerDocument.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:var(${ROW_HEIGHT_CUSTOM_PROPERTY}, ${fallback}px)`;
    canvas.append(probe);
    const measured = probe.getBoundingClientRect().height;
    probe.remove();
    return Number.isFinite(measured) && measured > 0 ? measured : fallback;
}
//# sourceMappingURL=equipment-stable-catalogue.js.map