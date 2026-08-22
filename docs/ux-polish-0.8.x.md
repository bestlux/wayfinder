# UX polish backlog — 0.8.x

> Companion to [equipment-ux-handoff.md](equipment-ux-handoff.md), which stays the
> authority on the starting-equipment catalogue. This document covers the rest of
> the app, plus equipment items discovered after that handoff was written.
>
> Findings are from source inspection at `6b455ad` plus the live level-5 session
> recorded during the 0.8.0 visual rebuild. Where something was reasoned from
> source rather than observed running, it says so.

## Reading order

Sections A and C are cross-cutting and mostly cheap. Section B extends the
equipment handoff. Section D is the ambitious end and is deliberately separated,
because none of it should displace A–C.

---

## A. Cross-cutting — the wizard rail

### A1. Collapse completed levels in the rail — P1, M

**Problem.** `.wizard-step-list` renders one flat button per step with a divider
between levels (`wayfinder-app.hbs`, `firstInLevel`). A level-5 character has 21
steps; a Fighter run to 20 has several dozen. Once level 1 is settled, its ten
rows are pure scrolling cost, and they push the level the player is actually
working on below the fold.

**Approach.** Group `stepRows` into level sections in
`wayfinder-context-service.ts:131-141` — the data is already there, `firstInLevel`
is just a flattened signal of it. Render each level as a disclosure with a
one-line summary (level number, N of M complete, and a warning marker when any
child step is invalidated).

**The part worth getting right is the collapse rule.** Derive it; do not store it
as plain per-level state, or it will fight the player:

- Default collapsed when every step in the level is complete **and** it is not
  the active level.
- Default expanded when the level is active, or contains any incomplete step.
- **Force expanded when any child step is `invalidated`,** and clear any player
  override at that moment. This is the behaviour asked for: a later choice
  invalidating an earlier one must re-open that level rather than hide a problem
  behind a collapsed summary.
- A manual toggle overrides the default for that level only, and is discarded
  when the level's invalidation state changes.

**Acceptance.** A level-10 draft with levels 1–4 complete opens showing four
collapsed summaries and the active level expanded. Changing a class feat that
invalidates a level-2 skill choice re-opens level 2 with its marker visible,
even if the player had collapsed it by hand.

**Note.** This interacts with A2 — collapsing reduces the rail's height, which
makes the lost scroll position less painful but does not fix it.

### A2. The rail loses its scroll position on every re-render — P1, S

**Problem.** Scroll restoration is opt-in via `data-wayfinder-scroll-id`
(`actions.ts:115-127`). Every scrollable region in every pane carries one.
`.wizard-step-list` does not. Every re-render therefore snaps the rail back to
the top.

**Observed.** During the 0.8.0 rebuild session this reproduced repeatedly: after
a re-render, a scripted click on the level-5 equipment step landed on a
level-4 step instead, because the rail had scrolled back to the top between the
render and the click. A player experiences it as the rail jumping away while
they work.

**Approach.** Add `data-wayfinder-scroll-id="rail:steps"` to the rail list. One
attribute; the existing machinery does the rest.

Consider also scrolling the active step into view when the active step changes
for a reason other than a direct rail click — Next/Previous navigation and
`applyBlocker` jumps currently move the active step without guaranteeing it is
visible.

---

## B. Equipment — additions to the handoff

These are new; the eight items in `equipment-ux-handoff.md` still stand.

### B1. The detail panel never shows what an item does — P0, S

**Problem.** The equipment detail panel answers Level, Price, Rarity, Type,
Source and Traits. It never shows the item's description. A player cannot read
what a Bag of Holding, an Alchemist's Toolkit, or a Thieves' Tools actually does
before spending on it. The feat and spell pickers show full enriched prose in the
same screen position (`pick-pane.hbs`, `.preview-description`).

This is the largest remaining content gap in the shopping experience, and
arguably a worse one than the catalogue cap, because no amount of filtering
compensates for not knowing what you are buying.

**Why it is cheap.** `hydratePreview`
(`equipment-catalogue-service.ts:421`) already fetches the full document and
returns it as `EquipmentCataloguePreview.source`; the description is in memory
the moment a row is previewed. The picker already has the helper:
`pick-pane.ts:111` does `enrichHtml(String(system.description?.value ?? ""), { async: true })`.
Project the same field onto the equipment preview view-model and render it in
`starting-equipment-detail.hbs` with the existing `.prose` treatment.

**Cost to watch.** Enrichment is async and per-preview. The profile measures
preview latency (`timingSemantics.previewPrimary`, both new and repeat preview
hydrations) so this needs a profile run, but it does **not** touch the row list
and so does not affect `maxResultDomElementCount`.

**Acceptance.** Previewing an item shows its rules text, enriched consistently
with the feat picker. Repeat previews of the same item stay within the frozen
preview latency budget.

### B2. Quantity is ±1 only — P1, S

**Problem.** Cart quantity is two buttons with `data-delta="-1"` and
`data-delta="1"` (`starting-equipment-cart.hbs:43`). There is no direct entry.
Buying 40 sling bullets is 40 clicks and 40 scoped re-renders, each recomputing
line pricing. Ammunition and consumables are exactly the goods bought in bulk.

**Approach.** Replace the static `<strong>` between the steppers with a small
number input that commits on change/blur, keeping the ± buttons for fine
adjustment. The command service already validates quantity changes; route the
typed value through the same path rather than adding a second one.

Worth pairing with a sane clamp and a clear message when a quantity would exceed
the remaining budget, rather than silently refusing.

**Acceptance.** A player can type a quantity directly. One commit, one
re-render, one price recomputation. The ± buttons still work.

### B3. Equipment has no level filter — P2, S

**Problem.** The picker has a level *range* control
(`picker-filters.ts`, `PickerLevelRangeGroupState`) with paired From/Through
bounds. Equipment has no level facet at all, even though every item carries a
level, permanent-item allowances are level-bound, and the recipe's maximum level
is the thing that defines the shelf. A player with a level-4 allowance has no way
to say "show me level 3–4 permanent items".

**Approach.** Reuse the picker's level-range vocabulary rather than inventing a
third control shape. See A-note in C3 about converging these.

### B4. Equipment filter options have no counts — P3, S

Picker filter options render `{{count}}` per option
(`picker-filter-bar.hbs`). Equipment rarity/source options render a label and a
checkmark only. Counts are what make a facet worth opening; without them a
player is guessing whether "Uncommon" has three items or three hundred behind it.

### B5. Kit contents deserve a real disclosure — P3, S

Kit expansion already works — `kitExpansion.items` reaches the cart with parent
paths intact — but renders as an inline text run of `↳ 1 × Rope` fragments inside
the line. An Adventurer's Pack is ten-plus entries. A collapsed count with a
disclosure would read better and would use the space the current run wastes.

---

## C. Cross-cutting — search, sort, and filter

### C1. Nothing in the app can be sorted — P1, M

**Problem.** There is no sort control anywhere: not in the equipment catalogue,
not in the feat picker, not in the spell picker. Ordering is whatever the
underlying projection produced. For equipment that is level-then-name
(`compareEntries`); for pickers it is the option query's order.

Sorting by price, by level, or by name is table stakes for any shopping list, and
"cheapest first" is how a budget-constrained player actually shops. Handoff item
2 fixes the *default* order for equipment, which is the higher-value half of
this, but it does not give the player control.

**Approach.** One shared sort control, placed consistently, with a per-pane set
of keys (equipment: price / level / name; pickers: level / name). Like handoff
item 2, sort before the hydration slice so it costs a comparison pass and not a
round of document preparation.

### C2. Result counts are announced in equipment and silent everywhere else — P1, S

**Problem.** The equipment result count carries `role="status" aria-live="polite"
aria-atomic="true"` (`starting-equipment-catalogue.hbs`). The picker's count is a
bare `<h4>` with no live region (`picker-result-count.hbs`). A screen-reader user
typing in the feat or spell search gets no feedback that the result set changed —
in the panes they will use most.

Grepping live regions across templates: equipment has six, every other pane has
zero.

**Approach.** Give `picker-count` the same treatment. Also reconsider `<h4>` for
a changing count — a heading whose text is a live number is odd semantically, and
it is the reason the count reads as a section title rather than status.

While there: the suppression notice ("7 options hidden because Wayfinder cannot
yet validate a choice they grant") is genuinely good, honest copy, but it sits in
small text beside the count and is easy to miss. It explains why a player cannot
find a feat they expect, so it deserves more weight than it currently gets.

### C3. Three parallel filter implementations — P2, M

The app now has three filter models with three different control shapes:

| Surface | State | Controls |
| --- | --- | --- |
| Feat / spell picker | `PickerFilterState` (`levelRange`, `rarity`, `source`) | Dropdown menus, option counts, badge, level range |
| Equipment | `activeFilters: Record<string, string[]>` | Inline type chips, rarity/source disclosure panels, source search |
| Skill / language / boost / class-choice | none | — |

Each learned something the others lack: the picker has counts and a level range;
equipment has a searchable source panel and inline chips for the primary facet.
Neither is wrong, but a player moving between steps meets a different filter idiom
each time.

**Approach.** Converge the *vocabulary and behaviour* — counts everywhere, one
disclosure shape, one "clear filters" affordance, one selected-state treatment —
without forcing a single generic component through two genuinely different data
models. Cheapest first: adopt counts in equipment (B4) and the searchable panel
in the picker's source menu.

This is also the natural moment to resolve handoff item 8: two filter
implementations in equipment alone (`matchesCatalogueRequest` versus the unused
`EquipmentCatalogueSearchFilters`) is the worst starting point for converging
three.

### C4. No `prefers-reduced-motion` handling — P2, S

Roughly sixty `transition` declarations across the stylesheets and no
`@media (prefers-reduced-motion: reduce)` block anywhere. One media query in
`tokens-base.css` neutralising transition durations covers the whole app.

### C5. Search affordances are inconsistent — P3, S

Equipment has a "Reset" button always present. The picker has "Clear filters"
that appears only when a filter is active, and no equivalent for the search text.
Neither offers an in-field clear. Pick one pattern.

### C6. Language and Lore selection could use a filter — P3, S

The language pane renders a flat grid of every available language
(`language-choice-pane.hbs`). In a campaign with the full common/uncommon/rare
set that is a large grid to scan. The 16 core skills do not need search; languages
and free-text Lore probably do. Low priority — the grid is at least scannable,
which the pre-rebuild equipment list was not.

---

## D. Bigger bets — immersion and completion

The roadmap already names the gap: *"the largest remaining product gaps are a
satisfying character-completion chapter and high-level caster evidence beyond
level 10."* These are ideas for the first half of that, ordered by confidence.

### D1. Show scores, not just modifiers, in the boost pane — P1, S

`abilitySummary` projects `modifierLabel` and `partial` only
(`boost-pane.ts:37-42`). PF2E players think in both scores and modifiers, and the
interesting information during levelling is the *change*: `STR 16 → 18`. The
pane's own eyebrow promises "Where your modifiers land", and it under-delivers by
showing only the landing value with no journey.

`effectiveBuildState.projectedAbilities` is already the source; check whether the
score and the pre-boost value are available there before committing to this.

### D2. A completion chapter — P2, L

Apply currently ends with a receipt (`acquisition-receipt.hbs`): applied-by,
applied-at, spent, remaining, item rows. It is an audit artifact, and a good one.
It is not an ending.

The moment a character becomes table-ready is the emotional peak of the whole
flow and Wayfinder currently spends it on a table of provenance. A closing
chapter — the character's name and ancestry/class line, what they carry, what
they can do, what changed at this level — would cost little and would be the
single most memorable screen in the module. Keep the receipt; put it behind a
disclosure under the chapter.

This is explicitly a product decision, not a polish item, and it should not jump
the queue ahead of section A.

### D3. Starting-kit shortcuts — P2, M

PF2E ships class kits, and the catalogue already understands kit expansion. A
short list of "typical kit for a Swashbuckler" — a handful of pre-filled carts a
player can take wholesale and then edit — would turn the hardest part of the step
(facing 2283 items with no idea what a level-1 character needs) into a starting
point.

**Caution.** This edges toward recommending choices rather than guiding them,
which the product thesis is careful about. Framing matters: "a common starting
kit" that is visibly editable, not "recommended gear". Worth a design decision
before any implementation.

### D4. Budget pacing feedback — P3, S

The purse meter shows spent versus remaining. It does not say whether the player
is spending sensibly. A light touch — marking when the entire budget is committed
to one item, or when nothing has been spent on the basics — would help
first-time players without prescribing choices. Easy to overdo; keep it to at
most one non-blocking note.

---

## Suggested 0.8.x ordering

Cheap and high-value first, and deliberately front-loading the two items that
cost almost nothing:

1. **A2** rail scroll (one attribute) and **C4** reduced motion (one media query).
2. **B1** item descriptions — biggest content gap, low structural risk.
3. **C2** live regions for picker result counts.
4. Handoff **1a → 2 → 3** (cap constant, ranking, availability facet) — the
   equipment reachability chain.
5. **A1** rail collapse.
6. **B2** quantity entry.
7. Everything else by the ranking above.

Items needing a profile rerun: **B1** (preview latency only), plus handoff 1b and
5. **A1**, **A2**, **B2**, **C2** and **C4** touch the rail, the cart or the
stylesheet rather than the catalogue row list, so they do not disturb
`maxResultDomElementCount`; confirm against `maxDomElementCount` before assuming
the same for A1, which adds per-level disclosure elements to the rail.
