# Third-Party Notices

## Paizo Inc.

Pathfinder, Pathfinder Second Edition, and related names and marks are owned by
Paizo Inc. Wayfinder's required Community Use notice is reproduced in
[../LEGAL.md](../LEGAL.md). Game-mechanical material is separately identified
under the ORC License or Open Game License Version 1.0a.

Wayfinder does not claim ownership of Paizo names, game mechanics, prose,
artwork, icons, maps, trade dress, or other Paizo material. Descriptive
references to proper names and trademarks are made under Paizo's Community Use
Policy or as otherwise permitted by the applicable rules license.

## Foundry Gaming LLC

Foundry Virtual Tabletop is owned by Foundry Gaming LLC. Wayfinder is a package
designed to run only with a licensed copy of Foundry Virtual Tabletop under the
Limited License for Package Development in the Foundry Virtual Tabletop End
User License Agreement. Wayfinder is not affiliated with or endorsed by
Foundry Gaming LLC.

## PF2E system

Wayfinder requires the independently installed PF2E game system. It reads
public runtime interfaces and installed documents rather than redistributing
the system's compendium packs. Runtime paths that point to an installed system
or Foundry resource do not transfer ownership of that resource to Wayfinder.

The official PF2E system is developed under a Paizo-Foundry partnership. That
partnership and the PF2E project's separate artwork permissions do not extend
to Wayfinder.

## Wayfinder media

The current package and listing contain no Paizo or PF2E artwork, fonts, icons,
rulebook pages, or compendium packs. Future listing media must use original or
independently licensed artwork, synthetic data, and short original copy.

## fast-sha256-js

Wayfinder includes Dmitry Chestnykh's `fast-sha256-js` implementation in
`src/shared/vendor/fast-sha256.ts`, distributed as
`scripts/shared/vendor/fast-sha256.js`. The source comes from
[revision 3aef11eb8222f819dc255996d86ba976f205dca2](https://github.com/dchest/fast-sha256-js/blob/3aef11eb8222f819dc255996d86ba976f205dca2/src/sha256.ts).
The original source file's SHA-256 is
`648efef1072e47bff2a943338e3c40b5a723ec4094c08360e09aa1a643fff036`.

The implementation and its exports are retained; local changes consist of
provenance comments, one lint suppression, and repository formatting.
Wayfinder uses its SHA-256 hash function when the browser does not expose
Web Crypto's digest API.
Upstream dedicates the software to the public domain under the Unlicense;
the complete notice is retained in [FAST-SHA256-LICENSE.txt](FAST-SHA256-LICENSE.txt).

## Development dependencies

Development-only tools such as TypeScript, Vitest, ESLint, Biome, and
Playwright are not bundled into the Wayfinder module ZIP. Their own licenses
continue to apply in the development environment.
