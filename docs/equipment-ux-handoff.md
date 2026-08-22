# Starting-equipment UX handoff

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
maxP95MsPerActionWidth: 75      maxDomElementCount:        325
maxResultDomElementCount: 12    maxImageRequestsPerSample:   0
maxLongTaskCountPerActionWidth: 0
```

`maxResultDomElementCount: 12` is counted as *every descendant of
`.equipment-result-list`* (`browser-equipment-profile.js:512`), so with 12 rows
on screen the pre-rebuild budget allowed exactly one element per row. That is
why the original rows were a single `<button>` holding one `·`-joined sentence.

The rebuild already exceeds this. Measured live at 1550px with 12 rows:

| Metric | Pre-rebuild | Post-rebuild | Budget |
| --- | ---: | ---: | ---: |
| Root DOM elements | 331 | 479 | 325 |
| `.equipment-result-list` descendants | 12 | 135 | 12 |
| Image requests per sample | 0 | 0 | 0 |

The profile JSON was **not** edited, because re-baselining a qualification
artifact without a live run would be fabricating qualification.
`tests/foundry-equipment-profile-results.test.ts` still passes (it validates the
JSON, which is unchanged); an actual `run-equipment-profile.mjs` run will now
fail on both DOM budgets.

**Item 0, and a prerequisite for items 1b and 5: re-run the equipment profile and
re-baseline `maxDomElementCount` and `maxResultDomElementCount` against measured
p95, or explicitly reject the richer rows.** Keep `maxImageRequestsPerSample: 0`
and `maxLongTaskCountPerActionWidth: 0` as they are — the rebuild honours both,
and item art is not worth spending that budget on.

---

## Ranked backlog

| Rank | Value | Effort | Item | Needs profile re-baseline |
| ---: | :---: | :---: | --- | :---: |
| 1a | P0 | S | Single source of truth for the result cap *(prerequisite for 1b)* | No |
| 1b | P0 | M | Reachability past the first 12 results | Yes |
| 2 | P1 | S | Rank browse results by usefulness, not catalogue order | No |
| 3 | P1 | S | Affordability / availability facet | No |
| 4 | P1 | S | Titan Mauler eligibility facet | No |
| 5 | P2 | S | Row-level quick-buy | Yes |
| 6 | P2 | M | Index `bulk` and `usage` so the detail panel can answer | No |
| 7 | P3 | S | Trait facet | No |
| 8 | P3 | S | Retire the dead `EquipmentCatalogueSearchFilters` API | No |

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

**Approach.** Add an offset/window to `StartingEquipmentUiRequest`
(`starting-equipment-ui-adapter.ts:6`) and thread it through the projection and
the pane. Keep the hydrated window at 12–24 and page it, rather than raising the
cap to a large number — that preserves the per-render hydration cost that the
budget was built around. A "Show more" control that grows the window in
increments is simpler than true pagination and matches how the picker panes
behave.

**Acceptance.** From an empty query at level 5, a player can reach an item that
sorts after "A" without typing its name. The hydrated row count per render stays
bounded. `.equipment-result-list` descendants stay within the re-baselined
budget at the largest window.

---

### 2. Rank browse results by usefulness, not catalogue order — P1

**Problem.** Results are ordered by `compareEntries`
(`equipment-catalogue-service.ts:1348`): level, then name, then UUID. That is a
sensible *catalogue* order and it is computed once at projection time and cached.
It is a poor *shopping* order. It puts level-0 alphabetical trade goods and
crafting materials — Abysium, Adamantine, Agate, Alabaster — ahead of everything
a starting character would actually buy, and most of them are policy-blocked.

**Approach.** Sort `matchedEntries` at browse time, before the slice, not in the
cached projection. Suggested key: buyable-now first (`entry.available` and
affordable under current funding), then a relevance term when a query is present
(exact name match → prefix match → substring), then the existing
level/name/UUID tiebreak for stability.

This is cheap: it is one sort over already-filtered, un-hydrated entries, and it
strictly precedes the expensive hydration. It does not require the profile
re-baseline, and it makes the 12-row cap far less painful even before item 1b
lands.

**Acceptance.** With an empty query at level 5 under a common-only policy, the
first screen is dominated by items the character can actually buy. Result order
is deterministic for a given query, filter set, and funding state.

---

### 3. Affordability / availability facet — P1

**Problem.** There is no way to hide what you cannot buy. Under the default
policy most of the catalogue is either policy-blocked or unaffordable, and the
rebuild can only *mark* those rows (dimmed, struck-through price, inline
reason) — it cannot remove them.

**Approach.** `matchesCatalogueRequest`
(`equipment-acquisition-runtime-service.ts:1873`) already iterates
`request.filters` generically against a hardcoded key→field map covering
`rarity`, `source`, and `type`. Adding an `availability` key is a few lines
there plus a facet in the pane view-model. The pane already computes
`affordable` and `canAdd` per record, so the labels and counts are free.

Recommend a single default-on toggle ("Only what I can buy") rather than a
three-way filter — the underlying distinction between *policy-blocked* and
*unaffordable* is already communicated per-row, and a tri-state control here
costs more than it explains.

**Acceptance.** The toggle is discoverable in the filter row, its state
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

### 6. Index `bulk` and `usage` so the detail panel can answer — P2

**Problem.** `toUiRecord` hardcodes `bulkLabel: "See item details"` and
`handsLabel: null` (`:1859-1860`) because neither field is requested in
`INDEX_FIELDS` (`equipment-catalogue-service.ts:20`). The rebuild dropped both
rows rather than render "Bulk: See item details" and an empty "Hands:", so the
detail panel currently answers Level, Price, Rarity, Type, Source, and Traits —
and silently declines two questions a player buying armour and weapons genuinely
asks.

**Approach.** Add `system.bulk.value` and `system.usage.value` to `INDEX_FIELDS`
and normalize them alongside price and traits. The detail template already
renders both rows conditionally, so the UI needs no change once the data
arrives.

**Caution.** `INDEX_FIELDS` feeds `normalizeIndexEntry` and the projection
`cacheKey`/`previewIdentity` fingerprints. Expect to bump
`EQUIPMENT_CATALOGUE_PROJECTION_VERSION` and re-check the evidence contracts in
`tests/foundry-equipment-profile-results.test.ts`
(`expectedCatalogueCounts.indexed` is pinned at 5856). This is the reason it was
not bundled into the visual work.

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

- **Item artwork in the catalogue.** Worth less than the image-request budget it
  would spend. Font Awesome type glyphs carry type identity at zero network
  cost, which is what the rebuild ships.
- **Raising `maxImageRequestsPerSample` or `maxLongTaskCountPerActionWidth`.**
  Both are currently satisfied. Leave them frozen.
- **The GM equipment-policy settings dialog** (`templates/equipment-policy-config.hbs`).
  It is a plain Foundry form and correctly inherits Foundry's theme; it is not
  part of the player purchase flow.
