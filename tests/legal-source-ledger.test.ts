import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertLegalReadiness,
  inspectLegalReadiness,
  validateRulesSourceLedger,
} from "../tools/legal/validate-rules-sources.mjs";
import {
  buildLegalQualification,
  requiredPackageEntries,
  validatePackageEntries,
} from "../tools/release/prepare-package.mjs";

const repoRoot = resolve(".");
const actualLedger = JSON.parse(readFileSync(resolve("licenses/rules-sources.json"), "utf8"));

function cloneLedger(): typeof actualLedger {
  return structuredClone(actualLedger);
}

describe("Wayfinder legal source ledger", () => {
  it("validates the development ledger while reporting explicit release blockers", async () => {
    const result = await inspectLegalReadiness({ rootDir: repoRoot });

    expect(result.errors).toEqual([]);
    expect(result.blockerIds).toContain("verify-impossible-magic-notice");
    expect(result.blockerIds).toContain("resolve-orc-ogl-product-scope");
    expect(result.blockerIds).toContain("clear-wayfinder-project-name");
    expect(result.warnings).toEqual([expect.stringMatching(/release remains blocked/i)]);
  });

  it("fails release qualification on blockers and every unresolved ledger class", async () => {
    await expect(assertLegalReadiness({ rootDir: repoRoot, release: true })).rejects.toThrow(
      /Release legal qualification is blocked by/
    );
    await expect(assertLegalReadiness({ rootDir: repoRoot, release: true })).rejects.toThrow(/unresolved works/);
    await expect(assertLegalReadiness({ rootDir: repoRoot, release: true })).rejects.toThrow(/unresolved capabilities/);
    await expect(assertLegalReadiness({ rootDir: repoRoot, release: true })).rejects.toThrow(/unresolved assets/);
  });

  it("rejects self-asserted resolution without independently pinned resolution evidence", async () => {
    const ledger = cloneLedger();
    ledger.traceabilityStatus = "complete";
    for (const work of ledger.works) work.status = "verified";
    for (const capability of ledger.capabilities) capability.status = "resolved";
    for (const asset of ledger.assets) asset.status = "resolved";
    for (const blocker of ledger.releaseBlockers) {
      blocker.status = "resolved";
      blocker.resolvedAt = "2026-08-16";
      blocker.resolutionEvidence = ["docs/legal/unreviewed-self-assertion.md"];
    }

    const result = await validateRulesSourceLedger(ledger, { rootDir: repoRoot, release: true });
    expect(result.errors).toContainEqual(expect.stringMatching(/reviewed inventory identity changed/i));
    expect(result.blockerIds).toEqual([]);
  });

  it("requires resolved blocker records to retain a date and evidence", async () => {
    const ledger = cloneLedger();
    ledger.releaseBlockers[0].status = "resolved";

    const result = await validateRulesSourceLedger(ledger, { rootDir: repoRoot });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/must record an ISO resolution date/i),
        expect.stringMatching(/must retain non-empty, unique resolution evidence/i),
      ])
    );
  });

  it("rejects duplicate identities, unknown works, local paths, and missing files", async () => {
    const ledger = cloneLedger();
    ledger.capabilities.push(structuredClone(ledger.capabilities[0]));
    ledger.capabilities[0].sourceWorks = ["not-a-real-work"];
    ledger.works[0].attributionEvidence = ["D:/private/pf2e/license.md:10"];
    ledger.assets[0].paths = ["assets/not-present.svg"];

    const result = await validateRulesSourceLedger(ledger, { rootDir: repoRoot });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/duplicate identifier core-character-progression/i),
        expect.stringMatching(/unknown work not-a-real-work/i),
        expect.stringMatching(/workstation-local path/i),
        expect.stringMatching(/asset wayfinder-entry-icon path does not resolve/i),
      ])
    );
  });

  it("rejects a ledger trimmed down to the former sentinel inventory", async () => {
    const ledger = cloneLedger();
    ledger.works = ledger.works.filter((work: { key: string }) =>
      ["player-core", "gm-core", "core-rulebook", "gamemastery-guide"].includes(work.key)
    );
    ledger.capabilities = ledger.capabilities.filter((capability: { capabilityId: string }) =>
      [
        "core-character-progression",
        "character-wealth",
        "gradual-ability-boosts",
        "legacy-voluntary-flaws",
        "clan-dagger-manual-grant",
      ].includes(capability.capabilityId)
    );
    ledger.assets = ledger.assets.filter((asset: { assetId: string }) =>
      ["wayfinder-entry-icon", "wayfinder-project-name", "wayfinder-ui-trade-dress"].includes(asset.assetId)
    );
    ledger.traceabilityStatus = "complete";
    ledger.releaseBlockers = [];
    for (const work of ledger.works) work.status = "verified";
    for (const capability of ledger.capabilities) capability.status = "resolved";
    for (const asset of ledger.assets) asset.status = "resolved";

    const result = await validateRulesSourceLedger(ledger, { rootDir: repoRoot, release: true });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/missing expected work inventory entry impossible-magic/i),
        expect.stringMatching(/missing expected capability inventory entry necromancer-dirge/i),
        expect.stringMatching(/missing expected asset inventory entry legacy-release-listing-media/i),
      ])
    );
  });

  it("binds each work and capability to the correct notice and license chain", async () => {
    const ledger = cloneLedger();
    ledger.works[0].noticeFile = "README.md";
    ledger.works[1].title = "Generic Guide";
    ledger.works[2].attributionEvidence = ["https://example.invalid/forged-notice"];
    ledger.capabilities[0].licenses = ["OGL-1.0a"];
    ledger.downstreamAttribution = "Unreviewed Game Mechanics © 2026 Someone.";

    const result = await validateRulesSourceLedger(ledger, { rootDir: repoRoot });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/work player-core must use licenses\/ORC-NOTICE\.md/i),
        expect.stringMatching(/work gm-core title must be exactly "Pathfinder GM Core"/i),
        expect.stringMatching(/unreviewed evidence host/i),
        expect.stringMatching(/capability core-character-progression licenses must exactly match/i),
        expect.stringMatching(/downstreamAttribution must be exactly/i),
      ])
    );
  });

  it("marks the inherited OGL Section 15 chain provisional and keeps exact downstream credit", () => {
    const oglNotice = readFileSync(resolve("licenses/OPEN-GAME-LICENSE-1.0A.md"), "utf8");
    const orcNotice = readFileSync(resolve("licenses/ORC-NOTICE.md"), "utf8");

    expect(oglNotice).toContain("The complete inherited Section 15 chain has not yet been verified");
    expect(oglNotice).toContain("Pathfinder Core Rulebook (Second Edition) © 2019, Paizo Inc.; Designers:");
    expect(oglNotice).toContain(actualLedger.downstreamAttribution);
    expect(orcNotice).toContain(actualLedger.downstreamAttribution);
  });

  it("rejects release qualification while packaged notices still describe unresolved review", async () => {
    const ledger = cloneLedger();
    ledger.traceabilityStatus = "complete";
    for (const work of ledger.works) work.status = "verified";
    for (const capability of ledger.capabilities) capability.status = "resolved";
    for (const asset of ledger.assets) asset.status = "resolved";
    for (const blocker of ledger.releaseBlockers) {
      blocker.status = "resolved";
      blocker.resolvedAt = "2026-08-16";
      blocker.resolutionEvidence = ["docs/legal/unreviewed-self-assertion.md"];
    }

    const result = await inspectLegalReadiness({ rootDir: repoRoot, release: true, ledger });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/LEGAL\.md still contains unresolved publication-blocking notice text/i),
        expect.stringMatching(/ORC-NOTICE\.md still contains unresolved publication-blocking notice text/i),
        expect.stringMatching(
          /OPEN-GAME-LICENSE-1\.0A\.md still contains unresolved publication-blocking notice text/i
        ),
        expect.stringMatching(/THIRD-PARTY-NOTICES\.md still contains unresolved publication-blocking notice text/i),
      ])
    );
  });

  it("rejects traversal even when the traversed path resolves to an existing file", async () => {
    const ledger = cloneLedger();
    ledger.assets[0].paths = ["../character-gen/package.json"];

    const result = await validateRulesSourceLedger(ledger, { rootDir: repoRoot });
    expect(result.errors).toContain(
      "asset wayfinder-entry-icon path does not resolve inside the repository: ../character-gen/package.json."
    );
  });

  it("never qualifies an inspection override even if its blocker list is empty", () => {
    expect(buildLegalQualification({ blockerIds: [] }, { inspectionOverride: true })).toEqual({
      passed: false,
      inspectionOverride: true,
      blockerIds: [],
    });
    expect(buildLegalQualification({ blockerIds: ["unresolved"] })).toEqual({
      passed: false,
      inspectionOverride: false,
      blockerIds: ["unresolved"],
    });
    expect(buildLegalQualification({ errors: ["invalid"], blockerIds: [] })).toEqual({
      passed: false,
      inspectionOverride: false,
      blockerIds: [],
    });
  });

  it("removes stale release artifacts before a blocked legal preflight exits", () => {
    mkdirSync(resolve("dist"), { recursive: true });
    const outputRoot = mkdtempSync(resolve("dist", "legal-stale-"));
    writeFileSync(resolve(outputRoot, "module.zip"), "stale release", "utf8");
    const relativeOutput = outputRoot.slice(repoRoot.length + 1);

    try {
      const result = spawnSync(
        process.execPath,
        ["tools/release/prepare-package.mjs", "--repo", "bestlux/wayfinder", "--out", relativeOutput],
        { cwd: repoRoot, encoding: "utf8" }
      );
      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/Release legal qualification is blocked/i);
      expect(existsSync(outputRoot)).toBe(false);
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });

  it("requires a distinct explicit output and publishes two inspection-only markers", () => {
    const defaultResult = spawnSync(
      process.execPath,
      ["tools/release/prepare-package.mjs", "--repo", "bestlux/wayfinder", "--allow-legal-blockers"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    expect(defaultResult.status).toBe(1);
    expect(`${defaultResult.stdout}\n${defaultResult.stderr}`).toMatch(/requires an explicit non-release --out/i);
    expect(existsSync(resolve("dist/release"))).toBe(false);

    mkdirSync(resolve("dist"), { recursive: true });
    const outputRoot = mkdtempSync(resolve("dist", "legal-inspection-"));
    const relativeOutput = outputRoot.slice(repoRoot.length + 1);
    try {
      const result = spawnSync(
        process.execPath,
        [
          "tools/release/prepare-package.mjs",
          "--repo",
          "bestlux/wayfinder",
          "--allow-legal-blockers",
          "--out",
          relativeOutput,
        ],
        { cwd: repoRoot, encoding: "utf8" }
      );
      expect(result.status).toBe(0);
      expect(existsSync(resolve(outputRoot, "INSPECTION-ONLY.txt"))).toBe(true);
      expect(existsSync(resolve(outputRoot, "package/INSPECTION-ONLY.txt"))).toBe(true);
      const summary = JSON.parse(readFileSync(resolve(outputRoot, "package-manifest.json"), "utf8"));
      expect(summary.legalQualification).toMatchObject({ passed: false, inspectionOverride: true });
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });

  it("requires the complete legal chain and original assets in every package", () => {
    expect(requiredPackageEntries).toEqual(
      expect.arrayContaining([
        "LEGAL.md",
        "LICENSE.md",
        "assets/wayfinder-entry.svg",
        "licenses/ORC-NOTICE.md",
        "licenses/OPEN-GAME-LICENSE-1.0A.md",
        "licenses/THIRD-PARTY-NOTICES.md",
        "licenses/rules-sources.json",
      ])
    );
    expect(() => validatePackageEntries(requiredPackageEntries)).not.toThrow();
    expect(() => validatePackageEntries(requiredPackageEntries.filter((entry) => entry !== "LEGAL.md"))).toThrow(
      /LEGAL\.md/
    );
    expect(() => validatePackageEntries([...requiredPackageEntries, "docs/legal/internal.md"])).toThrow(
      /forbidden development entries/i
    );
  });
});
