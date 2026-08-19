# Starting Equipment Rules Assurance

Status: accepted assurance contract for the planned 0.8.0 release. This document owns provenance, interpretation, and drift behavior for starting-equipment rules. It deliberately does not duplicate all 20 Character Wealth rows.

Related documents:

- [Starting Equipment and Wealth Architecture](starting-equipment-and-wealth.md)
- [0.8.0 Starting Equipment implementation plan](../development/starting-equipment-0.8.0.md)

## Assurance boundaries

Starting equipment uses three kinds of source material, and each has a different trust contract.

| Material | Source of truth | Runtime behavior | Release assurance |
| --- | --- | --- | --- |
| Character Wealth numbers | Generated artifact from a pinned PF2E remaster fixture | Read the generated artifact | Deterministic generation plus installed-journal semantic comparison |
| Cart-legality rules | Individually cited GM Core and Player Core prose | Execute versioned semantic policy | Per-rule provenance ledger and focused semantic tests |
| Quick Equipment Packages | Cited Player Core guidance, if the expansion ships | Resolve package entries against installed Item documents | Source/edition labels, price checks, and no claim of completeness |

The repository does not depend on a user's PDFs at runtime and must not check private rulebook files into source. During planning on 2026-08-15, the relevant pages were reviewed from licensed local copies: Player Core pages 25, 267–270; Player Core 2 pages 58, 75, 103, and 277; and GM Core pages 9, 22–23, 59, 61, 67, and 83–85.

## Generated Character Wealth policy

### Pinned source

The initial generator fixture is the remastered PF2E 8.4.0 GM Screen journal at commit `90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1`:

- upstream path: `packs/pf2e/journals/gm-screen.json`;
- journal ID: `S55aqwWIzpQRFhcq`;
- page ID: `Dae8LHdXZuBv06Jk`; and
- journal footer attribution: GM Core pages 59/61;
- Party Treasure printed rule page: GM Core page 59; and
- Character Wealth printed rule page: GM Core page 61.

PF2E's immediately preceding Party Treasure table has similar cell grammar, 20 plausible level rows, and a Currency column. The extractor cannot identify Character Wealth from row shape alone.

### Extractor contract

Generation fails unless the fixture satisfies every structural assertion:

- normalized section heading exactly `Character Wealth`;
- the selected table contains both `pf2e` and `remaster` class tokens;
- exact ordered headers `Level`, `Permanent Items`, `Currency`, `Lump Sum`;
- exact GM Core page attribution 59/61;
- exactly 20 unique, ordered rows for levels 1 through 20;
- every denomination and allowance cell parses without ignored residue;
- level 1 has no permanent allowance, 15 gp currency, and a 15 gp lump sum; and
- level 5 has 4th×1, 3rd×2, 2nd×1, and 1st×2, plus 50 gp, or a 270 gp lump sum.

The checked-in fixture contains only normalized mechanics and provenance, never raw journal HTML or surrounding prose. Capture reads the exact upstream document at the pinned commit, validates the complete page and selected table digests, and emits the normalized fixture. A small synthetic negative fixture proves that the Party Treasure heading is rejected; another removes the remaster table marker to prove that a pre-remaster shape is not silently accepted.

### Generated provenance

The checked-in artifact includes:

- policy and schema versions;
- PF2E version and commit;
- journal and page IDs;
- normalized table identity;
- full upstream page digest;
- selected raw table digest;
- normalized fixture digest;
- normalized semantic-data digest;
- generator version; and
- generated-artifact digest.

Digest scopes are intentionally distinct. The source and table digests bind extraction to reviewed upstream bytes. The fixture digest binds the complete checked-in generator input. The semantic-data digest covers normalized rows only and is the identity consumed by later draft and policy stories. The artifact digest covers the complete generated payload except its own digest. A provenance-only refresh therefore does not falsely invalidate an otherwise identical acquisition draft.

Generation is deterministic. CI regenerates into a comparison target and fails when the checked-in artifact is stale. The runtime never parses journal HTML and never changes policy merely because PF2E was updated.

### Compatibility drift

Compatibility smoke locates and structurally validates the installed Character Wealth table, normalizes it through the same semantic representation, and compares it with the checked-in artifact.

- Exact semantic equality qualifies the installed PF2E version for this rule surface.
- A `diff` result is additionally classified as `structural` or `semantic` for review; both are compatibility findings.
- A mismatch does not become an automatic migration, localized HTML fallback, or silent behavior change.
- Advancing the generated policy requires an explicit source-review change with updated provenance and tests.

### Attribution and license treatment

The normalized Character Wealth rows are derived from Pathfinder GM Core game mechanics. This technical story records the exact source and normalized-data provenance needed to review future policy changes; Wayfinder's product-level notices are maintained separately in `LEGAL.md` and `licenses/`.

Raw journal HTML, surrounding prose, compendium documents, and private PDFs remain excluded from the repository. This provenance record is an engineering assurance boundary, not a separate publication gate.

## Cited semantic policy

The GM Screen journal supplies the table but not the prose that determines whether a purchase is legal. The implementation therefore maintains a rule ledger. Each entry contains a stable key, concise behavior, edition, official book/page, Archives of Nethys identifier when available, ambiguity or retained GM judgment, semantic test IDs, and last verification date.

Initial ledger:

| Rule key | Wayfinder behavior | Primary citation | Classification |
| --- | --- | --- | --- |
| `level-1-starting-money` | A level-1 character has 15 gp to spend on equipment; remaining denominations are retained. | Player Core p. 25 | Executable rule |
| `higher-level-character-wealth` | A new or replacement higher-level character uses Character Wealth; the items are common and player-selected within GM availability. | GM Core pp. 61, 67; [AoN 2684](https://2e.aonprd.com/Rules.aspx?ID=2684) | Executable rule |
| `wealth-recipes-are-alternatives` | Permanent items plus currency and lump sum are alternatives and never combine. | GM Core p. 61 | Executable rule |
| `party-size-is-separate` | Party-size treasure adjustments do not modify an individual new character's Character Wealth recipe. | GM Core p. 61 | Executable boundary |
| `baseline-permanent-item` | One listed allowance buys one baseline item; configured weapon/armor treatment must preserve that single-item boundary. | GM Core p. 61 | Executable rule with adapter mapping |
| `property-and-material-cost` | Property runes and precious-material cost are funded separately from the baseline weapon or armor. | GM Core p. 61 | Executable rule |
| `permanent-residual-spending` | Currency in the permanent-item recipe buys consumables or permanent items below the character's starting level; unspent value remains coinage. | GM Core p. 61 | Executable rule |
| `lower-level-substitution` | A lower-level permanent item may consume a listed allowance. | GM Core p. 61 | Executable rule |
| `no-substitution-rebate` | Choosing below an allowance level does not grant additional currency. | GM Core p. 61 | Executable rule |
| `lump-sum-item-cap` | The optional lump sum buys common items with maximum item level equal to character level minus 1. | GM Core p. 61 | Executable rule |
| `rarity-discretion` | Restricted starting items beyond blanket GM policy or explicit character Access require a recorded GM decision. | GM Core p. 61 | Authority policy |
| `source-rarity-and-access` | Automatic availability is bounded by GM-approved sources; explicit character Access can authorize a restricted option independently of blanket rarity policy. | GM Core pp. 9, 22–23 | Authority policy |
| `extra-current-level-item` | A character joining a party partway through a level may receive an additional current-level permanent allowance; it is not converted into cash or used to bypass the lump-sum item cap. | GM Core p. 61 | Explicit GM judgment |
| `inherited-party-wealth` | Inherited gear can justify reducing new-character wealth or later rewards. | GM Core p. 61 | Explicit GM judgment |
| `explicit-zero-price` | An explicit zero is a valid base Price; material/configuration adjustments still apply before final price, while absent or unparseable Price is never silently free. | Player Core p. 267 | Executable rule |
| `size-priced-equipment` | Small/Medium use standard price; ordinary larger gear scales by size, high-priced magic items retain listed price, and precious materials use adjusted Bulk. | Player Core p. 270 | Executable rule |
| `class-granted-equipment` | A formula book or similar physical item explicitly granted by the current class build is not charged against starting wealth; grant provenance must be planned, not inferred from arbitrary inventory. | Player Core 2 pp. 58, 103 | Executable funding boundary |
| `titan-mauler-weapon` | The free grant is one Large weapon for a Small or Medium character, otherwise one weapon for a creature one size larger: melee or ranged, Common or specifically accessed, and base Price at most 9 gp before the size adjustment. It has no resale value before later rune investment. | Player Core 2 p. 75 | Executable funding and eligibility boundary |
| `automatic-bonus-progression` | ABP usually preserves currency while removing potency/striking/resilient and redundant numerical-item assumptions; Wayfinder does not invent a replacement Character Wealth table or blanket-remove property runes, consumables, scrolls, or wands. | GM Core p. 83 | Variant boundary |
| `level-0-starting-money` | The Level 0 variant has a separate 5 gp start and is not extrapolated from level 1. | GM Core pp. 84–85 | Explicit 0.8.0 non-goal |

Tests for an executable rule are derived from its cited distinction. For example, the lower-level test proves both a valid allowance substitution and unchanged currency; the lump-sum test proves both Common eligibility and the character-level-minus-1 cap. A generic “wealth table verified” test cannot stand in for these semantics.

An unresolved interpretation blocks only the affected capability. It does not get hidden behind numeric fixture success. GM-judgment entries are represented as explicit, reasoned overrides and are never inferred from actor history.

## Official Quick Equipment Packages

Player Core page 268 and Player Core 2 page 277 publish Quick Equipment Packages for all 16 classes in those two books. This corrects a distinction that PF2E's machine data alone obscures: remaster system packs removed class-kit documents, but the remastered books still provide official package guidance.

If the recommended 0.8.0 package expansion ships:

- store a cited, versioned package definition rather than presenting it as PF2E compendium data;
- distinguish required package entries from optional follow-up purchases;
- resolve each item by stable source identity and recheck its installed price and quantity;
- show book, page, and edition in the explanation;
- cover all 16 reviewed remaster classes or keep the entire preset slice out of the release;
- never claim packages cover a class or sourcebook that was not reviewed; and
- label any separately derived Wayfinder suggestion as non-official guidance.

Package guidance never widens rarity, source, budget, or GM authority. If an installed document no longer matches the cited package, the package becomes unavailable with a diagnostic instead of silently substituting another item.

## Review and update procedure

Any rules-policy change includes all applicable evidence in one review:

1. Identify whether the change affects generated numbers, semantic rules, package guidance, or more than one ledger.
2. Review the cited remaster source and record edition, page, and verification date.
3. Update only the affected versioned artifact or rule entry.
4. Add or update the semantic distinction test.
5. Regenerate and prove a clean-tree result when numeric policy changed.
6. Run installed-version comparison and the affected live acquisition case.
7. Review attribution and supported-version implications before merge.

Rules evidence supports an implementation decision; it does not grant permission to redistribute private PDF files or long excerpts.
