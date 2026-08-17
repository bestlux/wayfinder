# Rules, licenses, and source provenance

Wayfinder uses a layered compliance model because its original software, game
mechanics, trademarks, runtime dependencies, and promotional media do not share
one permission basis.

The canonical, packaged inventory is
[`licenses/rules-sources.json`](../../licenses/rules-sources.json). This page
explains how to maintain it. Its current `partial-audit-release-blocked` status
is deliberate: a `resolved` row means its present source/license/notice mapping
is internally coherent, not that the repository-wide inventory is exhaustive.

## Status model

- `resolved`: the behavior has an identified source, license, notice, and code
  boundary.
- `notice-page-needed`: a provisional creator string is backed by a reliable
  public source, but the actual book ORC/copyright page must still be checked.
- `provenance-review`: upstream records disagree or derivation is not yet
  pinned tightly enough.
- `counsel-review`: code history or product-wide license scope spans OGL and
  ORC material and needs a recorded disposition.
- `replace-before-release`: the current asset may not be redistributed in the
  next listing without replacement or specific permission.
- `review-recommended`: a non-blocking branding or policy question that should
  be periodically revisited.

Development validation accepts explicit unresolved states so work can
continue. Release validation fails while `releaseBlockers` is nonempty.

## Compliance boundaries

1. Original Wayfinder software remains under `LICENSE.md`.
2. ORC mechanics are attributed in `licenses/ORC-NOTICE.md`.
3. Retained OGL mechanics are identified in
   `licenses/OPEN-GAME-LICENSE-1.0A.md` and mapped to capability IDs.
4. Paizo names and permitted descriptive references use the current Community
   Use Policy while the project remains free and unofficial.
5. Runtime interoperability with PF2E is not treated as redistribution of the
   installed system's compendium data or artwork.
6. Every shipped image, font, icon, copied code fragment, and fixture excerpt
   needs an independent permission or provenance record.

## Adding or changing a rule implementation

Before merging a new hardcoded mechanic:

1. Assign a stable `capabilityId`.
2. Record the exact source work, edition/printing, page or section when known,
   and license. Missing page-level evidence must remain explicit rather than
   being invented.
3. Record the code and focused-test files that embody the rule where focused
   tests exist; otherwise add a traceability blocker.
4. Add the source work's exact attribution to the correct shipped notice.
5. If the source designation is ambiguous, add a release blocker rather than
   guessing.
6. Prefer runtime interpretation of installed structured data over copying
   prose, tables, or artwork.

Equivalent mechanics appearing in multiple books do not automatically create
dual provenance. Record the work actually used to derive the implementation.
When history genuinely spans an OGL original and ORC remaster, preserve both
notices until a documented clean-source reimplementation or legal review says
otherwise.

That per-capability inventory is evidence, not a way around license scope. The
ORC treats a product for one playable game as one Work, and the official AxE
states that OGL content cannot simply be relicensed into an ORC product. The
current mixed repository is therefore intentionally blocked from release until
qualified counsel approves a genuinely separate-work structure or the OGL
dependencies are removed and cleanly reimplemented from ORC material.

## Current manual evidence needed

The next release remains blocked pending:

- the legal/copyright/ORC notice pages from Pathfinder Guns & Gears Remastered,
  Pathfinder Impossible Magic, and Pathfinder Dark Archive (Remastered);
- a product-wide disposition for combining an ORC single-game Work with any
  retained OGL-only mechanics; capability-level labels are not enough;
- disposition of mixed Magus, Summoner, and Psychic implementation history;
- resolution of PF2E's conflicting Kineticist/Rage of Elements metadata;
- completion of the remaining hardcoded-rule and public-fixture inventory;
- trademark clearance or a rename disposition for the `Wayfinder` project
  name; and
- a comparative review of the current PF2E-adjacent visual treatment against
  Paizo's trade-dress restriction.

The preferred evidence is a photo or scan of the relevant legal page from a
legitimately obtained copy. Store private purchase records outside the
repository; commit only the necessary attribution text and a provenance note.

## Source baselines

The current PF2E baseline for this ledger is PF2E 8.4.0 commit
`90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1`. The PF2E project is a useful
technical provenance source, but its Paizo-Foundry partnership and artwork
permissions are not grants to Wayfinder.

AoN is useful as a corroborating source/page index, not as Wayfinder's
permission basis. AoN also operates under a special current relationship with
Paizo.

## Not legal advice

This is an engineering compliance record. It is designed to prevent accidental
omission and false licensing claims, not to replace advice from a qualified IP
attorney.
