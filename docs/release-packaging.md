# Release packaging

Maintainer reference for cutting a Wayfinder release.

The `module.json` checked into the repo is the **development** manifest. The release pipeline patches it into an installable Foundry manifest with a version-specific `download` URL, then builds a zip alongside it.

## Cut a local package

`npm run package` is the ordinary local artifact path. It runs the repository checks and builds an installable package, but it does not bind live release evidence:

```powershell
npm run package
```

## Qualify a release candidate

The committed PF2E physical-grant registry and generated Markdown report are checked by ordinary `npm run check` without requiring an external checkout. Before qualified packaging, run the release-only source gate against the exact clean PF2E pin. Set `PF2E_REPO` when the checkout is not in a conventional sibling location:

```powershell
$env:PF2E_REPO = "D:\Source\pf2e"
npm run check:physical-grants
```

That gate verifies the exact Git commit and clean status, corpus and level-1 counts, declared links/rules/prose canaries, and bidirectional scanner binding. It is intentionally not part of `npm run check` or tag CI because those lanes do not own the pinned PF2E source checkout.

After the exact candidate is committed under a durable branch or tag ref and its WF-080-51 artifact is available, build the evidence-bound package:

```powershell
npm run package:qualified -- --wf51 .wayfinder-smoke\wf51-release-candidate --ref codex/release-candidate
```

`package:qualified` rechecks generated policy artifacts, binds the current physical-grant registry and WF-080-51 evidence to the exact candidate, builds the package under `dist/qualified-release/`, and writes `package-evidence.json`. The later tag workflow rebuilds the same candidate for public release; the qualified package is the pre-tag evidence contract.

For a CI-style dry run after validation has already passed:

```powershell
node tools/release/prepare-package.mjs --version X.Y.Z --tag vX.Y.Z --repo bestlux/wayfinder
```

Outputs land in `dist/release/`:

| File | Purpose |
| --- | --- |
| `module.json` | Release manifest. Upload to the GitHub Release and register with Foundry package admin for that exact version. |
| `module.zip` | Foundry-installable archive. |
| `package-manifest.json` | Records the emitted URLs, the zip's SHA-256, and the exact archive entries — useful for inspection and CI checks. |

The tag workflow also emits `dist/release/release-notes.md` by extracting the matching version section from `CHANGELOG.md`. To generate it locally:

```powershell
node tools/release/extract-release-notes.mjs --version X.Y.Z --out dist/release/release-notes.md
```

The archive intentionally ships only installable assets: `module.json`, generated `scripts/`, `styles/`, `templates/`, `lang/`, original `assets/`, and top-level release docs like the README. `LEGAL.md`, `LICENSE.md`, and the ORC/OGL/third-party notices are required archive entries. It excludes `src/`, `tests/`, `node_modules/`, source maps, build config, workflow files, and other development-only content.

Marketplace media, when present, lives in the repo-level `media/` folder and is referenced from `module.json` with tag-pinned `raw.githubusercontent.com` URLs for each release. Those images are intentionally not included in `module.zip`; publish them by committing them before cutting the matching tag. The current development manifest omits media, and the prior PF2E-art/rules screenshots have been removed from the repository. Any replacement must use synthetic names and copy plus original or independently licensed art. If a screenshot needs to change after release, cut a new version instead of mutating the old listing.

## Public readiness checklist

Before making the repository public or submitting a Foundry package listing:

- Confirm the GitHub repository, release assets, and tag-pinned `media/` URLs are publicly reachable without authentication.
- Confirm `module.json` has author contact metadata, including Discord handle when available.
- Confirm `README.md`, `LEGAL.md`, `LICENSE.md`, every file under `licenses/`, `bugs`, `readme`, and `changelog` URLs are public and current.
- Confirm the exact Paizo Community Use notice and current project contact are visible in the README and reachable from Wayfinder's in-app feedback/legal surface.
- Review new prose, fixtures, and listing media for copied rules text or third-party artwork; automated checks cannot determine substantial similarity.
- Confirm compatibility metadata matches the intended support range and coverage docs state the exact smoke-tested Foundry/PF2E versions.
- Run a secret scan over tracked files and do not commit local Foundry credentials, browser state, package tokens, or `.env` files.

## Publish through GitHub

1. Bump `package.json` and `module.json` to the same version.
2. Add a `CHANGELOG.md` section for the version.
3. Build the exact candidate and run the current release smoke matrix in Foundry. Record the candidate version, Foundry/PF2E versions, scenario count, failures, and artifact directories in `docs/coverage/beta-readiness-smoke.md`.
4. Run `npm run check`, then commit the exact candidate under a durable release branch or candidate tag.
5. Run `npm run check:physical-grants` against the exact clean pinned PF2E source checkout.
6. Run `npm run package:qualified -- --wf51 <coordinator-artifact-directory> --ref <exact-candidate-ref>` and inspect `dist/qualified-release/package-evidence.json`, `package-manifest.json`, the generated release manifest, and the ZIP hash.
7. Extract and inspect the matching changelog notes with `npm run release:notes -- --version X.Y.Z --out dist/qualified-release/release-notes.md`.
8. Push the release commit. Tag that exact commit as `vX.Y.Z`, then push the tag.
9. `.github/workflows/release.yml` validates the repo, rebuilds the package, attaches the release manifest and zip to the GitHub Release, and uses the extracted changelog section as the GitHub Release body.
10. Verify the workflow, tag, GitHub Release, `module.json`, `module.zip`, package manifest, qualified evidence, and version-specific asset URLs independently before announcing the release or closing a release-blocked issue.

## Foundry package listing

When registering a version with Foundry's package admin, use the **version-specific** manifest URL — not the `/latest/` URL:

```text
https://github.com/bestlux/wayfinder/releases/download/vX.Y.Z/module.json
```

The `/latest/` URL is what end users put in Foundry's installer. Each released manifest's `download` field points at the matching version-specific zip, so existing users update through Foundry's package updater and older releases remain installable from their own release pages.

## Tokens

Foundry's Package Release API requires a private package token. Store it as the repository secret `FOUNDRY_PACKAGE_RELEASE_TOKEN`; never commit it and do not paste it into issue comments, release notes, or workflow logs.

On tag pushes, the release workflow downloads the built release manifest, waits for the version-specific GitHub asset URL to become reachable, runs a Foundry API dry run, and then registers the package version. If `FOUNDRY_PACKAGE_RELEASE_TOKEN` is not configured, the Foundry registration step is skipped with a workflow warning while the GitHub release still publishes.
