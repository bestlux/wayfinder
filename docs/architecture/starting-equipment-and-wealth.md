# Starting Equipment and Wealth Discovery

Status: product and architecture decision for the planned 0.8.0 slice. Evidence inspected 2026-08-14 in local PF2E source at commit `821012d8215` and the Wayfinder 0.7.2 apply model.

## Decision

Build a creation-time acquisition chapter, not a persistent shop. It should prepare an explicit batch of physical items and an absolute remaining-currency result, validate the whole batch, and then execute it through the same apply model introduced by issue #23.

The first release should support:

- level-1 characters using the official 15 gp starting budget;
- the official Adventurer's Pack plus individual physical-item purchases;
- higher-level characters using PF2E's lump-sum value or an explicit GM override;
- GM overrides for wealth mode, custom starting amount, rarity, and supplemental sources;
- blank or new-character drafts only; actors with meaningful pre-existing inventory receive an explicit PF2E-sheet handoff in 0.8.0.

It should not support ongoing shopping, selling, merchants, rune transfer, crafting, daily consumable allocation, or inventory optimization.

## What PF2E exposes

### Wealth policy

PF2E's GM Screen journal includes the Character Wealth table for levels 1–20. Each row has:

- permanent-item counts by item level;
- currency remaining after those items; and
- a lump-sum alternative.

Level 1 is 15 gp in both paths. At later levels, the two paths are alternatives, not values to combine. Wayfinder should encode this small official table as versioned policy with a fixture test against the installed journal when available. It should not scrape rendered journal HTML during ordinary planning.

The lump-sum path fits 0.8.0's running-budget model. The permanent-items-plus-currency path should follow in 0.8.1: it adds separate item-level quotas and decisions around fundamental runes, upgraded base equipment, and what counts as one permanent item. Keeping it separate preserves a smaller first release without abandoning the official option.

### Kits

Remaster PF2E explicitly records class kits as removed. The installed equipment pack contains two `kit` documents: the common **Adventurer's Pack**, priced at 1 gp 5 sp, and the uncommon **Cartographer's Kit**. Only the Adventurer's Pack is a general starting-gear shortcut. Its structured tree includes a backpack and nested quantities for the pack's contents.

PF2E's `KitPF2e.createGrantedItems` expands a kit tree into physical items, assigns container IDs, applies actor size, and fails when an entry cannot be resolved. Wayfinder should use that system behavior through a small adapter rather than maintaining its own Adventurer's Pack contents.

Any class- or role-based loadout shown by Wayfinder must therefore be labeled as a suggestion. It is not an official class kit and should be derived from reusable facts such as weapon/armor proficiency, spellcasting needs, and trained skills rather than a hard-coded table for every class.

### Inventory and currency

PF2E's actor inventory provides:

- `inventory.add(...)` for physical items, including stacking and container placement;
- `inventory.currency` for the actor's current coin value;
- `inventory.addCurrency(...)` and `inventory.removeCurrency(...)` for denomination-aware changes.

Those methods are useful execution adapters, but a draft must not store a relative instruction such as “remove 3 gp.” A retry after a later failure could charge twice. Preparation should calculate the intended final acquisition ledger and remaining value; execution should make item creation idempotent and apply currency as an absolute, Wayfinder-owned result during finalization.

### Equipment documents

The `pf2e.equipment-srd` pack provides structured physical-item documents with type, level, price, quantity, traits, rarity, usage, hands, Bulk, size, and source metadata. The inspected pack contains 5,672 entries; 2,637 common, priced, non-treasure documents remain after excluding interactive `ChoiceSet`/`GrantItem` items for the first slice. Existing Wayfinder pack filtering can supply pack and rarity policy, but equipment needs its own option normalization rather than pretending every physical item is a feat-like selection.

Price is not always “one card costs this amount.” PF2E supports `price.value`, `price.per`, `sizeSensitive`, and source quantities—for example, ammunition sold in a stack. Cart arithmetic must preserve those semantics and use integer copper internally.

Kits require recursive expansion. Weapons, armor, backpacks, consumables, treasure, and other physical types have different prepared fields and stacking rules. PF2E must remain the rules engine for final item preparation.

## Proposed module seams

### Equipment catalogue Module

Interface: a query containing actor size, target level, acquisition mode, allowed packs, rarity ceiling, search text, and item-type filters; returns normalized purchasable options.

The Implementation reads installed Item packs and normalizes only the facts the picker needs. Its depth comes from keeping PF2E pack access, price parsing, source policy, and physical-type differences out of the pane.

### Acquisition ledger Module

Interface: current policy plus selected item UUIDs and quantities; returns total cost, remaining budget, permanent-item allowance use, and validation errors.

Keep this calculation pure and denomination-independent by using copper value internally. Display can format denominations. Higher-level permanent-item allowances and lump sum must be different modes.

### Prepared inventory Adapter

At the issue #23 apply seam, resolve every selected document, expand kits, apply quantities and actor size, check the authoritative policy again, and produce one idempotent equipment phase plus an absolute currency finalization patch. Stamp created items with a stable acquisition ID and draft slot so a retry can recognize what already succeeded. PF2E's own browser removes currency before adding an item; Wayfinder must not copy that failure ordering.

Do not introduce a general inventory abstraction before there are two real adapters. PF2E's actor inventory is the only execution adapter currently needed.

## User flow

1. The GM's world policy establishes the budget mode and source/rarity limits.
2. Wayfinder explains the available starting wealth in player language.
3. The player can add the Adventurer's Pack and browse compatible equipment.
4. The rail shows spent and remaining wealth; the pane shows why an item is unavailable.
5. Higher-level permanent-item mode shows each remaining item-level allowance separately from currency.
6. The final review lists every item, quantity, container, total cost, and remaining coins before Apply.
7. If the actor already has equipment, Wayfinder shows an explicit additive/review state. It never clears or silently replaces inventory.

## Validation plan

Automated contracts:

- all Character Wealth rows and the level-1 15 gp baseline;
- price arithmetic across pp/gp/sp/cp and quantity;
- higher-level permanent-item allowance enforcement versus lump sum;
- source, rarity, item-level, and physical-type filtering;
- Adventurer's Pack recursive expansion and container links;
- stacking and duplicate retry behavior;
- insufficient budget and changed-policy preflight failures with zero writes;
- item-phase failure keeps the draft and does not apply currency;
- finalization failure retries without duplicate items or a second charge;
- existing inventory is preserved.

Live smoke should include a martial level-1 purchase, a caster level-1 purchase, Adventurer's Pack expansion, a higher-level permanent-item start, a higher-level lump-sum start, a supplemental-pack item, and a failure/retry case. Automatic Bonus Progression should receive a focused recommendation-copy check even if its full equipment implications remain a documented GM boundary.

## Open product questions for 0.8 planning

- Whether suggested loadouts ship in 0.8.0 or follow in 0.8.1 after real-player purchasing data.
- Whether existing actors with only PF2E-granted equipment can enter an additive flow automatically or always require review.
- Which non-common equipment rarities a GM ceiling should expose by default, and whether access rules need a separate approval marker.
- Whether custom wealth is one value per target level or a single GM-entered override for the current build.

None of these questions blocks the 0.7.2 apply seam. The apply contract should accept future prepared item and absolute currency phases without knowing the picker policy that produced them.
