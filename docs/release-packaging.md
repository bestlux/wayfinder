# Release packaging

Maintainer reference for cutting a Wayfinder release.

The `module.json` checked into the repo is the **development** manifest. The release pipeline patches it into an installable Foundry manifest with a version-specific `download` URL, then builds a zip alongside it.

## Cut a local package

```powershell
npm run package
```

For a CI-style dry run after validation has already passed:

```powershell
node tools/release/prepare-package.mjs --version 0.1.0 --tag v0.1.0 --repo bestlux/wayfinder
```

Outputs land in `dist/release/`:

| File | Purpose |
| --- | --- |
| `module.json` | Release manifest. Upload to the GitHub Release and register with Foundry package admin for that exact version. |
| `module.zip` | Foundry-installable archive. |
| `package-manifest.json` | Records the emitted URLs, the zip's SHA-256, and the exact archive entries — useful for inspection and CI checks. |

The archive intentionally ships only installable assets: `module.json`, generated `scripts/`, `styles/`, `templates/`, `lang/`, and top-level release docs like the README. It excludes `src/`, `tests/`, `node_modules/`, source maps, build config, workflow files, and other development-only content.

Marketplace media lives in the repo-level `media/` folder and is referenced from `module.json` with `raw.githubusercontent.com` URLs. Those images are intentionally not included in `module.zip`; publish them by committing them to the repository's default branch before cutting or replacing a release manifest.

## Publish through GitHub

1. Bump `package.json` and `module.json` to the same version.
2. Run `npm run check`.
3. Commit, tag the commit as `vX.Y.Z`, and push the tag.
4. `.github/workflows/release.yml` validates the repo, builds the package, and attaches the release manifest and zip to the GitHub Release.

## Foundry package listing

When registering a version with Foundry's package admin, use the **version-specific** manifest URL — not the `/latest/` URL:

```text
https://github.com/bestlux/wayfinder/releases/download/vX.Y.Z/module.json
```

The `/latest/` URL is what end users put in Foundry's installer. Each released manifest's `download` field points at the matching version-specific zip, so existing users update through Foundry's package updater and older releases remain installable from their own release pages.

## Tokens

Foundry's Package Release API requires a private package token. If package-admin publishing is automated later, keep that token in repository secrets and never commit it.
