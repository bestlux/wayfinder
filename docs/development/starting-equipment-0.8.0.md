# 0.8.0 Starting Equipment Implementation Plan

Status: implementation-ready planning baseline, updated 2026-08-15 after adversarial review and direct PF2E source review. No 0.8.0 production code is implied by this document.

Architecture and rules contracts:

- [Starting Equipment and Wealth Architecture](../architecture/starting-equipment-and-wealth.md)
- [Starting Equipment Rules Assurance](../architecture/starting-equipment-rules-assurance.md)
- [Wayfinder Roadmap](../roadmap.md)

## Release outcome

0.8.0 lets a real actor owner finish a new or replacement PF2E character with reviewed starting equipment and exact remaining currency under GM-controlled policy. Both remastered official funding recipes ship: permanent items plus currency, and the optional lump sum. Apply is forward-idempotent, preserves foreign wealth through handoff, and leaves a durable actor manifest after success.

The release is one aggregate. The waves below are review and integration milestones, not separately supported product editions.

## Scope and cut line

### Required for 0.8.0

- Generated remaster Character Wealth values plus separately cited semantic rules.
- Level-1 15 gp acquisition and levels 2–20 under both official recipes.
- GM Equipment Policy settings, an absolute custom lump-sum override, and genuine GM authorization for equipment exceptions.
- Dedicated catalogue/cart/review UX, `retain-all` and `handoff` dispositions, truthful autosave, Clear protection, typed readiness, keyboard access, localization, and container-responsive layouts.
- Core PF2E equipment types: `ammo`, `armor`, `backpack`, `consumable`, `equipment`, `kit`, `shield`, and `weapon`. `treasure` documents are not purchased; final coins use PF2E's currency aggregate.
- A narrow `class-grant` funding/provenance lane for physical items explicitly granted by the same planned class build.
- Adventurer's Pack expansion with quantities and containers.
- Economic-baseline admission, material policy-drift review, deliberate non-stacking insertion, absolute currency convergence, retry, and a persisted completed manifest.
- The full existing release regression plus the focused equipment overlay in this plan.

### Recommended expansion, cuttable before release candidate

`WF-080-45` adds cited Quick Equipment Packages from Player Core page 268 and Player Core 2 page 277. The books contain official package guidance even though PF2E's remaster data pack no longer exposes class-kit documents. This is a high-value level-1 shortcut, but it is not allowed to delay the safety kernel, both wealth recipes, or release qualification.

Derived Wayfinder suggestions for classes without a reviewed official package are deferred to 0.8.1. If later added, they must be reason-backed and labeled non-official rather than complete or optimal.

### Explicitly deferred

- Arbitrary custom permanent-item schedules.
- Additive acquisition into actors with foreign physical items or currency.
- An approval inbox or general access-control framework.
- Custom kit authoring, saved loadouts, merchants, selling, crafting, rune transfer, and ongoing shopping.
- User-facing post-Apply undo; the 0.8 manifest is only a prerequisite for a future compensating transaction.
- A universal inventory abstraction, generic pick/spell/equipment pane, generic Apply-phase registry, or speculative plan-contributor framework.
- Exhaustive third-party document shapes. Unsupported documents remain visible only when the UI can explain why they are unavailable.
- Level 0 characters and their separate 5 gp starting rule.

## Delivery map

| Wave | Exit condition | Can proceed in parallel |
| --- | --- | --- |
| 0 — harden and measure | Current UX has measured interaction gates, serialized draft persistence, shared readiness, equipment-capable evidence, reviewable access claims, and a pane discriminant | Independent stories can merge separately, but app-shell and generated output changes integrate sequentially |
| 1 — safety kernel | Rules, policy, draft ledger, economic baseline, planned class-grant reconciliation, and stable transaction identity are executable without a UI | Numeric rules, semantic rules, policy, and identity can start in parallel behind agreed interfaces |
| 2 — level-1 tracer | One real non-GM owner completes a simple Common level-1 purchase or `retain-all`, including forced failure and retry | Catalogue and prepared-Apply work converge on the safety kernel |
| 3 — higher-level rules | Both official recipes, custom lump sum, configured gear, variants, and GM exception authority pass focused tests | Lump sum, permanent allowances, and authority can fan out after the ledger stabilizes |
| 4 — breadth and experience | All required physical shapes, kits, sources, responsive/a11y/localization, and measured performance qualify | Feature-specific modules may proceed in parallel; shared templates/styles integrate deliberately |
| 5 — release proof | Exact candidate passes automated, live, compatibility, packaging, and independent verification gates | Regression and focused overlays may run in parallel against the same immutable candidate |

Critical path:

`rules assurance → acquisition ledger → effective policy/economic baseline → class-grant reconciliation → stable batch identity → level-1 prepared acquisition → permanent allowances → kits/containers → live retry matrix → exact-candidate package proof`

## Wave 0 — Harden and measure the current foundation

Wave 0 is an internal milestone. It becomes a 0.7.4 release only if it produces a coherent fix for current 0.7.3 users—most plausibly draft autosave/Clear safety—or if 0.8.0 is materially delayed. Equipment-only harness or architecture work is not a public-release reason.

### WF-080-00 — Interaction probe and scoped search rendering

Outcome: replace guessed performance limits with a repeatable browser profile, then fix the verified current search-render problem before adding the much larger equipment catalogue.

Acceptance:

- Measure the existing spell picker on a fixed actor, pack policy, option count, query sequence, browser viewport, and Foundry app-container widths.
- Record final-keystroke-to-correct-results paint, p50/p75/p95 duration, option/result counts, DOM elements, image requests, and long tasks.
- Prove rapid input settles on the final query without stale flashes, dropped characters, lost caret, or focus-token loss.
- Coalesce/debounce search work and update only search-dependent UI; steady search does not rebuild the full character plan.
- Freeze a measured p95 regression envelope, DOM/result diagnostic limits, long-task rule, and exact app-width profile in the harness before Wave 2. These become release gates; this plan does not invent their values in advance.
- Keep the focused picker action/filter/layout suites green and add browser-level timing evidence.

### WF-080-01 — Draft durability and destructive-action ordering

Outcome: make “save as you go” true before an equipment cart raises the cost of lost work.

Acceptance:

- Every semantic draft mutation schedules a debounced, serialized save with visible Saving, Saved, and Error states.
- Save failures retain dirty state and offer a retry path; they are never reported as saved.
- Close flushes or explicitly protects unsaved work.
- Clear Draft requires a default-cancel confirmation that describes the selections/cart being discarded.
- Save, Clear, target-level change, and Apply share one actor-scoped ordering contract; a late save cannot resurrect a cleared or successfully applied draft.
- Focused tests cover close, save failure, rapid mutations, Clear during pending save, and Apply during pending save.

### WF-080-02 — Shared readiness and issue #22 behavior

Outcome: one typed evaluation result drives pane status, navigation, Apply gating, and prepared-Apply preflight.

Acceptance:

- Temporarily invalid and over-selected drafts remain editable.
- Exact-count choices distinguish incomplete, complete, and excess states.
- Apply is disabled with actionable, line-addressable reasons when the draft is not ready.
- Removing an excess or correcting a dependency restores readiness without destroying unrelated choices.
- Prepared Apply consumes the same semantic readiness result and still rechecks current authority and documents.
- The complete issue #22 behavior lands together; do not ship a Boolean-only button change.

### WF-080-03 — Acquisition-capable smoke evidence

Outcome: evolve the live harness from source-UUID presence checks into semantic batch evidence.

This story has two dependency-safe gates. `WF-080-03A` is the Wave 0 harness foundation; `WF-080-03B` remains open
until the real acquisition executor and equipment overlay exist.

#### WF-080-03A — Evidence and actor-owner foundation

- Replace blanket duplicate-source rejection with schema-versioned assertions aware of quantity, stacking intent,
  grant ancestry, slot/destination identity, and acquisition identity.
- Capture current user role, actor authority, item quantity/source/runtime/container facts, aggregate currency, and a
  complete nullable acquisition envelope. Acquisition cases fail closed unless policy, ledger, manifest, failure, and
  actor observations reconcile.
- Make unreviewed classifications fail qualification. A review is source-controlled, bound to the exact finding
  digest, recorded with GM role/time/reason, and can qualify only in a current GM evidence session.
- Replace the whole-phase failure callback with typed execution checkpoints. Wave 0 emits the real phase and final
  actor-write boundaries; acquisition-owned item, currency, and manifest checkpoints are added only with their real
  executor in `WF-080-03B`.
- Persist the exact attempted and already-materialized step identities after an interrupted Apply. A recovery draft is
  read-only except for Save and exact Apply retry until it converges, so target or choice edits cannot diverge from
  partial actor mutations. The ledger also carries the exact deferred PF2E actor paths that a partial final update did
  not durably converge. A zero-step retry replays those paths and only then writes final lifecycle state; it does not
  rerun item, spell, boost, or source phases.
- Draft Save, recovery persistence, and Clear re-read the actor flag inside the actor-operation queue, compare it to
  the window's last accepted fingerprint, and require an exact post-write readback. A lost acknowledgement succeeds
  only when the intended flag value is already durable. This rejects propagated stale-window erasure, recovery
  truncation, Clear-after-confirmation races, and post-finalization resurrection. Foundry provides no cross-browser
  compare-and-swap primitive, so two clients that both read the same old value before either update remain a declared
  last-writer-wins residual; the guard fails closed as soon as either update propagates.
- Provide a guarded two-browser-context canary: a GM creates one exact actor with default `NONE` and explicit player
  `OWNER`; a distinct non-GM opens the actor sheet and launches the actor-bound Wayfinder app through the real UI;
  the player context closes before exact GM cleanup.
- Never provision users or change roles. Owner-probe artifacts omit user, actor, credential, cookie, and storage
  identities.

#### WF-080-03B — Acquisition tracer completion

- Define evidence fields for user role, policy source/version/fingerprint, item quantity, source UUID, actual item ID,
  container ID, batch/line/entry IDs, pre/budget/target/observed currency, spent/remaining value, manifest identity, and
  failure snapshot.
- Add failure injection after item N, before currency, during currency convergence, and during final manifest/state persistence; whole-phase-only injection is insufficient.
- Drive the equipment overlay through real UI controls and a real non-GM actor-owner session, not only imported application internals in one GM session.
- Populate and reconcile the contract from real acquisition state; nullable foundation fields are not completion evidence.
- This gate is exercised by `WF-080-24` and recorded in `WF-080-51`; it must not be simulated before the owning item,
  currency, and manifest boundaries exist.

### WF-080-04 — Restricted-access authority and reviewable spell claims

Outcome: equipment uses real GM authority while spell rarity preserves its intended player-attestation model without remaining invisible.

Acceptance:

- Introduce focused GM-command authorization that checks current GM status in the command and again during Apply; UI visibility is not enforcement.
- Migrate each existing spell-access Boolean to an unresolved player claim, never to retroactive GM approval.
- A spell claim records author, timestamp, subject/slot, claimed basis, and reason; it is visibly labeled as a player attestation.
- Claims appear in final review and durable Apply outcome evidence.
- Equipment exception requests and GM approvals are different typed records; a spell claim cannot satisfy an equipment rule.
- Tests cover request, approve, revoke, stale facts, non-GM denial, Apply recheck, and multi-client refresh.

### WF-080-05 — Pane discriminant cleanup

Outcome: add the equipment pane without extending the current repeated `isX` Boolean matrix.

Acceptance:

- Existing panes select templates through the current pane `kind` or one template-kind discriminant.
- Repeated `isX` declarations and assignments used only for template dispatch are removed.
- The shell output and current pane behavior remain unchanged.
- Starting equipment can add one new discriminant without modifying every unrelated pane model.

## Wave 1 — Build the safety kernel

### WF-080-10 — Generated remaster wealth policy

Depends on: none.

Outcome: deterministic runtime data for all 20 remaster Character Wealth rows.

Acceptance:

- Implement the pinned extractor, negative Party Treasure fixture, pre-remaster rejection, exact header/provenance assertions, and level-1/level-5 canaries from the [rules assurance contract](../architecture/starting-equipment-rules-assurance.md).
- Emit a versioned generated artifact with source and artifact digests.
- Exhaustively test all 20 levels, denomination parsing, ordered allowance buckets, duplicate/missing/malformed rows, and deterministic regeneration.
- Add a clean-tree drift check.
- Installed-journal compatibility produces an explicit `match`, `diff`, or `unavailable` result. Anything other than a reviewed `match` blocks compatibility sign-off and never changes runtime values.
- Record attribution/license treatment before merge.

### WF-080-11 — Cited semantic wealth policy

Depends on: none.

Outcome: executable legality rules whose provenance is independent from the generated table.

Acceptance:

- Implement the per-rule ledger in the [rules assurance contract](../architecture/starting-equipment-rules-assurance.md), including exact book/page and AoN ID when available.
- Cover official recipes as alternatives, party-size separation, source/rarity/Access, permanent-recipe residual-currency restrictions, lump-sum level cap, lower-level allowance substitution with no rebate, baseline item identity, property-rune/precious-material funding, explicit-zero versus missing Price, size pricing, class-grant funding, level-1 equivalence, and ABP boundary.
- Represent extra-current-level items and inherited wealth as explicit GM judgments, never inferred history.
- Each executable interpretation has a focused semantic test derived from its cited distinction.
- A missing or unresolved citation blocks only the affected capability with a named diagnostic.

### WF-080-12 — Versioned acquisition draft and pure ledger

Depends on: `WF-080-10`, `WF-080-11` interfaces.

Outcome: one normalized draft substate owns acquisition intent and arithmetic.

Acceptance:

- Add a draft schema migration for stable `draftId`, `batchId`, logical lines, quantity, recipe/override, policy snapshot, baseline, allowance assignments, review state, and disposition.
- Support distinct `unreviewed`, `purchase-ledger`, `retain-all`, and `handoff` states.
- An empty cart is complete only after explicit `retain-all`; save/reopen preserves the decision and exact amount.
- Use integer copper and correctly apply denomination, `price.value`, `price.per`, source quantity, requested quantity, and size sensitivity.
- Permanent allowances, currency, and planned class grants are separate lanes with deterministic assignment or an explicit player-selected allowance assignment.
- Define precise invalidation for target level, recipe, policy, price/document, quantity, allowance, and budget changes.
- Duplicate source UUIDs are valid when logical lines, quantities, or allowance assignments require them.

### WF-080-13 — Effective Equipment Policy and GM configuration

Depends on: `WF-080-10`, `WF-080-11`.

Outcome: one explainable policy result combines rules, world configuration, actor context, and genuine authority.

Acceptance:

- Add a restricted Equipment Policy submenu for enabled official recipes, default recipe, player-selection authority, higher-level start-confirmation authority, blanket rarity availability within approved sources, allowed equipment pack families, and actor-owner versus GM-reviewed Apply.
- Require GM confirmation for a higher-level new/replacement start by default; a world policy may explicitly delegate a recorded actor-owner attestation.
- Require at least one enabled official recipe; custom lump sum is a per-draft override, never the only world recipe.
- At level 1, suppress a meaningless recipe chooser because both official recipes resolve to 15 gp.
- Permit a per-draft absolute custom lump sum only through a GM-authoritative command with author, time, and reason. It replaces the amount only: official lump-sum source, rarity, and target-level-minus-1 limits remain unless separately approved as a scoped exception.
- Permit explicit GM judgments for an extra current-level permanent allowance and rarity/source exception. The extra allowance applies only to the permanent-items recipe, never converts to cash, and never bypasses the lump-sum item cap. Inherited foreign wealth records a handoff reason; it does not unlock additive acquisition.
- Treat source-backed character Access as specific eligibility. Blanket world rarity policy is itself a GM grant inside approved sources; anything beyond either path needs per-draft approval.
- Players can choose only enabled official recipes when policy permits, build a cart, and request an exception. Presentation preferences may narrow/reorder but never broaden eligibility.
- Consume PF2E's actual ABP/actor override and normalized compendium source settings rather than duplicating system switches.
- Persist an explainable snapshot and diagnostic fingerprint. Apply re-evaluates current facts and invalidates only material changes.

### WF-080-14 — Economic baseline and non-additive handoff

Depends on: `WF-080-12`, `WF-080-13`.

Outcome: admission is based on observable wealth and can never overwrite or merge into foreign inventory.

Acceptance:

- Capture physical item identities, quantities, container links, and normalized currency when the acquisition step is entered/reviewed, before mutation.
- An economically empty actor may acquire under policy.
- Above level 1, require a persisted `new-campaign` or `replacement-character` claim with target level, author, timestamp, reason, and current authority basis. Economic emptiness alone is insufficient.
- Any unresolved or foreign physical item or nonzero currency routes to an explicit `handoff` disposition. 0.8.0 exposes no GM bypass into additive acquisition.
- Do not infer “PF2E-granted only” provenance.
- Immediately before writing, material baseline drift causes zero writes and preserves selections with an actionable explanation.
- Same-batch partial outputs are recognized as retry state; a completed manifest prevents a second starting acquisition.
- A blank actor created directly at target level can receive target-level starting wealth only with a valid start-context claim. An actor that progressed from level 1—or has an earlier completed Wayfinder character/acquisition outcome—does not receive new-character wealth.

### WF-080-15 — Planned class-grant reconciliation

Depends on: `WF-080-11`, `WF-080-12`, `WF-080-14`.

Outcome: physical equipment explicitly granted by the same planned class build is neither charged against wealth nor misclassified as foreign inventory.

Acceptance:

- Project a grant from authoritative draft/source relationships, including the Alchemist formula book, Investigator Alchemical Sciences formula book, and Giant Instinct Titan Mauler weapon.
- Store grant source/slot, expected source identity, quantity, funding lane, and any no-resale rule in the prepared plan and completed manifest.
- Enforce Titan Mauler's exact free-grant boundary: one weapon sized for a creature one size larger, melee or ranged, Common or specifically accessed, and base Price no more than 9 gp before the size adjustment.
- Reconcile expected grants regardless of whether PF2E materializes them before or after the acquisition item phase.
- A grant never reduces currency or consumes a permanent allowance; the Titan Mauler weapon retains its no-resale economic treatment before later rune investment.
- Never infer `class-grant` from arbitrary existing item flags or source resemblance. Missing or ambiguous planned provenance routes to handoff.
- Cover preparation order, save/reopen, partial Apply, retry, and final economic-baseline verification for every supported grant.

### WF-080-16 — Batch, entry, and completed-manifest identity

Depends on: `WF-080-12`.

Outcome: planned intent, partial outputs, and completed audit evidence have independent, stable identity.

Acceptance:

- Policy identity never doubles as batch identity.
- Define a canonical pre-aggregation key and stable batch, line, entry, planned item, and container identities.
- Draft identity survives save/reopen/retry; harmless presentation changes do not churn entry identity.
- Define a schema-versioned actor manifest containing applying user/time, target level, disposition, effective policy provenance, higher-level start-context kind/author/time/reason/authority basis when applicable, ledger digest, economic baseline, pre/target/observed currency, canonical entries, funding/grant source/quantity/price/allowance/container facts, observed item IDs, and Foundry/PF2E/module versions.
- The successful manifest remains queryable by batch ID across app/world reload and after draft clear.
- 0.8.0 retains one completed starting-acquisition record; a second successful acquisition cannot silently replace it.

## Wave 2 — Prove a thin level-1 tracer

The tracer deliberately excludes kits, permanent allowances, supplemental sources, package guidance, and derived suggestions. It is complete only when it crosses real UI, policy, Apply, actor state, and retry boundaries.

### WF-080-20 — Dedicated starting-equipment step, pane, and commands

Depends on: `WF-080-02`, `WF-080-05`, `WF-080-12`–`WF-080-16`.

Outcome: a target-level starting-equipment step with a dedicated multi-select experience.

Acceptance:

- Add one typed starting-equipment step at the target level, ordered after the other choices for that level.
- Use dedicated normalized view models, template, pane builder, and command Module; do not widen `OptionRecord` or the single-choice pane.
- Explain effective recipe, budget, automatic eligibility, authority, and handoff before browsing.
- Show search, filters, item detail, quantity, affordability, unavailable reason, cart, spent/remaining amount, review, `retain-all`, and `handoff`.
- App shell only routes commands, notifications, and renders.
- Readiness focuses the exact cart line/control that needs work.

### WF-080-21 — Minimal Common equipment catalogue

Depends on: `WF-080-00`, `WF-080-13`.

Outcome: browse Common, priced, supported core-pack equipment without mounting or hydrating the full pack on every interaction.

Acceptance:

- Normalize only indexed facts required for search, facets, eligibility, price display, and preview identity.
- Isolate equipment source families from ancestry/feat/spell supplemental settings.
- Cache by projection and policy and deduplicate in-flight index requests.
- Search/facets use cached normalized records; full documents hydrate only when preview identity changes.
- Exclude `treasure` and documents requiring unsupported interactive rule-element resolution with explicit reasons.
- Apply the measured Wave 0 interaction gates to the level-1 catalogue.

### WF-080-22 — Prepared simple-item acquisition

Depends on: `WF-080-14`–`WF-080-16`, `WF-080-20`, `WF-080-21`.

Outcome: a real non-GM actor owner buys one or more simple Common items as one prepared batch.

Acceptance:

- Preparation re-resolves documents, policy, price, quantities, baseline, authority, and expected remaining currency before the first write.
- Equivalent logical purchases pre-aggregate; created entries carry module/draft/batch/line/entry identity.
- Use a deliberate PF2E insertion path that preserves preparation behavior without merging into foreign stacks.
- Verify exact item IDs, sources, quantities, and batch identity after insertion.
- Item failure leaves currency unchanged and retains the draft and planned manifest.

### WF-080-23 — Absolute currency and durable completion

Depends on: `WF-080-22`.

Outcome: the acquisition converges to one absolute PF2E currency result and leaves durable success evidence.

Acceptance:

- Compute one target aggregate copper value; converge through PF2E add/remove currency operations rather than applying a relative debit.
- Reread and verify exact aggregate currency after convergence.
- `retain-all` creates no purchased items, preserves the exact budget, and still writes a completed manifest.
- Persist and verify the manifest before—or in the same ordered final actor write as—draft clear. A final-write failure cannot clear the only recoverable plan.
- The durable receipt survives reload and shows items, quantities, containers, spent/remaining currency, disposition, authority claims/approvals, and Open Inventory.

### WF-080-24 — Forced-failure tracer and retry gate

Depends on: `WF-080-23`, `WF-080-03A`.

Outcome: prove the safety contract live before expanding the rule surface.

Acceptance:

- Inject failure after item N, before currency, during currency convergence, and during final manifest/state persistence.
- Each retry converges to one batch, exact quantities, exact currency, one durable manifest, and no second charge.
- Partial item state is visible and diagnosable; the draft remains available.
- The live case runs through the UI as a real non-GM actor owner, with a separate GM session where policy review is required.
- Do not begin Wave 3 until this tracer is green or an explicit architecture revision explains the failed invariant.

## Wave 3 — Complete higher-level rules and GM control

### WF-080-30 — Official lump-sum recipe, levels 2–20

Depends on: `WF-080-10`, `WF-080-11`, `WF-080-23`.

Acceptance:

- Use the generated absolute lump sum for the target level.
- Auto-eligible purchases are Common and at most target level minus 1.
- Review records who selected the optional lump-sum alternative and the world policy that authorized that selection, whether GM-fixed or delegated to the actor owner.
- Tests exhaust levels 2–20 and cover exact boundary, above-level rejection, retain-all, and material policy drift.

### WF-080-31 — Permanent items plus currency, levels 2–20

Depends on: `WF-080-10`–`WF-080-12`, `WF-080-23`.

Acceptance:

- Render every generated allowance bucket and residual currency separately.
- Permit lower-level substitution into a higher bucket with no currency rebate.
- Never convert an unused allowance into cash or let currency purchases silently consume an allowance.
- Permit the recipe's residual currency to buy consumables or permanent items below the target level, retaining the remainder as coins; do not treat it as an unrestricted at-level permanent-item budget.
- Review and manifest preserve the chosen assignment for each permanent item.
- The level-5 canary proves 4th×1, 3rd×2, 2nd×1, 1st×2, plus exactly 50 gp.
- Tests exhaust all generated allowance shapes and material drift.

### WF-080-32 — GM override and equipment-exception lifecycle

Depends on: `WF-080-04`, `WF-080-13`, `WF-080-23`.

Acceptance:

- Support custom absolute lump sum, permanent-recipe extra-current-level allowance, and item/source/rarity exception as distinct GM commands.
- Custom lump sum inherits official lump-sum purchase limits unless a separate scoped exception authorizes named facts. An extra-current-level allowance never becomes currency and never applies to or overrides the lump-sum item cap.
- Store requester, approver, timestamps, reason, scope, and approved facts.
- Apply checks current GM-derived authority and approved facts; stale, revoked, or mismatched approval performs zero writes.
- Player requests are visible but never executable authority.
- Inherited gear adjustment remains a recorded handoff; no command bypasses the non-additive boundary.

### WF-080-33 — Configured weapons, armor, runes, materials, and ABP

Depends on: `WF-080-11`, `WF-080-31`, `WF-080-32`.

Acceptance:

- Represent a baseline weapon or armor plus applicable fundamental configuration as one permanent-item choice where PF2E exposes that combined item.
- Fund property runes and precious-material cost separately and show the split before review.
- Resolve configured documents again at Apply and retain their component price basis in the manifest.
- Read PF2E's exact ABP world mode and actor override. Preserve currency by default; suppress or warn on potency, striking, resilient, and redundant numerical items as supported. Do not generate an adjusted wealth table or blanket-filter property runes, consumables, scrolls, or wands that can still matter.
- Where installed PF2E cannot safely express a configuration, provide an explicit handoff rather than inventing an item.

## Wave 4 — Complete breadth and experience

### WF-080-40 — Price, quantity, size, and supported physical types

Depends on: `WF-080-21`–`WF-080-23`.

Acceptance:

- Qualify `ammo`, `armor`, `backpack`, `consumable`, `equipment`, `shield`, and `weapon` documents across `price.value`, `price.per`, source quantity, requested quantity, and actor-size behavior.
- Apply Player Core page 270 semantics: Small/Medium standard price, ordinary larger gear's size multiplier, listed price for sufficiently high-priced magic items, and Bulk-derived precious-material price.
- Pre-aggregation produces the intended physical stack, such as one quantity-12 entry rather than twelve accidental documents.
- Treat an explicit parsed zero as a valid base Price, then apply all material/configuration adjustments before final pricing. Missing, unparseable, or otherwise unpurchasable Price data is unavailable with a diagnostic, never silently free.
- `treasure` remains excluded from catalogue purchase and cannot create a second currency model.

### WF-080-41 — Kits and Adventurer's Pack containers

Depends on: `WF-080-40`.

Acceptance:

- Resolve and recursively expand the installed Adventurer's Pack through a small PF2E adapter.
- Preserve nested quantities, actor size, backpack/container relationships, and deterministic child entry identity.
- A missing or changed child produces a zero-currency partial failure that retries without duplicate contents.
- Cart, review, manifest, and smoke evidence show both the kit line and materialized children.
- Other `kit` documents remain unavailable unless their same contract is explicitly qualified.

### WF-080-42 — Source isolation and supplemental equipment packs

Depends on: `WF-080-13`, `WF-080-21`.

Acceptance:

- Use a dedicated equipment source allowlist and normalize PF2E browser pack/source settings without inheriting role-dependent `ignoreAsGM` behavior.
- A supplemental equipment pack cannot widen ancestry, feat, spell, or language sources.
- Missing/corrupt packs and duplicate source identities produce deterministic diagnostics.
- Live evidence covers one allowed supplemental item and one adjacent disallowed pack.

### WF-080-43 — Responsive, accessible, and localized acquisition

Depends on: `WF-080-20`, stable Wave 4 templates.

Acceptance:

- Convert internal breakpoints needed by the acquisition workspace to named container queries.
- Qualify the fixed app widths frozen in Wave 0, independent of browser viewport width.
- Complete the flow by keyboard with visible focus, labeled quantities, announced budget/status changes, and error focus.
- Provide English and Chinese key parity with no raw keys or clipped critical content.
- Render and inspect policy, browse/cart, review, handoff, failure, and receipt states at release widths.

### WF-080-44 — Catalogue performance qualification

Depends on: `WF-080-00`, complete required catalogue.

Acceptance:

- Run the fixed release profile at cold open, warm reopen, rapid search, facet change, cart quantity, recipe change, and preview change.
- Meet the Wave 0 p95/long-task gates and report p50/p75/p95 with result/DOM/image counts.
- Steady search/cart work does not rebuild the full character plan, call `getIndex` for unchanged projection/policy, or hydrate an unchanged preview.
- Add bounded paging/windowing, delegated row actions, and lazy images only where measurement requires them; any resulting limits become tested contracts.
- Reuse the already-built effective render snapshot where profiling proves duplicate actor/document resolution; do not add broad speculative memoization.

### WF-080-45 — Official Quick Equipment Packages (recommended expansion)

Depends on: `WF-080-11`, `WF-080-40`, `WF-080-41`.

Acceptance if promoted into the release:

- Add cited, versioned definitions for all 16 reviewed classes in Player Core page 268 and Player Core 2 page 277, or keep the entire preset slice out of the release.
- Distinguish included Armor/Weapons/Gear from optional purchases and preserve quantities.
- Resolve stable installed Item identities and verify package price/remaining money; a mismatch disables the package with a diagnostic.
- Show book/page/edition and never imply coverage for unreviewed classes or sourcebooks.
- Applying a package uses the same ledger, policy, preparation, retry, and manifest path as a manual cart.

### WF-080-46 — Evidence-driven shared faceting cleanup (cuttable refactor)

Depends on: stable equipment and existing picker adapters.

Acceptance if undertaken:

- Generalize facet definitions only after the existing picker and equipment catalogue prove two real adapters.
- Reuse a focused filter-bar primitive without forcing feat, spell, and equipment into one pane or option record.
- Demonstrate deletion of duplicated filter logic; do not add a framework whose removal merely redistributes the same complexity.
- Keep this refactor out of the critical path if its benefit is not measurable before release candidate.

## Wave 5 — Prove and package the exact release

### WF-080-50 — Automated contract suite

Depends on: all required behavior stories.

Acceptance:

- Exhaust all 20 generated numeric rows and every cited semantic distinction.
- Cover policy materiality versus irrelevant fingerprint drift; economic empty/foreign/partial/completed states; custom and official recipes; and approval lifecycle.
- Cover denominations, explicit zero Price, quantities, `price.per`, sizes, allowance assignment, planned class grants, configured equipment, `retain-all`, kit containers, and source isolation.
- Inject failures after item N, before currency, during convergence, and during final state/manifest write; verify exact forward convergence and reload behavior.
- Prove a completed manifest cannot be silently replaced and a completed actor cannot receive a second starting acquisition.
- Keep generated `scripts/`, generated rules artifact, locale keys, and package contents synchronized.

### WF-080-51 — Live Foundry release matrix

Depends on: `WF-080-03B`, `WF-080-50`, immutable candidate build.

Run the existing 55 executions / 54 unique scenarios under one default reviewed equipment disposition. Do not multiply every GM option across that matrix.

Add a focused pairwise overlay:

1. Level-1 martial purchase as a real non-GM actor owner.
2. Level-1 Small caster with Adventurer's Pack, quantities, actor size, and nested containers.
3. Level-1 `retain-all` through save/reopen, Apply, reload, and rerun.
4. Level-5 permanent recipe: 4th×1, 3rd×2, 2nd×1, 1st×2, plus 50 gp.
5. Level-5 lump sum: 270 gp and item-level-minus-1 boundary.
6. Higher-level start-context: GM-approved new/replacement start succeeds; empty-inventory progression from level 1 is denied.
7. GM custom amount plus one uncommon/source exception and separate GM review.
8. Allowed supplemental equipment item plus an adjacent disallowed source.
9. Existing foreign item and existing currency handoffs with zero writes.
10. Material policy/price/baseline drift after review with zero writes.
11. Failure after item N, during currency convergence, and during final manifest/state write, each followed by clean retry.
12. ABP world mode plus actor override behavior.
13. Player spell attestation visible in GM review/receipt and distinct equipment approval.
14. Planned class grants: one formula book and the no-resale Titan Mauler weapon without budget charge or false handoff.
15. English and Chinese flow, keyboard completion, and fixed Foundry app-container widths.

Every overlay record includes user role, policy provenance, batch/line/entry IDs, quantities, containers, currency ledger, failure snapshot, completed manifest, git SHA, and served-script hashes.

### WF-080-52 — Compatibility, package, and release proof

Depends on: `WF-080-51`.

Acceptance:

- Qualify the advertised PF2E minimum 8.1.0 and the release target, or raise the manifest minimum before release candidate.
- Installed-journal comparison is a reviewed `match` for every advertised PF2E lane.
- Run `npm run format:check`, `npm run lint`, `npm run build`, `npm test`, `npm run check:strict`, and `npm run check` on the exact candidate.
- Produce a clean generated-artifact check and review PF2E attribution/license notices.
- Bind smoke result, policy/artifact digests, git SHA, served-script hashes, module metadata, and ZIP SHA-256 in the package evidence.
- Verify manifest URLs, version fields, Foundry compatibility/registration, package contents, asset hashes, and tag/ref identity.
- Perform independent exact-candidate release verification before publication. Publication remains a separate explicitly authorized action.

## Configuration matrix

| Scope | Configuration | Authority and effect |
| --- | --- | --- |
| GM world | Enabled official recipes and default | Defines available permanent/lump paths; level 1 collapses to 15 gp |
| GM world | Recipe selection authority | GM-fixed or actor-owner choice among enabled official recipes |
| GM world | Higher-level start confirmation | GM approval by default; optionally delegates a recorded owner attestation |
| GM world | Equipment packs/source families | Broadens only equipment catalogue sources |
| GM world | Blanket rarity availability | Common by default inside approved sources; raising it is a GM policy grant |
| GM world | Apply authority | Actor owners under policy or GM review for every acquisition |
| GM per draft | Absolute custom lump sum | Replaces only the amount for that draft; inherits lump-sum purchase limits unless separately excepted |
| GM per draft | Extra current-level allowance | Permanent-recipe-only GM Core judgment; never cash or a lump-cap bypass |
| GM per draft | Rarity/source exception | Narrow recorded approval for named facts; stale facts require review |
| GM per draft | Inherited wealth adjustment | Records an explicit sheet handoff; does not enable additive Apply |
| Player draft | Official recipe choice | Available only when world policy delegates selection |
| Player draft | Cart, quantity, allowance assignment, `retain-all`, handoff acknowledgement | Can narrow and complete intent; cannot broaden eligibility |
| Player draft | Exception request | Visible request only; never authorization |
| Projected build | Source-backed item Access and class grants | Can authorize the named restricted item or free grant only when authoritative provenance is prepared |
| Player presentation | Search, sort, compact/detail, unavailable visibility | Never enters policy fingerprint or Apply legality |

Do not duplicate PF2E's ABP state, actor ABP override, compendium browser packs/sources, gradual boosts, Free Archetype, campaign feat sections, or language availability as Wayfinder settings. Consume their effective state where acquisition actually depends on it.

## Release go/no-go

0.8.0 is a go only when:

- both official recipes and the level-1 equivalence are rules-proven and live-proven;
- the non-GM tracer and every forced retry converge without duplicate items or currency drift;
- foreign wealth and material drift produce zero writes;
- higher-level wealth requires a current authorized start-context claim and rejects ordinary progression;
- planned class grants neither consume wealth nor trigger a false foreign-wealth handoff;
- the completed manifest persists before draft clear and across reload;
- GM equipment approvals and player spell claims remain visibly different trust models;
- the full regression and focused overlay are green on every advertised compatibility lane;
- the measured interaction, app-container, keyboard, and localization gates pass; and
- exact-candidate smoke, source digests, served output, package hash, metadata, and tag all agree.

Any failure in rules provenance, economic admission, retry convergence, manifest durability, authority, or exact-candidate binding is a release blocker. The Quick Equipment Packages expansion and shared-faceting cleanup are cuttable without changing that bar.
