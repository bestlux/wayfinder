# UX polish backlog — 0.8.x

> **Implementation status (2026-08-23, 0.8.2 candidate).** The detailed
> findings below are retained as the design record for the 0.8.x polish pass,
> but their present-tense problem statements describe the pre-implementation
> app. The candidate completes A1, A2, B1–B4, C2, C4, and the equipment-predicate
> portion of C3. B5, C1, cross-surface C3, C5, C6, and D1–D4 remain backlog. The
> equipment catalogue's authoritative current behavior and measured envelope
> live in `tools/foundry-interaction/equipment-catalogue-profile.json`, not in
> the original estimates below.

> Companion to [equipment-ux-handoff.md](equipment-ux-handoff.md), which records
> the original starting-equipment catalogue backlog. This document covers the
> rest of the app, plus equipment items discovered after that handoff was written.
>
> Findings are from source inspection at `6b455ad` plus the live level-5 session
> recorded during the 0.8.0 visual rebuild. Where something was reasoned from
> source rather than observed running, it says so.
>
> **Revised after review.** A1, A2, B1, C2, C4, D1, D2, D3 and the suggested
> ordering all carried errors in the first version — a wrong Apply lifecycle, two
> bad greps, pre-Remaster ability scores, and effort estimates that were too
> optimistic. Each correction is marked inline rather than silently patched, so
> the original reasoning stays auditable.

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

**The part worth getting right is the collapse rule.** The model is *derived
defaults plus ephemeral session overrides* — a manual toggle is inherently state,
so the goal is to keep that state minimal and short-lived, not to pretend it away:

- Default collapsed when every step in the level is complete **and** it is not
  the active level.
- Default expanded when the level is active, or contains any incomplete step.
- **Force expanded when any child step is `invalidated`.**
- A manual toggle overrides the default for that level only, lives in session
  state, and is not persisted to the draft.
- Clear a level's override when its invalidation state transitions from absent to
  present — **on that transition, not on every render while it stays
  invalidated.** Clearing continuously would re-open the level every render and
  make it impossible to collapse a level the player has chosen to set aside.

That transition rule is the behaviour asked for: a later choice invalidating an
earlier one re-opens that level once, rather than hiding a problem behind a
collapsed summary.

**Acceptance.** A level-10 draft with levels 1–4 complete opens showing four
collapsed summaries and the active level expanded. Changing a class feat that
invalidates a level-2 skill choice re-opens level 2 with its marker visible,
even if the player had collapsed it by hand.

**Note.** This interacts with A2 — collapsing reduces the rail's height, which
makes the lost scroll position less painful but does not fix it.

### A2. The rail loses its scroll position on every re-render — P1, S

**Problem.** Scroll restoration is opt-in via `data-wayfinder-scroll-id`
(`actions.ts:115-127`). `.wizard-step-list` scrolls and has no id, so every
re-render snaps the rail back to the top.

**And it is not the only one.** An earlier version of this item claimed every
other scrollable region carries an id. It does not. Six scroll containers have
`overflow: auto` and no `data-wayfinder-scroll-id`:

| Region | Introduced |
| --- | --- |
| `.wizard-step-list` | pre-existing |
| `.wizard-stage` | pre-existing |
| `.wayfinder-acquisition-receipt` | pre-existing |
| `.equipment-detail` | 0.8.0 visual rebuild |
| `.equipment-cart-lines` | 0.8.0 visual rebuild |
| `.equipment-source-filter-panel > div` | 0.8.0 visual rebuild |

Three of the six were introduced by the rebuild, so this is partly a regression
that shipped in 0.8.0, not only a pre-existing gap. Scrolled cart lines and a
scrolled detail panel both reset on the next re-render — and in the cart, a
re-render happens on every quantity change, so adjusting a line near the bottom
of a long kit throws the player back to the top.

**Observed.** During the 0.8.0 rebuild session this reproduced repeatedly: after
a re-render, a scripted click on the level-5 equipment step landed on a
level-4 step instead, because the rail had scrolled back to the top between the
render and the click. A player experiences it as the rail jumping away while
they work.

**Approach.** Add a `data-wayfinder-scroll-id` to each of the six. One attribute
each; the existing machinery does the rest. The rail and the cart are the two
that matter most.

Consider also scrolling the active step into view when the active step changes
for a reason other than a direct rail click — Next/Previous navigation and
`applyBlocker` jumps currently move the active step without guaranteeing it is
visible.

---

## B. Equipment — additions to the handoff

These are new. The items in `equipment-ux-handoff.md` still stand, with the
corrections applied there after review — note especially that handoff item 6
should now be delivered together with B1 below.

### B1. The detail panel never shows what an item does — P0, M

**Problem.** The equipment detail panel answers Level, Price, Rarity, Type,
Source and Traits. It never shows the item's description. A player cannot read
what a Bag of Holding, an Alchemist's Toolkit, or a Thieves' Tools actually does
before spending on it. The feat and spell pickers show full enriched prose in the
same screen position (`pick-pane.hbs`, `.preview-description`).

This is the largest remaining content gap in the shopping experience, and
arguably a worse one than the catalogue cap, because no amount of filtering
compensates for not knowing what you are buying.

**The data is already fetched — but currently thrown away.** `hydratePreview`
(`equipment-catalogue-service.ts:421`) loads the full document and returns it as
`EquipmentCataloguePreview.source`. Runtime then keeps only `preview.entry` and
**discards `preview.source`** (`equipment-acquisition-runtime-service.ts:397`).
So no re-fetch is needed, but the description has to be threaded through runtime,
the projection, the view-model, async enrichment, the template and tests. An
earlier version of this item called it cheap; it is a contained M, not an S.

The helper exists: `pick-pane.ts:111` does
`enrichHtml(String(system.description?.value ?? ""), { async: true })`. Render
into `starting-equipment-detail.hbs` with the existing `.prose` treatment.

**Do this together with handoff item 6.** Bulk and hands/usage come from the same
already-hydrated document. One piece of work on the preview path delivers all
three, and it removes the reason handoff item 6 wanted to index two more fields
across 5856 entries.

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

**Correcting an earlier count.** This document previously said every pane outside
equipment has zero live regions. That was a bad grep: it excluded
`templates/wayfinder-app.hbs`, which has three (the status note, the save status,
and the empty-planner status), and `compendium-source-config.hbs`, which has two.
The shell announces lifecycle state properly. The specific gap is narrower and
still real: **search result counts are announced in equipment and nowhere else.**

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

There is no `@media (prefers-reduced-motion: reduce)` block anywhere in the
stylesheets.

**Correcting an earlier count.** This document said "roughly sixty transition
declarations". The real figure is **22**; the earlier number counted lines
containing the substring `transition`, which is inflated by every use of the
`var(--wf-transition)` token. The fix is worth doing regardless, and 22 is small
enough that it is genuinely a one-query change.

Cover `animation` and `scroll-behavior` in the same block, not just `transition`
— any scroll-into-view added for A2 should respect the preference too.

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

### D1. Show modifier movement in the boost pane — P1, M

**Corrected.** An earlier version of this item asked for ability *scores*
(`STR 16 → 18`). That is pre-Remaster presentation: the PF2E Remaster removed
ability scores in favour of attribute modifiers, and the world runs PF2E 8.4.1.
Showing scores would be actively wrong for the system Wayfinder targets.

The real gap stands. `abilitySummary` projects `modifierLabel` and `partial` only
(`boost-pane.ts:37-42`), so the pane shows where a modifier landed but not that it
moved. The pane's own eyebrow promises "Where your modifiers land" and
under-delivers on the journey. Show the movement — `+3 → +4` — and make
partial-boost progress legible rather than a bare "Partial" tag.

**Not S.** `projectedAbilities` carries the projected modifier; it does not carry
a pre-step value to compare against. Sizing depends on where that baseline comes
from, which is a real question, not a lookup.

### D2. A completion chapter — P2, L–XL

**Correcting an earlier version of this item.** It claimed Apply ends on the
receipt and proposed putting that receipt behind a disclosure. That is not what
happens. A successful Apply **closes Wayfinder outright** —
`await this.close({ animate: false })` (`app-shell.ts:1091`). The acquisition
receipt is not an ending screen at all; it renders only if the player later
reopens Wayfinder on that actor.

So the moment a character becomes table-ready — the emotional peak of the entire
flow — is currently a window disappearing. That is a real product gap, and it is
the one the roadmap already names.

But the fix is not a template. There is no post-apply surface to put a chapter
on, so this needs a new lifecycle: a terminal state Apply transitions *into*
rather than closing from, with its own render path, its own dismissal, and a
decision about what happens on reopen. That is L–XL, not the "costs little" this
document originally claimed.

Worth doing. Not worth starting until sections A–C are done, and worth a design
note before any code.

### D3. Starting-kit shortcuts — P2, M

Facing 2283 items with no idea what a level-1 character needs is the hardest part
of the step. A short list of pre-filled, visibly editable starting carts would
turn it into a starting point.

**Correcting an earlier claim.** This document previously said "PF2E ships class
kits, and the catalogue already understands kit expansion", implying the
groundwork exists. It does not. `prepareAdventurersPackExpansion`
(`pf2e-kit-adapter.ts:36`) hard-throws for any UUID that is not the exact
Adventurer's Pack, and re-checks the document's slug and type before expanding.
Wayfinder supports precisely one qualified kit profile. Any class-kit feature
needs its own catalogue and rules verification per kit, which is most of the work.

**Caution.** This also edges toward recommending choices rather than guiding
them, which the product thesis is careful about. "A common starting kit" that is
visibly editable, not "recommended gear". Design decision first.

### D4. Budget pacing feedback — P3, S

The purse meter shows spent versus remaining. It does not say whether the player
is spending sensibly. A light touch — marking when the entire budget is committed
to one item, or when nothing has been spent on the basics — would help
first-time players without prescribing choices. Easy to overdo; keep it to at
most one non-blocking note.

---

## Original ordering

Revised after review. An earlier version labelled `1a → 2 → 3` "the equipment
reachability chain", which was wrong: **1b** is the item that makes results past
the first page reachable. Ranking improves the first page; it is not a substitute
for paging.

1. **A2** scroll restoration (six attributes), **C4** reduced motion (one media
   query), **C2** picker result-count status. All near-free.
2. Handoff **1a** — one authoritative result-window constant.
3. Handoff **2** — deterministic policy-aware and relevance ranking.
4. Handoff **1b** — constant-size paging, for actual reachability.
5. **B1** + handoff **6** — description, bulk and hands together off the
   hydrated preview.
6. **B2** direct quantity entry.
7. **A1** rail grouping and collapse.
8. Handoff **8** — consolidate the equipment filter predicates *before* adding
   3a, 3b, B3 or 7. Four new facets across two parallel implementations is twice
   the work and twice the drift.
9. Section D, by its own ranking, and not before a design note.

Profile impact: **B1**/handoff 6 touch preview latency only. Handoff 1b needs a
rerun only if virtualization is chosen over constant-size paging. **A2**, **B2**,
**C2** and **C4** touch the rail, cart or stylesheet rather than the row list.
**A1** adds per-level disclosure elements to the rail, so check it against
`maxDomElementCount` rather than assuming it is free.
