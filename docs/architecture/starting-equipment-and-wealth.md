# Starting Equipment and Wealth Architecture

Status: accepted architecture for the planned 0.8.0 release. This document defines the durable product and safety contract; it does not describe behavior shipped in 0.7.3. Provenance lives in [Starting Equipment Rules Assurance](starting-equipment-rules-assurance.md), and sequenced stories and release evidence live in the [0.8.0 implementation plan](../development/starting-equipment-0.8.0.md).

## Decision

Wayfinder will add a creation-time acquisition chapter, not a persistent shop. It prepares one explicit batch of physical items and one absolute remaining-currency result, validates the complete economic transaction, and executes it through the prepared Apply model introduced in 0.7.2.

0.8.0 includes:

- the remastered Character Wealth permanent-items-plus-currency recipe;
- the optional official lump-sum recipe;
- level-1 starting wealth, where both official recipes resolve to 15 gp;
- a GM-authoritative absolute custom lump-sum override;
- the Adventurer's Pack, individual physical items, quantities, and containers;
- an explicit funding/provenance lane for source-backed class-granted equipment;
- Common equipment by default, configurable pack sources, and explicit GM-authorized exceptions; and
- an economically empty new or replacement character path, with an explicit handoff for existing wealth.

It excludes level-0 character construction, ongoing shopping, selling, merchants, crafting, rune transfer, loadout optimization, additive acquisition into an existing inventory, arbitrary permanent-item schedules, and user-facing post-Apply undo.

## Rules assurance

The numeric wealth table and the prose that determines whether a cart is legal have different source and drift characteristics. The [rules assurance contract](starting-equipment-rules-assurance.md) therefore defines a generated numeric artifact, a separately cited semantic-rule ledger, and a distinct source contract for any official Quick Equipment Packages.

Runtime reads deterministic generated values from a pinned PF2E remaster fixture. It never scrapes a localized or permission-dependent journal. Compatibility smoke compares a structurally validated installed journal with the generated policy; semantic drift blocks review rather than silently changing behavior.

Cart-legality rules are implemented only with individual GM Core/Player Core citations and focused semantic tests. The 0.8.0 rules include:

- higher-level characters receive common items and currency from Character Wealth; the player chooses the items from GM-approved sources;
- explicit character Access or GM policy can authorize otherwise restricted equipment, but rarity and source are separate checks;
- permanent-item allowances are level buckets, and a lower-level item can consume a higher allowance without converting the unused level difference into currency;
- a baseline weapon or armor consumes one permanent-item allowance, while property runes and precious-material costs are funded separately;
- residual currency in the permanent-item recipe buys consumables or permanent items below the starting level, with the rest retained as coins;
- the lump-sum alternative funds common items no higher than one level below the character's starting level; and
- level-1 characters begin with 15 gp for equipment; source-backed free class grants are not charged against it.

PF2E's Automatic Bonus Progression mode and actor override affect eligibility and guidance through the installed system's actual values. They do not select or invent another wealth table. Wayfinder can suppress or warn on potency, striking, resilient, and redundant numerical items without blanket-filtering property runes, consumables, scrolls, or wands.

## Effective acquisition policy

The policy model separates an official recipe from an override:

- `permanent-items`: exact permanent-item allowances plus residual currency;
- `lump-sum`: the official absolute budget; and
- `custom-lump-sum`: a GM-authoritative absolute amount for this draft that replaces only the official budget amount and otherwise inherits lump-sum source, rarity, and target-level-minus-1 purchase limits. Any exception to those limits remains a separate scoped GM approval.

World policy controls which official recipes are enabled, the default recipe, whether a player may choose between them, who may confirm a higher-level new/replacement start, blanket rarity availability within allowed sources, allowed equipment pack families, and whether actor owners may Apply without a GM review. Default blanket availability is Common, and default higher-level start confirmation requires a GM. Explicit PF2E character Access can authorize a specific restricted item independently; anything beyond blanket policy or source-backed Access requires a GM approval. The settings belong in one restricted Equipment Policy submenu. Player presentation preferences such as sort order or compact rows never affect legality.

The draft stores an explainable effective-policy snapshot: resolved recipe, source policy, rarity policy, authority, applicable PF2E variants, and the rule/data versions that produced the budget. For a target above level 1, it also stores a `new-campaign` or `replacement-character` start-context record with target level, author, time, reason, and the world policy or GM approval that authorized it. A fingerprint of that snapshot is useful for diagnostics, caching, and detecting the need for review; it is not authority by itself.

Immediately before mutation, Apply re-resolves current item documents and current effective policy. It blocks with an actionable reason only when a material fact changed: item eligibility or price, allowance assignment, budget, selected recipe, required authority, expected remaining currency, or the economic baseline. An unrelated world-setting change does not invalidate the batch.

## Economic baseline and handoff

Eligibility is based on observable economic state, not on guesses about whether an actor “looks new” or whether PF2E granted an item.

Economic emptiness is necessary but does not prove a higher-level start. Above level 1, acquisition also requires the persisted start-context record authorized under current world policy. Apply revalidates that claim, its target level, and the absence of an earlier completed Wayfinder character/acquisition outcome. A character progressed from level 1 cannot receive new-character wealth merely because its inventory happens to be empty.

Before the first acquisition mutation, record a baseline containing:

- the actor's physical-item identities, quantities, and container relationships; and
- denomination-normalized aggregate currency.

An economically empty actor can enter the standard flow under world policy. A physical item explicitly granted by a source in the same prepared character build uses a separate `class-grant` lane: it is not charged against wealth and is reconciled by its planned source/slot identity. This exception is never inferred from arbitrary actor inventory. An unresolved grant, any other foreign physical inventory, or nonzero currency produces an explicit PF2E-sheet handoff in 0.8.0. Wayfinder does not clear, reprice, merge into, or silently replace foreign inventory, and no GM command bypasses this non-additive boundary.

Apply compares the baseline immediately before writing. Material drift causes zero writes. A partial batch carrying Wayfinder's own stable identity is recognized as a retry, not misclassified as foreign wealth. Additive acquisition into an existing economy remains out of scope for 0.8.0.

## Draft and ledger model

Starting equipment is one versioned acquisition substate in the draft, not a collection of unrelated pick records. It owns:

- `draftId` and stable `batchId`;
- stable logical line identifiers and requested quantities;
- the selected recipe or GM override;
- the effective-policy snapshot and material review state;
- the economic baseline;
- allowance assignments, funding lane (`allowance`, `currency`, or `class-grant`), and the currency ledger; and
- a disposition of `unreviewed`, `purchase-ledger`, `retain-all`, or explicit `handoff`.

An empty cart is not implicitly complete. `retain-all` is a positive, reviewed decision that preserves the exact remaining amount and appears in review and the completed manifest. A material policy or budget change returns either purchase disposition to review.

The acquisition ledger is pure and uses integer copper internally. It distinguishes an explicit zero base Price from missing/unpurchasable price data, then resolves applicable material and configuration adjustments before deciding the final price. It also understands `price.value`, `price.per`, source quantity, requested quantity, and PF2E's size-sensitive price rules, including listed-price magic items and separately Bulk-priced precious materials. Permanent allowances, currency, and class grants are distinct funding lanes: an allowance is not spendable cash, a currency purchase cannot silently consume one, and a class grant never reduces the budget.

## Catalogue and planning seams

Equipment is not a widened feat picker. Its cardinality, multi-selection behavior, quantities, pricing, allowance assignment, and reviewed-empty state require a dedicated Starting Equipment Module with:

- an Equipment Catalogue that normalizes only browse/filter facts from allowed Item packs;
- an Acquisition Ledger that evaluates a proposed cart against effective policy; and
- an acquisition command surface that owns add, remove, quantity, recipe, allowance, disposition, and exception-request transitions.

The app shell routes commands, notifications, and renders; it does not own equipment policy. The dedicated pane may reuse focused faceting and filter-bar primitives, but it does not force feat, spell, and equipment choices into a universal pane abstraction.

Catalogue caches are projection-aware, source-family-aware, and deduplicate in-flight reads. Search and facets operate on normalized cached records. Full documents and enriched descriptions are hydrated only when the preview identity changes.

Performance gates begin with measurement rather than invented row or latency limits. The release profile records result count, option count, final-keystroke-to-correct-results paint, p50/p75/p95 duration, DOM size, image requests, and long tasks. Regardless of final numeric budgets, steady search and cart edits must not rebuild the full character plan, reread an unchanged pack index, or hydrate an unchanged preview. Pagination or windowing is added when the measured catalogue requires it.

Internal layout responds to the Foundry application container, not only the browser viewport. The equipment flow must remain usable by keyboard and at the app widths selected by the release profile.

## Prepared acquisition and Apply

Extend the existing prepared Apply interface with a dedicated acquisition value and phase; do not create a second actor-mutation pipeline or a generic inventory abstraction.

Preparation:

1. Re-resolves every selected document and the effective policy.
2. Reconciles source-backed class grants expected from the same prepared build.
3. Expands kits through PF2E behavior, including actor size and nested containers.
4. Pre-aggregates equivalent logical purchases, such as twelve identical arrows into one quantity-12 entry.
5. Assigns deterministic batch, line, entry, and planned item identities and remaps container references.
6. Produces the intended absolute aggregate currency target.

Every materialized item is stamped with module ownership, draft ID, batch ID, line ID, and entry ID. Insertion deliberately avoids merging into a foreign stack; PF2E still prepares the physical documents and enforces system behavior.

Execution is forward-idempotent. An item-phase failure does not change currency. If currency finalization fails after item creation, retry recognizes the completed entries and converges the actor to the same absolute target rather than duplicating items or applying another relative debit. Currency is verified by rereading PF2E's aggregate copper value.

After successful verification, persist a completed acquisition manifest on the actor before clearing the draft. It remains queryable by batch ID and records:

- draft and batch identity plus the prepared-ledger digest;
- the baseline and target aggregate currency;
- the reviewed disposition and policy identity;
- the higher-level start-context kind, target level, author, time, reason, and authority basis when applicable;
- each logical line and materialized entry, including funding lane, expected and actual item ID, source UUID, parent container, quantity, and stable fingerprint; and
- the Apply outcome and restricted-access claims or approvals relevant to the acquisition.

The final receipt is derived from durable outcome data, not only transient UI state. This manifest enables GM audit, manual diagnosis, and a future compensating reversal design. 0.8.0 guarantees retry, not user-facing undo.

## Authority and review

Actor ownership permits ordinary planning under world policy. GM-only acquisition actions—custom wealth, rarity/source exceptions, permanent-recipe extra-current-level allowances, and required Apply review—are enforced in both the command path and Apply revalidation. An extra-current-level allowance never becomes cash and never overrides the lump-sum item-level cap; a GM who wants a different lump-sum budget uses the separately recorded custom amount. Hidden controls or world-setting visibility are not authority checks.

Players may request an equipment exception but cannot approve it. An approval records its approver, time, reason, scope, and the policy/item facts being approved. Stale approvals fail closed with an actionable review state.

Restricted spell access remains a player attestation rather than being silently converted into equipment's GM-approval model. The current bare Boolean must migrate to a reviewable record containing author, timestamp, subject/slot, claimed basis, and reason. It is labeled as a player claim, appears in final review, and survives draft clear in the Apply receipt. A spell attestation can never satisfy an equipment exception.

## Interaction contract

The chapter follows this order:

1. Explain the effective policy, recipe choices, authority, and any handoff.
2. Browse equipment and build a cart with visible allowance and currency effects.
3. Explicitly review purchases or choose `retain-all`.
4. Show typed readiness blockers and permit editing while temporarily invalid or over budget.
5. Serialize pending autosave before Apply, show phase progress, and retain recoverable state on failure.
6. Persist the manifest, clear the draft, show the durable receipt, and offer the PF2E inventory as the next destination.

Ordinary semantic edits use debounced, serialized autosave with truthful Saving, Saved, and Error states. Clear Draft requires a default-cancel confirmation. Save, Clear, close, and Apply share one ordering contract so a late save cannot resurrect a cleared or applied draft.

The recommended, cuttable package expansion uses cited Quick Equipment Packages from Player Core and Player Core 2 and labels their exact source and coverage. Derived Wayfinder suggestions are deferred to 0.8.1 and, if added later, remain visibly non-official, incomplete guidance rather than optimization.

## Validation boundary

The release must prove four distinct things:

- rules provenance and semantic policy;
- pure ledger and eligibility behavior;
- prepared Apply atomicity, retry, and durable evidence; and
- real Foundry behavior across role, PF2E version, source, layout, and failure boundaries.

The exact automated and live matrix is maintained in the [implementation plan](../development/starting-equipment-0.8.0.md). The full existing character-generation regression remains on the default reviewed equipment path, while a focused pairwise overlay covers the additional wealth, authority, source, variant, handoff, and retry states. The configuration cross-product is not multiplied across every existing scenario.
