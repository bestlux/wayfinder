# Starting-equipment UX handoff

> **Implementation status (2026-08-23, released in 0.8.2).** This handoff records
> the pre-implementation findings that shaped the 0.8.2 catalogue work; its
> present-tense problem statements and original 12-row/550-element/144-result-
> element envelope are historical. The release replaces the fixed 12-row
> shelf with an adaptive stable virtual list, ranks and facets the complete
> lightweight shelf, and projects only mounted rows. Items 1a, 1b, 2, 3a, 4, 6,
> 7, and 8 are complete; item 3b (funding-aware affordability) and item 5 (row
> quick-buy) remain deferred. Current limits live in
> `tools/foundry-interaction/equipment-catalogue-profile.json`.
>
> Two clean 840-sample runs at production commit
> `b5e51e7e473193144783b4bde3278a046c6d8ee7` passed with zero failed samples
> and zero long tasks. Their overall p95 values were 52.8 ms and 53.3 ms; their
> worst action/width p95 values were 66.9 ms and 64.8 ms. Exact candidate
> `2495078a752522688e1bbc54e642ae742c092475` completed package binding and
> publication; the public ZIP SHA-256 is
> `3a4bf49dd9506896e6c611c6829f2d781373511cfb31d9ee820a2f69583a464e`.
> Release 0.8.3 only corrects the shared item-level policy and does not change
> this virtual-list envelope.

> Follow-on work after the 0.8.0 visual rebuild of the starting-equipment views
> (`feat(equipment): rebuild the starting-equipment views on the app's design language`).
> The rebuild covered layout, copy, and theming. This document covers the
> behaviour that rebuild deliberately did not touch.

Everything below was verified against a live level-5 owner-operated draft in the
local testing world (Foundry 14.366, PF2E 8.4.1), not inferred from the source.

## The constraint that governs half of this list

`tools/foundry-interaction/equipment-catalogue-profile.json` freezes a measured
release envelope:

```
maxP95MsPerActionWidth: 75      maxDomElementCount:        550
maxResultDomElementCount: 144   maxImageRequestsPerSample:   0
maxLongTaskCountPerActionWidth: 0
```

`maxResultDomElementCount` is counted as *every descendant of
`.equipment-result-list`* (`browser-equipment-profile.js:512`). The original
budget of 12 allowed exactly one element per row, which is why the pre-rebuild
rows were a single `<button>` holding one `·`-joined sentence.

The visual rebuild deliberately spent more DOM to make each row scannable. A
guarded 140-sample rebaseline on Foundry 14.366 / PF2E 8.4.1 at candidate
`c753c6ae9b74fed9cd69fccd148c6d9d37bf4dfe` measured:

| Metric | Observed maximum/p95 | Frozen budget |
| --- | ---: | ---: |
| Root DOM elements | 537 maximum | 550 |
| `.equipment-result-list` descendants | 135 maximum | 144 |
| Overall action latency | 66.8 ms p95 | 75 ms per action/width |
| Worst warmed action/width | 74.9 ms p95 | 75 ms |
| Image requests / qualifying long tasks | 0 / 0 | 0 / 0 |

The 550 root ceiling leaves a narrow, explicit margin above the measured 537.
The 144 result ceiling corresponds to twelve rows at the static twelve-element
row-template cap and exceeds the observed 135 without weakening the fixed
12-row hydration window. The latency, image-request, and long-task budgets were
not relaxed.

**Item 0 is complete as a measurement and frozen-envelope change.** Two full
840-sample equipment runs and the exact-candidate coordinator passed before
0.8.2 publication. Future work that changes the row or pane structure must rerun
that same gate rather than raising these values from source reasoning alone.

---

## Original ranked backlog and disposition

| Rank | Value | Effort | Item | Status |
| ---: | :---: | :---: | --- | --- |
| 1a | P0 | S | Single source of truth for the result cap *(prerequisite for 1b)* | Complete |
| 1b | P0 | M–L | Reachability past the first 12 results (constant-size paging) | Complete via adaptive virtualization |
| 2 | P1 | S | Rank browse results by policy availability and relevance | Complete |
| 3a | P1 | S | "Policy-available only" facet | Complete |
| 3b | P2 | M | "Only what I can buy" — needs a funding projection | Deferred |
| 4 | P1 | S | Titan Mauler eligibility facet | Complete |
| 5 | P2 | S | Row-level quick-buy | Deferred |
| 6 | P2 | M | Bulk and hands from the hydrated preview *(do with polish B1)* | Complete |
| 7 | P3 | S | Trait facet | Complete |
| 8 | P3 | S | Retire the dead `EquipmentCatalogueSearchFilters` API | Complete |

Item 8 is a prerequisite in practice for 3a, 3b, 4 and 7: all four add predicates,
and adding them across two parallel filter implementations doubles the work and
the drift surface. Consolidate first.

> **Revision note.** Items 1b, 2, 3 and 6 were corrected after review. The
> original text proposed a growing "Show more" window that its own performance
> envelope forbids, treated affordability filtering as cheap when the data does
> not exist at that layer, and proposed indexing bulk/hands across all 5856
> entries to serve detail-only data. Effort estimates in the original should not
> be trusted where they conflict with the sections below.

---

### 1a. Single source of truth for the result cap — P0, prerequisite

**Problem.** `MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS = 12` is exported from
`panes/starting-equipment-pane.ts:42` and consumed by
`starting-equipment-render-session.ts`, but the runtime service slices with a
bare literal `12` (`:410`). Two places, no link. Any paging work (item 1b) will
trip over this.

**Approach.** Move the constant to a shared module both layers already import
and use it in all three places. Do this first; item 1b is not safely
implementable until it lands.

---

### 1b. Reachability past the first 12 results — P0

**Problem.** The browse path caps at 12 results
(`equipment-acquisition-runtime-service.ts:410`, `matchedEntries.slice(0, 12)`)
with no paging of any kind. At level 5 that is 12 of 2283 level-qualified
entries. Combined with item 2's ordering problem, the default shelf reads
*Abysium Chunk → Abysium Ingot → Adamantine Chunk → Adamantine Ingot →
Adventurer's Pack → Adze → Agate → Air Bladder → Air Repeater → Aklys →
Alabaster → Alabaster and obsidian game set*. Nine of those twelve cannot be
bought under the default policy. **A player who does not already know an item's
name cannot reach it at all.** This is the single largest functional gap in the
step.

**Why the cap exists.** It is not arbitrary. Price preparation and hydration run
only over `visibleEntries`, *after* the slice (`:411` onward,
`equipmentBrowsePreparedRecordCacheKey`). Widening the page multiplies the
expensive work; widening the *match* set does not.

**Approach.** Add an offset to `StartingEquipmentUiRequest`
(`starting-equipment-ui-adapter.ts:6`) and thread it through the projection and
the pane.

**The window must stay a constant size.** An earlier draft of this item proposed
a cumulative "Show more" growing the window to 24. That is incompatible with this
document's own envelope: twelve rows already measure 135 descendants against a
frozen ceiling of 144, so a 24-row window lands near 270 and breaks the gate by
construction. Use one of:

- **Constant-size paging** — replace the window rather than grow it (previous /
  next, or a page selector). Keeps hydration cost and DOM flat, needs no
  rebaseline, and is the cheapest correct option.
- **Virtualization** — render a fixed number of rows over a longer scroll. Better
  feel, materially more work, and needs an intentional profile rebaseline of its
  own.

Do not raise `maxResultDomElementCount` to accommodate a larger rendered window
without a measured run; that ceiling was set from evidence, not preference.

**Acceptance.** From an empty query at level 5, a player can reach an item that
sorts after "A" without typing its name. Rendered rows per page stay constant.
`.equipment-result-list` descendants stay within the frozen budget on every
page.

---

### 2. Rank browse results by usefulness, not catalogue order — P1

**Problem.** Results are ordered by `compareEntries`
(`equipment-catalogue-service.ts:1348`): level, then name, then UUID. That is a
sensible *catalogue* order and it is computed once at projection time and cached.
It is a poor *shopping* order. It puts level-0 alphabetical trade goods and
crafting materials — Abysium, Adamantine, Agate, Alabaster — ahead of everything
a starting character would actually buy, and most of them are policy-blocked.

**Approach.** Sort `matchedEntries` at browse time, before the slice, not in the
cached projection.

**Only part of the intuitive sort key is available at that point.** The slice at
`:409` runs before prepared prices exist, and affordability, allowance
eligibility and `canAdd` are computed later in the pane
(`starting-equipment-pane.ts:110` onward). So:

- *Available now* — `entry.available`, i.e. policy availability — **is** known at
  the ranking layer and is cheap.
- *Affordable now* — requires funding state the ranking layer does not have. See
  item 3.

Rank on what is there: policy-available first, then a relevance term when a query
is present (exact name → prefix → substring), then the existing level/name/UUID
tiebreak for stability. That alone moves the blocked crafting materials off the
first page.

This is cheap: one sort over already-filtered, un-hydrated entries, strictly
before the expensive hydration. It needs no profile rebaseline, and it makes the
12-row cap far less painful even before item 1b lands. It does **not** on its own
make results past the first page reachable — that is item 1b, and ranking is not
a substitute for it.

**Acceptance.** With an empty query at level 5 under a common-only policy, the
first screen is dominated by items the character can actually buy. Result order
is deterministic for a given query, filter set, and funding state.

---

### 3. Availability facets — 3a P1, 3b P2

**Problem.** There is no way to hide what you cannot buy. Under the default
policy most of the catalogue is either policy-blocked or unaffordable, and the
rebuild can only *mark* those rows (dimmed, struck-through price, inline
reason) — it cannot remove them.

**These are two facets with very different costs, and an earlier draft of this
item conflated them.**

**3a — "Policy-available only". Cheap.** `matchesCatalogueRequest`
(`equipment-acquisition-runtime-service.ts:1873`) already iterates
`request.filters` generically against a hardcoded key→field map covering
`rarity`, `source`, and `type`. `entry.available` is on the entry at that point,
so adding an `availability` key is a few lines there plus a facet in the pane.
This removes the policy-blocked rows, which are the bulk of the noise.

**3b — "Only what I can buy". Not cheap.** Currency affordability, allowance
eligibility and `canAdd` do not exist at the filtering layer. They are derived in
the pane (`starting-equipment-pane.ts:110` onward) from prepared prices, the
remaining budget and the active recipe's allowances — all *after* the slice at
`:409`. Filtering on them requires either a preliminary funding projection over
the matched set before slicing, or restructuring the pipeline so funding state is
available earlier. Treat 3b as its own piece of work, sized accordingly, and do
not bundle it into 3a's estimate.

**Recommendation.** Ship 3a. Defer 3b until someone has decided whether the
funding projection is worth its cost, given that per-row marking already
communicates unaffordability and item 2's ranking demotes blocked items anyway.

**Acceptance (3a).** The toggle is discoverable in the filter row, its state
round-trips through the scoped re-render, and the result count reflects it.

---

### 4. Titan Mauler eligibility facet — P1

**Problem.** The Giant Instinct callout says to choose a Titan Mauler weapon
"on a weapon below", but the *Choose as Titan Mauler* control only appears in
the detail panel after previewing an item. With a 12-row cap and no eligibility
filter, finding an eligible weapon means previewing candidates one at a time and
hoping. The eligibility rule is non-obvious (level 0, common, melee or ranged,
≤9 gp, or a registered Access), so a player cannot pre-filter it mentally.

**Approach.** `titanMaulerEligible` is already computed per record
(`isPotentialTitanMaulerEntry`, `:1897`) and already reaches the pane. Surface it
as a facet, and auto-apply it while `activePane.titanMauler.required` is true and
nothing is selected yet.

**Acceptance.** With Giant Instinct drafted and no weapon chosen, the shelf opens
pre-filtered to eligible weapons, and the filter is visibly applied and
clearable.

---

### 5. Row-level quick-buy — P2

**Problem.** Buying costs two round-trips: preview the row, then press *Buy with
coin* in the detail panel. Each is a scoped re-render. For a player buying eight
pieces of adventuring gear that is sixteen interactions where eight would do.

**Why it was left out.** It adds a second interactive element per row (DOM
budget) and it contradicts an explicit existing invariant — every
`add-equipment-item` action is mounted only in the selected detail part, asserted
in `tests/wayfinder-starting-equipment-pane.test.ts` and relied on by the search
isolation tests. That invariant is worth keeping deliberate, not breaking
casually.

**Approach.** Only render the control where funding is unambiguous —
`canBuyWithCurrency` and no allowance options — so the row never has to
disambiguate a funding lane. Items with allowance choices keep routing through
the detail panel, where the choice is presented properly. Update the invariant
assertion to "no *ambiguous* add-action outside the detail part" rather than
deleting it.

**Acceptance.** One click adds an unambiguously-funded item. Allowance-funded
items are unchanged. Focus lands somewhere sensible after the add.

---

### 6. Bulk and hands, from the hydrated preview — P2

**Problem.** `toUiRecord` hardcodes `bulkLabel: "See item details"` and
`handsLabel: null` (`:1859-1860`) because neither field is requested in
`INDEX_FIELDS` (`equipment-catalogue-service.ts:20`). The rebuild dropped both
rows rather than render "Bulk: See item details" and an empty "Hands:", so the
detail panel currently answers Level, Price, Rarity, Type, Source, and Traits —
and silently declines two questions a player buying armour and weapons genuinely
asks.

**Approach — take it from the hydrated preview, not the index.** An earlier draft
of this item proposed adding `system.bulk.value` and `system.usage.value` to
`INDEX_FIELDS`. That is the wrong trade: it pays to index two fields across all
5856 entries, bumps `EQUIPMENT_CATALOGUE_PROJECTION_VERSION`, and disturbs the
evidence contracts in `tests/foundry-equipment-profile-results.test.ts`
(`expectedCatalogueCounts.indexed` is pinned at 5856) — all to serve data that
is only ever shown for the one selected item.

`hydratePreview` already loads the complete document for the previewed item.
Bulk, hands/usage **and** the description (see `ux-polish-0.8.x.md` B1) can all
come from that same already-hydrated source. Do them together as one piece of
work on the preview path, and leave the index alone.

**Caution.** Runtime currently keeps only `preview.entry` and discards
`preview.source` (`equipment-acquisition-runtime-service.ts:397`), so this still
means threading new fields through runtime, the view-model and the template. The
detail template already renders bulk and hands conditionally, so that end is
ready. It is preview-latency work, not indexing work — profile accordingly.

---

### 7. Trait facet — P3

Free-text search already matches traits (`matchesCatalogueRequest:1877` joins
`entry.traits` into the searchable string), so typing "finesse" works today —
but nothing tells a player that, and there is no way to browse by trait. Given
the same generic filter plumbing as item 3, a trait facet is cheap. Lower
priority than availability because the trait vocabulary is large and needs its
own searchable panel, like the existing source panel.

---

### 8. Retire the dead `EquipmentCatalogueSearchFilters` API — P3

`EquipmentCatalogueSearchFilters` (`equipment-catalogue-service.ts:143`) declares
`traits`, `maximumLevel`, and `availability`, and `searchCatalogue` implements
all three (`:395-412`). Nothing calls it — the browse path uses
`matchesCatalogueRequest` instead. Either route the browse path through
`searchCatalogue` (which would make items 3 and 8 nearly free) or delete the
unused surface. Two parallel filter implementations is the worst of both.

Recommend investigating the first option *before* starting item 3, since it may
turn out to be the cheaper path to the same result.

---

## Explicitly out of scope

- **Item artwork in the catalogue — under the current frozen envelope.** The
  zero-image-request budget makes row artwork a non-starter today, and Font
  Awesome type glyphs carry type identity at zero network cost, which is what the
  rebuild ships. This is a release constraint, not a permanent UX judgement: a
  single image for the *selected* item, or virtualized rows with lazily loaded
  artwork, would be reasonable to revisit against an explicit new budget.
- **Raising `maxImageRequestsPerSample` or `maxLongTaskCountPerActionWidth`.**
  Both are currently satisfied. Leave them frozen.
- **The GM equipment-policy settings dialog** (`templates/equipment-policy-config.hbs`).
  It is a plain Foundry form and correctly inherits Foundry's theme; it is not
  part of the player purchase flow.
