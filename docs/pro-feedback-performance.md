# Verdict

> **Status: implemented design input, not a description of the current
> architecture.** This review was written against the pre-0.8.2 catalogue
> pipeline. The 0.8.2 candidate adopts its central boundary: a stable catalogue
> host retains the complete lightweight matching shelf, adaptive fixed-height
> virtualization projects only mounted rows, and scrolling performs no Foundry
> render or compendium-document read. Search and facets replace the lightweight
> projection; preview enrichment may fail and retry without losing the host,
> scroll position, or focus; purchase and Apply still re-resolve fresh
> authority. Stage timing and zero-gap/recovery probes are now part of the live
> profile. Row images, a broader enrichment scheduler, and worker or persistent
> caches remain deferred pending evidence.
>
> Qualification at production commit
> `b5e51e7e473193144783b4bde3278a046c6d8ee7`: two clean 840-sample runs
> passed; the 1,138-row default shelf mounted 29, 35, and 40 rows at 820, 1,200,
> and 1,500 px with zero visible gap. Two rapid full-screen jumps caused zero
> equipment/full renders and zero document reads. A forced preview-read failure
> recovered the same focused row with exactly two document reads and zero full
> renders. Final 0.8.2 package binding is still pending.

**Yes: stop treating a scroll-window change as a Foundry render.** Keep ApplicationV2 and Handlebars for the window shell, filters, detail panel, cart, status, and genuine domain-state changes. Inside that shell, mount a stable, imperative virtual-list controller that renders immediately from lightweight browse data.

The current architecture makes viewport coverage depend on work that has nothing to do with scrolling: filtering/ranking, document hydration, PF2E preparation, view-model assembly, Handlebars rendering, DOM replacement, measurement, and focus restoration.  Worse, both `"window"` and `"preview"` currently rerender the catalogue and detail parts together.

Foundry’s own ApplicationV2 documentation describes `render()` as replacing the application’s inner HTML, and `_replaceHTML` as inserting the rendering backend’s replacement result. That is a reasonable application lifecycle primitive, but a bad high-frequency scrolling primitive. ([Foundry Virtual Tabletop][1])

The architecture boundary should be:

> **Scrolling must never await anything.**
> Search/filter may produce a new lightweight projection.
> Browse enrichment may arrive later.
> Purchase/apply must freshly verify authority.

---

# Likely bottlenecks

I would rank them this way before profiling proves otherwise.

| Rank | Suspected bottleneck                                      |                  Confidence | Why                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------- | --------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | PF2E document hydration and preparation                   |                   Very high | Ordinary visible priced rows are hydrated in 12-row chunks and then passed through browse preparation or exact price construction before the page can commit.                                                                                                                                        |
| 2    | Foundry/Handlebars part replacement and subsequent layout |                        High | Every completed window request replaces catalogue DOM and then restores scroll, focus, and measurements. The current skeleton/anchor code also queries DOM geometry and rebuilds a skeleton band.                                                                                                    |
| 3    | Repeated per-window browse work                           |                        High | Each project call re-establishes catalogue context, resolves size, normalizes filters, filters and ranks all entries, then later rebuilds facets and line maps.                                                                                                                                      |
| 4    | Actor pricing fingerprint                                 |              Medium to high | The fingerprint walks and canonicalizes the actor system, embedded items, effects, and flags. Doing this on a viewport request is potentially substantial even when the catalogue projection itself is warm.                                                                                         |
| 5    | Obsolete synchronous work                                 | High during rapid scrolling | The latest-wins scheduler prevents stale commits, but aborting a controller cannot interrupt synchronous PF2E preparation already executing on the main thread. The scheduler can start the replacement without waiting for obsolete work, allowing old and new pipelines to overlap conceptually.   |
| 6    | Height model and coverage bookkeeping                     |                      Medium | Prefix calculations scan retained measurements during binary search, measurements are eventually evicted, and scroll coverage currently creates separate skeleton nodes.                                                                                                                             |

The cold-open 53 ms long task from the index-only experiment may be index normalization, policy projection, actor fingerprinting, filtering, Handlebars, layout, or some combination. I would not blame normalization alone until the A/B tests below isolate it.

---

# Viable architectures

| Architecture                                                                   | Advantages                                                                                                     | Costs                                                                          | Verdict                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| **Stable catalogue host + keyed recycled row pool**                            | Lowest scroll cost; full scrollbar immediately; large jumps are independent of hydration; precise backpressure | New controller lifecycle; focus/recycling requires care                        | **Recommended**                          |
| **Stable catalogue host + keyed non-recycled virtual window**                  | Simpler accessibility and node identity; still avoids Foundry renders                                          | More node creation/removal during scrolling                                    | Good first migration or permanent option |
| **Keep Foundry partial rendering, but remove hydration from window rendering** | Smallest code change; validates the data split quickly                                                         | DOM replacement remains on scroll; likely still misses the rapid-jump contract | Transitional only                        |

I would not render all 1,138 rows and rely on `content-visibility`. It conflicts with the DOM budgets and leaves unnecessary accessibility and lifecycle complexity.

---

# Recommended architecture

```text
ApplicationV2 / Handlebars
├── policy and filter controls
├── stable catalogue host
│   ├── BrowseProjection: all matching lightweight rows
│   ├── VirtualCatalogueController: geometry and row DOM
│   └── BrowseEnrichmentScheduler: ambiguous prices and previews
├── detail panel
├── cart
└── status/live regions

Existing transaction runtime
└── fresh document hydration + PF2E preparation + authority verification
```

## 1. Retain the complete lightweight browse projection

All 1,138 matching lightweight rows should exist as an immutable in-memory array. That scale is unremarkable for plain DTOs. More importantly, the catalogue service already retains a complete evaluated `entries` array; the runtime subsequently filters, ranks, and slices it for every requested window.

Introduce something like:

```ts
interface EquipmentBrowseProjection {
  readonly key: string;
  readonly criteriaRevision: number;
  readonly rows: readonly EquipmentBrowseRow[];
  readonly indexBySourceUuid: ReadonlyMap<string, number>;
  readonly facets: readonly EquipmentFacet[];
  readonly levelFacet: EquipmentLevelFacet;
  readonly resultMessage: string;
}

interface EquipmentBrowseRow {
  readonly sourceUuid: string;
  readonly name: string;
  readonly imageUrl: string;
  readonly itemType: string;
  readonly level: number;
  readonly rarity: string;
  readonly sourceLabel: string;
  readonly traits: readonly string[];
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly price: EquipmentBrowsePrice;
}
```

Cache that projection by everything that actually changes its contents:

```text
source generation
policy fingerprint
access-facts fingerprint
target level
normalized query
normalized filters
locale/search-normalization version
projection schema version
```

Do **not** include `scrollTop`, window offset, or mounted-row count.

Facets belong in this projection because they depend on criteria, not the viewport. The same is true of ranking. The current four-level relevance algorithm could even be made linear by collecting results into availability/relevance buckets rather than sorting all matches on every query, but that is secondary to removing it from scrolling.

## 2. Separate browse, enrichment, and transaction authority

Use three explicit data levels:

### Browse data

Available synchronously for every row:

* Identity, name, type, level, rarity, traits, source
* Availability and policy status
* Indexed base price
* Image URL
* A classification saying whether indexed price is sufficient

The current compendium index already requests most of these fields, including the image, price, quantity, traits, and rule keys.  The current UI mapper can already use indexed copper when no prepared price is passed, so the code is closer to this separation than it may appear.

### Browse enrichment

Asynchronous and cacheable:

* Prepared exact browse price for ambiguous rows
* Preview document/projected description
* Image decode state
* Optional extra display facts

Failure here must leave a usable base row, not remove the row.

### Transaction authority

Fresh and non-cache-authoritative:

* Rehydrate the current source
* Reevaluate current policy
* Resolve current actor size and pricing context
* PF2E-prepare the item
* Recompute the exact price
* Verify fingerprints/revisions
* Only then modify the starting kit

That authority path already exists: `prepareLine` freshly resolves and prices the source, and apply again verifies persisted state and current source material.   I would leave those paths almost entirely untouched during the UI migration.

## 3. Make price states honest

I would use:

```ts
type EquipmentBrowsePrice =
  | {
      readonly kind: "exact";
      readonly copper: number;
      readonly basis: "index-proof" | "prepared-cache";
    }
  | {
      readonly kind: "pending";
      readonly indexedBaseCopper: number | null;
      readonly reason: PriceAmbiguity;
    }
  | {
      readonly kind: "unavailable";
      readonly label: string;
    };
```

My preference is **not** to show an unlabeled provisional number. For ambiguous rows, show “Checking price…” or, where useful, “Base price: 5 gp” rather than presenting `5 gp` as transaction-ready. Never include a provisional amount in remaining-wealth calculations.

For an index price to be declared exact, require a conservative, versioned proof. The present index field list is not sufficient to prove all PF2E prices because it does not request every potential price determinant. In PF2E 8.4.1, physical-item preparation defaults `sizeSensitive` when absent and derives price from factors including runes, precious material, shoddiness, and size. ([GitHub][2])

A useful classifier would require evidence for at least:

* No configured runes or specific-item configuration
* No precious material or grade
* No subitems/attachments that affect derived data
* No relevant rules
* Supported item type and unit-pricing shape
* Known size-price behavior for the current target size
* No special qualified source behavior
* A pricing-proof schema tied to PF2E version

Extend `INDEX_FIELDS` with only the fields required to prove those conditions. Anything missing or unexpected means `pending`, not an optimistic guess.

Then build a parity test that, for every supported compendium record and representative pricing contexts, compares `index-proof` against current PF2E preparation. A PF2E upgrade should invalidate that proof until the suite passes again.

---

# The virtual list

## Stable inner canvas with keyed recycling

Use one stable scroll viewport and one inner canvas representing the total height:

```html
<div class="equipment-catalogue-viewport"
     role="list"
     aria-label="Available equipment"
     tabindex="0">
  <div class="equipment-catalogue-canvas"></div>
</div>
```

```css
.equipment-catalogue-viewport {
  overflow: auto;
  position: relative;
}

.equipment-catalogue-canvas {
  position: relative;
}

.equipment-result-row {
  position: absolute;
  inset-inline: 0;
  block-size: var(--equipment-row-height);
}
```

Each mounted row gets:

```ts
row.style.transform = `translateY(${index * rowHeight}px)`;
```

Do not add `will-change` to every row; the pool is small, and permanent layer promotion can cost more than it saves.

Use a keyed recycler:

```ts
Map<string, EquipmentRowElement>
```

Rows retain identity while mounted. When evicted, their nodes enter a free pool. A focused node is never recycled until focus leaves it.

## Pool sizing

The current 36–144 policy combines three unrelated concerns:

1. How many rows are visible
2. How much DOM overscan is useful
3. How many documents must be prepared

Its larger windows compensate for a data pipeline that cannot keep up, but they also multiply the costly preparation work. The current constants explicitly use a 36 baseline, 144 maximum, three viewport heights, and 12-row hydration chunks.

After decoupling, use approximately:

```text
visible rows
+ 12 rows behind
+ 24 rows ahead
+ at most one pinned focused row
```

Reverse ahead/behind when scrolling backward. Cap the normal pool around 72–80 rows unless measurements justify something else.

The pool should therefore scale with viewport height, but not by three full viewport heights. A tall viewport naturally mounts more rows because it has more visible rows; hydration no longer affects that decision.

## Synchronous coverage repair, then `requestAnimationFrame`

Because the previous animation-frame delay produced a blank first frame, I would use a two-tier path:

1. The scroll handler computes the visible fixed-height range using only `scrollTop`, `clientHeight`, and arithmetic.
2. If that visible range is still inside the mounted range, it only records state and schedules one animation frame.
3. If the viewport escaped the mounted range—a scrollbar drag or large jump—it **synchronously rebinds enough lightweight rows to cover the viewport**.
4. The animation-frame callback expands to the full directional overscan range and updates enrichment demand.

That gives you coalescing during ordinary scrolling without putting first-frame coverage behind an animation-frame boundary.

```ts
private onScroll = (): void => {
  const visible = this.geometry.visibleRange(
    this.viewport.scrollTop,
    this.viewport.clientHeight,
    this.projection.rows.length
  );

  this.viewportEpoch += 1;
  this.latestVisible = visible;

  if (!containsRange(this.mountedRange, visible)) {
    // Real lightweight rows, not skeletons. No async work.
    this.bindRange(expandRange(visible, 1, 1));
  }

  this.scheduleFrame();
};
```

The current absolute skeleton band becomes unnecessary. A row itself is always available; only its price or preview field may display an inline placeholder.

## `IntersectionObserver`

Do not use it as the virtual-list driver. Intersection callbacks are asynchronous and are not designed to report exact pixel coverage, so they are unsuitable for guaranteeing a zero-gap large jump. ([MDN Web Docs][3])

Use:

* Scroll event for recording the latest position and emergency coverage
* `requestAnimationFrame` for the final mounted range
* `ResizeObserver` for viewport dimensions and, only if needed, row-height changes; it specifically reports element box-size changes. ([MDN Web Docs][4])
* `IntersectionObserver` only as an optional image/enrichment hint

---

# Variable row height

My strong recommendation is to make catalogue rows a uniform height:

* Clamp the title to one or two lines
* Clamp or summarize traits
* Put verbose information in the detail panel
* Reserve a fixed image rectangle
* Express height in `rem` or CSS variables and measure the resulting prototype row, so font scaling is still respected

This removes most anchor, prefix-height, and scroll-jump complexity.

If truly variable rows are required, retain one estimated/measured height for **all** 1,138 rows. That is only a few kilobytes. Use a Fenwick tree or segment tree for:

* `prefixHeight(index)` in `O(log n)`
* Height updates in `O(log n)`
* Offset-to-index lookup in `O(log n)`

Do not evict old measurements. When a height above the anchor changes:

```text
oldAnchorTop = prefixHeight(anchorIndex)
update measured height
newAnchorTop = prefixHeight(anchorIndex)
scrollTop += newAnchorTop - oldAnchorTop
```

Batch `ResizeObserver` results into one animation frame and use `overflow-anchor: none` on the managed canvas to avoid competing browser anchoring.

---

# Cancellation, prefetch, and backpressure

## Separate I/O concurrency from CPU preparation

The existing `mapChunksWithConcurrency` treats both document resolution and PF2E preparation as chunked asynchronous work. Cooperative abort checks occur before and after workers, but synchronous work inside a worker remains uninterruptible.

I would use:

* Document hydration concurrency: initially 4, then tune
* PF2E preparation concurrency: **1**
* Preparation batch size: initially 1–2, or an adaptively sized batch whose measured synchronous duration stays under roughly 6–8 ms
* One shared priority queue, not one independent pipeline per viewport request

The current pack interface accepts only a document ID, not an `AbortSignal`, so an in-flight `getDocument` cannot be genuinely cancelled through this adapter.  Its result can still populate a raw-source cache if its pack generation remains valid, but it must not commit obsolete UI state.

## Demand priorities

| Input                                     | DOM action                                 | Enrichment action                                          |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Slow wheel/trackpad                       | Normal directional overscan                | Visible ambiguous rows, then 1–2 predicted viewports ahead |
| Fast wheel/trackpad                       | Keep rows populated from browse projection | Prioritize visible only; defer speculative prep            |
| Scrollbar drag or jump over two viewports | Synchronously cover destination            | Drop queued skipped-path work; request destination only    |
| Page Down / Page Up                       | Destination is known; cover immediately    | Destination visible rows first                             |
| Programmatic jump                         | Same as scrollbar jump                     | No hydration of intervening rows                           |
| Scroll settled for ~100 ms                | No special DOM work                        | Resume one viewport ahead and one behind                   |

Velocity prediction need not be fancy:

```ts
predictedOffset = currentOffset + pixelsPerMs * 180;
```

Clamp it to at most three viewports.

## Semantic latest-wins, not merely request latest-wins

Every enrichment job should carry:

```ts
interface EquipmentEnrichmentKey {
  readonly projectionKey: string;
  readonly pricingContextKey: string;
  readonly sourceUuid: string;
}
```

And separately:

```ts
viewportEpoch: number
```

The distinction matters:

* A result from an old viewport may still be safe to cache if its semantic key is current.
* It must only patch the visible row if its viewport demand is still relevant.
* A result from an obsolete projection, actor-pricing context, pack generation, or policy must be discarded entirely.

A single drain loop prevents obsolete synchronous preparation from sitting ahead of the user’s current destination.

---

# TypeScript-oriented sketch

```ts
type VirtualRange = { readonly start: number; readonly end: number };

interface EquipmentBrowseProjection {
  readonly key: string;
  readonly revision: number;
  readonly rows: readonly EquipmentBrowseRow[];
  readonly indexBySourceUuid: ReadonlyMap<string, number>;
}

interface EnrichmentDemand {
  readonly projectionKey: string;
  readonly pricingContextKey: string;
  readonly viewportEpoch: number;
  readonly visible: VirtualRange;
  readonly prefetch: VirtualRange;
  readonly direction: "forward" | "backward" | "stationary";
  readonly velocityPxPerMs: number;
}

class EquipmentVirtualCatalogue {
  #projection: EquipmentBrowseProjection | null = null;
  #mounted: VirtualRange = { start: 0, end: 0 };
  #latestVisible: VirtualRange = { start: 0, end: 0 };
  #viewportEpoch = 0;
  #frame: number | null = null;
  #focusedSourceUuid: string | null = null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly canvas: HTMLElement,
    private readonly rows: KeyedEquipmentRowPool,
    private readonly geometry: FixedRowGeometry,
    private readonly enrichment: EquipmentEnrichmentScheduler
  ) {
    viewport.addEventListener("scroll", this.#onScroll, { passive: true });
  }

  setProjection(projection: EquipmentBrowseProjection): void {
    const anchor = this.captureAnchor();
    this.#projection = projection;

    this.canvas.style.height =
      `${projection.rows.length * this.geometry.rowHeightPx}px`;

    this.restoreAnchor(anchor, projection);
    this.#mounted = { start: 0, end: 0 };
    this.#coverNow();
    this.#scheduleFrame();
  }

  dispose(): void {
    this.viewport.removeEventListener("scroll", this.#onScroll);
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.rows.dispose();
    this.enrichment.dispose();
  }

  #onScroll = (): void => {
    const projection = this.#projection;
    if (!projection) return;

    this.#viewportEpoch += 1;
    this.#latestVisible = this.geometry.visibleRange(
      this.viewport.scrollTop,
      this.viewport.clientHeight,
      projection.rows.length
    );

    if (!containsRange(this.#mounted, this.#latestVisible)) {
      // Must be cheap enough to run synchronously.
      this.#bindRange(expandAndClamp(
        this.#latestVisible,
        1,
        1,
        projection.rows.length
      ));
    }

    this.#scheduleFrame();
  };

  #coverNow(): void {
    const projection = this.#projection;
    if (!projection) return;

    this.#latestVisible = this.geometry.visibleRange(
      this.viewport.scrollTop,
      this.viewport.clientHeight,
      projection.rows.length
    );

    this.#bindRange(expandAndClamp(
      this.#latestVisible,
      1,
      1,
      projection.rows.length
    ));
  }

  #scheduleFrame(): void {
    if (this.#frame !== null) return;

    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      const projection = this.#projection;
      if (!projection) return;

      const motion = this.geometry.motionSnapshot();
      const target = directionalOverscan({
        visible: this.#latestVisible,
        direction: motion.direction,
        rowsBehind: 12,
        rowsAhead: 24,
        total: projection.rows.length,
      });

      this.#bindRange(target);

      this.enrichment.setDemand({
        projectionKey: projection.key,
        pricingContextKey: currentPricingContextKey(),
        viewportEpoch: this.#viewportEpoch,
        visible: this.#latestVisible,
        prefetch: target,
        direction: motion.direction,
        velocityPxPerMs: motion.velocityPxPerMs,
      });
    });
  }

  #bindRange(range: VirtualRange): void {
    const projection = this.#projection;
    if (!projection) return;

    this.rows.bind({
      range,
      focusedSourceUuid: this.#focusedSourceUuid,
      resolve: (index) => projection.rows[index]!,
      patch: (element, row, index) => {
        // textContent, class toggles, and attributes; no row innerHTML.
        patchEquipmentRow(element, row);

        element.dataset.sourceUuid = row.sourceUuid;
        element.dataset.resultIndex = String(index);
        element.setAttribute("role", "listitem");
        element.setAttribute("aria-posinset", String(index + 1));
        element.setAttribute("aria-setsize", String(projection.rows.length));
        element.style.transform =
          `translateY(${index * this.geometry.rowHeightPx}px)`;
      },
    });

    this.#mounted = range;
  }
}
```

The enrichment scheduler should be a single prioritized drain:

```ts
class EquipmentEnrichmentScheduler {
  #semanticGeneration = 0;
  #viewportEpoch = 0;
  #running = false;
  #queue = new PriorityQueue<EnrichmentJob>();
  #queued = new Map<string, EnrichmentJob>();
  #pendingSources = new Map<string, Promise<HydratedSource>>();

  setSemanticContext(context: PricingSemanticContext): void {
    this.#semanticGeneration += 1;
    this.#queue.clear();
    this.#queued.clear();
    this.context = context;
  }

  setDemand(demand: EnrichmentDemand): void {
    this.#viewportEpoch = demand.viewportEpoch;
    this.reprioritizeOrRemoveQueuedJobs(demand);
    this.enqueueVisibleAndPrefetch(demand);
    void this.#drain();
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;

    try {
      while (true) {
        const job = this.nextCurrentJob();
        if (!job) return;

        const generation = this.#semanticGeneration;
        const source = await this.fetchSourceDeduped(job);

        if (generation !== this.#semanticGeneration) continue;
        if (!this.semanticKeyIsCurrent(job)) continue;

        // Check again immediately before uninterruptible PF2E work.
        await yieldToMainThread();
        if (!this.semanticKeyIsCurrent(job)) continue;

        const exact = this.prepareOneSynchronously(source, job);

        // Cache validity is semantic, UI validity is viewport-specific.
        if (this.semanticKeyIsCurrent(job)) {
          this.cache.set(job.semanticKey, exact);
        }

        if (
          job.viewportEpoch === this.#viewportEpoch &&
          this.rowIsCurrentlyDemanded(job.sourceUuid)
        ) {
          this.onVisibleEnrichment(job.sourceUuid, exact);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
```

No Promise can preempt `prepareOneSynchronously`. The real cancellation mechanism is therefore **not starting stale preparation in the first place**, coupled with small preparation units and a priority queue.

---

# Accessibility

I would use `role="list"` / `role="listitem"` rather than `listbox` unless selecting an item is truly the widget’s central interaction. A shopping result row containing preview and add buttons is ordinary structured content with interactive descendants; forcing it into a listbox introduces a composite-widget keyboard contract that may not fit.

For each mounted item:

```html
<div role="listitem"
     aria-posinset="327"
     aria-setsize="1138">
  ...
</div>
```

WAI-ARIA 1.2 explicitly supports `aria-posinset` and `aria-setsize` on `listitem`, including overriding browser-computed values when the DOM contains only a subset. ([W3C][5])

Focus rules:

* Never recycle the currently focused row node.
* Permit one pinned focused row outside normal overscan.
* If criteria remove that row entirely, transfer focus to the stable list element or a deliberate sentinel and announce the removal.
* For keyboard Page Up/Down or row navigation, update the logical active index, scroll it into view, mount it, then focus its control.
* Keep DOM order matching visual/index order.
* Use event delegation on the stable host rather than rebinding listeners per row.

Announcements:

* Announce result count after search/filter criteria settle.
* Set `aria-busy` during a criteria projection or while a currently focused/visible required fact is being resolved.
* Do not keep the whole list busy merely because background prefetch is occurring.
* Do not announce window offsets while the user scrolls.
* Preserve the existing paging fallback as an optional accessibility and failure-recovery mode.

The current focus-sentinel mechanism can remain as a fallback.

---

# Item images

The index already includes `img`, so image display does not require document hydration.  Add images only after the base scrolling path is proven.

Use:

```html
<img width="40"
     height="40"
     loading="lazy"
     decoding="async"
     alt="">
```

Policy:

* Fixed width and height, with `object-fit`, so images never alter row geometry
* Assign `src` only for visible rows and perhaps one viewport ahead
* During high-velocity scrolling, render the cached placeholder and defer new `src` assignments until velocity drops or scrolling settles
* Cache successful URLs and decoded status
* Use `img.decode()` before revealing where supported
* Check row/source identity again after decode before changing opacity
* Let obsolete requests complete into the browser cache, but ignore their UI commits
* Keep meaningful item information in text; the compendium thumbnail should normally have empty alt text
* Add separate budgets for requests, decoded bytes, and image-related LoAF/layout activity

`IntersectionObserver` is reasonable here as a hint, because image loading can tolerate asynchronous observation. It is not reasonable for row coverage.

---

# Worker, idle, and persistent caching

My order would be:

1. **In-memory projection cache**
2. **Prewarm before the equipment step**
3. **Time-sliced normalization**
4. **Worker, only if profiling still shows a material cold long task**
5. **Persistent IndexedDB cache, only if cold reloads remain important**

A worker can handle only pure data:

* Clone selected index fields into plain DTOs
* Normalize
* Precompute search text
* Filter/rank
* Possibly compute facets

It cannot perform Foundry compendium calls or PF2E document preparation. It also loses the current WeakMap/object-identity normalization shortcut unless you replace that with stable witnesses.

For prewarming, start catalogue projection while the user is finishing the preceding character-builder step. `requestIdleCallback` is suitable for optional prework, but not required work; without a timeout it can be delayed by multiple seconds. ([MDN Web Docs][6])

A persistent cache should be keyed by at least:

```text
Foundry version
PF2E version
Wayfinder projection schema
pack/package versions
effective pack set
pack generation or content fingerprint
locale
```

Any pack create/update/delete hook must invalidate it. Never persist a prepared transaction authority object.

---

# Instrumentation that will identify the real bottleneck

Add `performance.mark`/`measure` around these stages with revision, source UUID, row count, and cache-hit details:

| Stage           | Useful measurements                                                              |
| --------------- | -------------------------------------------------------------------------------- |
| Index           | `getIndex` wait, `Array.from`, field projection                                  |
| Normalization   | witness generation, normalization total, yields                                  |
| Policy          | per-candidate evaluation and sort                                                |
| Pricing context | actor fingerprint and drafted-size resolution                                    |
| Criteria        | filter, rank, facets                                                             |
| Hydration       | queue delay, `getDocument` duration, source extraction                           |
| PF2E            | per-item preparation, batch preparation, maximum single synchronous block        |
| Template        | context assembly and Handlebars render                                           |
| DOM             | replacement, row patching, node creation/recycling                               |
| Rendering       | forced layout, style, paint, scroll-to-present                                   |
| Waste           | stale jobs started/completed, stale fetches, stale preparations, cache hit rates |

Install observers for:

```ts
new PerformanceObserver(onLongTask)
  .observe({ type: "longtask", buffered: true });

new PerformanceObserver(onLongAnimationFrame)
  .observe({ type: "long-animation-frame", buffered: true });
```

Long-task entries are available through `PerformanceObserver`, while LoAF entries expose delayed rendering frames and script/layout contribution information. Feature-detect entry support through `PerformanceObserver.supportedEntryTypes`. ([MDN Web Docs][7])

The most valuable A/B matrix is:

| Test | Hydration/preparation | Foundry partial render | Direct rows |
| ---- | --------------------: | ---------------------: | ----------: |
| A    |                   Off |                    Off |          On |
| B    |                   Off |                     On |         Off |
| C    |                    On |                    Off |          On |
| D    |                    On |                     On |         Off |

That tells you:

* A vs B: DOM-controller cost versus Foundry/Handlebars cost
* A vs C: hydration/PF2E cost
* B vs D: hydration cost under current rendering
* Cold A with/without actor fingerprint: projection/context cost

Also run individual toggles for:

* Cached versus recalculated actor pricing fingerprint
* Cached versus recomputed facets/ranking
* Fixed versus variable row geometry
* Batch sizes 1, 2, 4, 8, and 12
* I/O concurrency 1, 2, 4, and 8

I would introduce stricter internal scrolling budgets than the overall 75 ms action budget:

```text
Synchronous emergency coverage: p95 under 4 ms, max under 8 ms
Normal rAF row update: p95 under 4 ms
No long task
Zero visible gap
No PF2E preparation started for a semantically stale job
```

---

# Concrete changes by file

## `starting-equipment-render-session.ts`

* Remove `"window"` as a Foundry render intent.
* Make `"preview"` render only `EQUIPMENT_DETAIL_PART`.
* Search/facet completion should set a new projection on the catalogue controller rather than replace catalogue HTML.
* Stop using a bounded pane as the only retained browse state; retain a separate lightweight full projection. The current session explicitly rejects more than the maximum mounted page.

## `equipment-acquisition-runtime-service.ts`

Split the current `uiAdapter.project` into:

```ts
projectBrowse(criteria): Promise<EquipmentBrowseProjection>
enrichBrowsePrice(sourceUuid, context): Promise<ExactBrowsePrice>
prepareLine(...): Promise<PreparedLine> // unchanged authority
```

Move these out of window changes:

* `fingerprintActorPricingContext`
* drafted-size resolution
* filter/rank
* facets
* line-record assembly

Compute them when their semantic inputs change.

## `equipment-catalogue-service.ts`

* Keep its existing full projection and pack invalidation machinery.
* Add fields needed by a conservative price-proof classifier.
* Add a pure criteria-projection layer above `entries`.
* Keep `hydratePreview`, `resolveForApply`, and fresh apply resolution separate.
* Split raw document hydration from synchronous PF2E preparation.

## `starting-equipment-result-window.ts`

Replace domain-style `{offset, limit}` loading state with pure virtual geometry:

```ts
visibleRange()
directionalOverscanRange()
rangeCoversViewport()
```

Remove hydration chunk size and prefetch concurrency from this module; they belong in the enrichment scheduler, not list geometry.

## `equipment-virtual-list-dom.ts`

Replace the skeleton-band implementation with:

* Stable canvas
* Keyed row pool
* `patchEquipmentRow`
* Focus pinning
* Optional anchor capture for projection changes

No DOM geometry read should be required during ordinary fixed-height scrolling.

## `picker-search-scheduler.ts`

Keep it for debounced criteria projection. Do not route viewport changes through it. Its abort/current-revision model remains useful for search and filter changes, where asynchronous projection is legitimate.

---

# Staged migration

## Stage 0: Instrument the current system

Add the marks, long-task observer, visible-gap sampling, stale-work counters, and deterministic perf fixtures. Do not change behavior.

## Stage 1: Extract and cache the complete lightweight projection

Create `EquipmentBrowseProjection` and move filtering, ranking, facets, result count, actor pricing context, and size resolution to criteria revisions. Continue slicing it through the current Handlebars UI temporarily.

This should establish whether projection/fingerprint work is itself significant.

## Stage 2: Introduce explicit price states

Use indexed rows immediately. Classify rows as `exact`, `pending`, or `unavailable`. Preserve current document preparation as the asynchronous resolver for `pending`.

All transaction actions continue through existing fresh-authority methods.

## Stage 3: Mount the stable virtual-list controller

Render only an empty catalogue host through Handlebars. Attach the controller in the ApplicationV2 lifecycle and reattach/dispose it when a genuine Foundry render replaces the host.

Remove `"window"` from the application render scheduler.

## Stage 4: Add the prioritized enrichment scheduler

Separate document-fetch concurrency from single-lane PF2E preparation. Add semantic cache keys, viewport demand, reprioritization, and wasted-work metrics.

## Stage 5: Fix row geometry and complete accessibility

Move verbose facts into detail view, establish fixed row height, pin focus, test list semantics, live-region behavior, paging fallback, reduced motion, and screen readers.

## Stage 6: Add image loading

Start with visible-only images and a zero-layout-shift budget. Expand prefetch only after measuring decode and resource costs.

## Stage 7: Worker or persistent cache only if justified

Do this only if the direct list is smooth but cold projection still violates the long-task contract.

Verification should cover:

* Heights around 820, 1,200, and 1,500 px
* Widths around 760–1,240 px
* Trackpad, mouse wheel, scrollbar dragging, Page Up/Down, Home/End
* Large programmatic jumps
* Rapid query and facet changes
* Policy, source, target-level, size, and actor-pricing changes
* Pack invalidation during pending work
* Hydration/preparation failures
* Non-GM users
* Focused rows leaving the viewport
* Screen readers and keyboard-only operation
* Reduced motion
* Exact purchase/apply parity
* Assertions that scrolling never mutates actor, draft, or kit

---

# Direct answers to the numbered design questions

|  # | Answer                                                                                                                                       |
| -: | -------------------------------------------------------------------------------------------------------------------------------------------- |
|  1 | **Yes.** Use a stable host and direct keyed row patching; no Foundry render for scrolling.                                                   |
|  2 | **Yes.** Browse DTO, asynchronous enrichment, and fresh transaction authority should be separate types and services.                         |
|  3 | **Yes.** Retain all 1,138 lightweight rows; the catalogue service already retains a complete entry projection.                               |
|  4 | Use a conservative, versioned exact-index proof. Prepare only rows that cannot be proven exact.                                              |
|  5 | Prefer exact-or-pending. A visible “base price” can be acceptable, but not an unlabeled provisional transaction price.                       |
|  6 | In-memory cache and prewarm first; worker if cold CPU remains high; persistent cache last.                                                   |
|  7 | Scroll plus synchronous emergency coverage plus one rAF. IntersectionObserver only for images/hints.                                         |
|  8 | A fixed-height inner canvas with absolutely positioned, keyed recycled rows.                                                                 |
|  9 | Semantic generations, one prioritized preparation lane, deduped hydration, checks before sync prep and before commit.                        |
| 10 | Uniform rows. If impossible, retain all heights in a Fenwick tree and correct against a stable anchor.                                       |
| 11 | Directional DOM overscan; velocity-aware enrichment; jump directly to destinations and never prepare skipped paths.                          |
| 12 | List/listitem semantics, pos/set attributes, stable DOM order, pinned focused row, sentinel fallback.                                        |
| 13 | Stage-level User Timing, long tasks, LoAF, forced layout, cache hits, and stale-work counters plus the A/B matrix.                           |
| 14 | Use visible rows plus bounded overscan. It should grow with viewport height but should not range up to 144 merely to hide hydration latency. |
| 15 | Instrument, extract projection, separate prices, introduce stable DOM, add scheduler, then accessibility/images/worker.                      |

---

# Foundry- and PF2E-specific assumptions to verify

The public Foundry v14 API documentation currently identifies itself as 14.365, while the inspected runtime is 14.366; Foundry also released 14.367 on August 18, 2026. Verify exact 14.366 source/type behavior and smoke-test 14.367 rather than assuming the public documentation precisely matches the target build. ([Foundry Virtual Tabletop][8])

Foundry parts can declare `scrollable` selectors, and its directory implementations expose part-state synchronization hooks. Verify whether those are useful for preserving scroll on the **rare real part replacement**, but do not mistake them for a virtualization mechanism. ([Foundry Virtual Tabletop][9])

The current Foundry adapter asserts `"stable-replacement"` index-entry identity and forwards `getIndex`, `getDocument`, `getDocuments`, `set`, and `delete`. That identity behavior and all relevant pack invalidation hooks should be tested against 14.366 rather than treated as an undocumented permanent guarantee.

Verify under a non-GM account:

* Requested index fields are returned
* `getDocument` and exact refresh operations are permitted
* Cached compendium documents do not violate freshness assumptions
* Pack create/update/delete invalidation reaches the catalogue controller

Finally, transient actor preparation constructs a temporary PF2E actor with the candidate item embedded and reads back the prepared item.  Treat that as a PF2E-version-pinned integration surface and keep parity tests around it.

The core design principle is simple: **the catalogue should always have enough lightweight information to paint any destination immediately; expensive PF2E work may refine what is painted, but must never determine whether a row exists.**

[1]: https://foundryvtt.com/api/v14/classes/foundry.applications.apps.GridConfig.html "https://foundryvtt.com/api/v14/classes/foundry.applications.apps.GridConfig.html"
[2]: https://github.com/foundryvtt/pf2e/blob/pf2e-8.4.1/src/module/item/physical/document.ts "https://github.com/foundryvtt/pf2e/blob/pf2e-8.4.1/src/module/item/physical/document.ts"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API "https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver "https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver"
[5]: https://www.w3.org/TR/wai-aria-1.2/ "https://www.w3.org/TR/wai-aria-1.2/"
[6]: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback "https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback"
[7]: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming "https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming"
[8]: https://foundryvtt.com/api/v14/classes/foundry.canvas.perception.FogManager.html "https://foundryvtt.com/api/v14/classes/foundry.canvas.perception.FogManager.html"
[9]: https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.JournalDirectory.html "https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.JournalDirectory.html"
