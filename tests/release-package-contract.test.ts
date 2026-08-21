import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compareGeneratedScriptDirectories } from "../tools/release/check-generated-scripts.mjs";
import {
  requiredPackageEntries,
  requiredPackageEntriesForManifest,
  validatePackageEntries,
} from "../tools/release/prepare-package.mjs";

const moduleManifest = JSON.parse(readFileSync(resolve("module.json"), "utf8"));

const requiredNotices = [
  "LEGAL.md",
  "LICENSE.md",
  "licenses/OPEN-GAME-LICENSE-1.0A.md",
  "licenses/ORC-NOTICE.md",
  "licenses/THIRD-PARTY-NOTICES.md",
];

describe("release package contract", () => {
  it("requires the concise notice set and original runtime icon", () => {
    expect(requiredPackageEntries).toEqual(expect.arrayContaining([...requiredNotices, "assets/wayfinder-entry.svg"]));
    expect(requiredPackageEntries).not.toContain("licenses/rules-sources.json");
    const completeEntries = requiredPackageEntriesForManifest(moduleManifest);
    expect(() => validatePackageEntries(completeEntries, moduleManifest)).not.toThrow();

    for (const notice of requiredNotices) {
      expect(() =>
        validatePackageEntries(
          completeEntries.filter((entry) => entry !== notice),
          moduleManifest
        )
      ).toThrow(/missing required entries/i);
    }
  });

  it("derives every shipped module, style, and locale from module.json", () => {
    const required = requiredPackageEntriesForManifest(moduleManifest);
    expect(required).toEqual(
      expect.arrayContaining(["scripts/wayfinder.js", "styles/wayfinder.css", "lang/en.json", "lang/cn.json"])
    );

    for (const referenced of ["scripts/wayfinder.js", "styles/wayfinder.css", "lang/en.json", "lang/cn.json"]) {
      expect(() =>
        validatePackageEntries(
          required.filter((entry) => entry !== referenced),
          moduleManifest
        )
      ).toThrow(new RegExp(referenced.replace(".", "\\."), "u"));
    }
    expect(() =>
      requiredPackageEntriesForManifest({ ...moduleManifest, languages: [{ lang: "cn", path: "../lang/cn.json" }] })
    ).toThrow(/normalized relative package path/i);
  });

  it("rejects development documents and redistributed books or compendium packs", () => {
    const completeEntries = requiredPackageEntriesForManifest(moduleManifest);
    expect(() => validatePackageEntries([...completeEntries, "docs/legal/internal.md"], moduleManifest)).toThrow(
      /forbidden development entries/i
    );
    expect(() => validatePackageEntries([...completeEntries, "packs/rules.db"], moduleManifest)).toThrow(
      /forbidden development entries/i
    );
    expect(() => validatePackageEntries([...completeEntries, "assets/rulebook.pdf"], moduleManifest)).toThrow(
      /forbidden development entries/i
    );
    expect(() => validatePackageEntries([...completeEntries, "assets/unreviewed.webp"], moduleManifest)).toThrow(
      /unreviewed asset entries/i
    );
    expect(() => validatePackageEntries([...completeEntries, "assets/unreviewed.avif"], moduleManifest)).toThrow(
      /unreviewed asset entries/i
    );
  });

  it("rejects package entries that cannot round-trip across Windows and CI", () => {
    const completeEntries = requiredPackageEntriesForManifest(moduleManifest);
    for (const entry of ["lang/con?.json", "lang/CON.json", "lang/trailing. "]) {
      expect(() => validatePackageEntries([...completeEntries, entry], moduleManifest), entry).toThrow(
        /Windows-portable package path/i
      );
    }
    expect(() =>
      validatePackageEntries([...completeEntries, "lang/Case.json", "lang/case.json"], moduleManifest)
    ).toThrow(/case-insensitive filesystems/i);
  });

  it("detects missing and changed generated script output without mutating the checked-in tree", async () => {
    const root = join(tmpdir(), `wayfinder-generated-contract-${process.pid}-${Date.now()}`);
    const checkedInRoot = join(root, "checked");
    const candidateRoot = join(root, "nested", "candidate");
    mkdirSync(checkedInRoot, { recursive: true });
    mkdirSync(candidateRoot, { recursive: true });

    try {
      writeFileSync(join(checkedInRoot, "same.js"), "export const same = true;\n");
      writeFileSync(join(candidateRoot, "same.js"), "export const same = true;\n");
      writeFileSync(join(checkedInRoot, "changed.js"), "export const value = 1;\n");
      writeFileSync(join(candidateRoot, "changed.js"), "export const value = 2;\n");
      writeFileSync(join(candidateRoot, "missing.js"), "export const missing = true;\n");
      writeFileSync(
        join(checkedInRoot, "same.js.map"),
        JSON.stringify({ version: 3, file: "same.js", sources: ["../src/same.ts"], names: [], mappings: "AAAA" })
      );
      writeFileSync(
        join(candidateRoot, "same.js.map"),
        JSON.stringify({ version: 3, file: "same.js", sources: ["../../src/same.ts"], names: [], mappings: "AAAA" })
      );

      await expect(
        compareGeneratedScriptDirectories({ checkedInRoot, candidateRoot, repoRoot: root })
      ).resolves.toEqual(["changed output changed.js", "missing checked-in output missing.js"]);
      expect(readFileSync(join(checkedInRoot, "changed.js"), "utf8")).toBe("export const value = 1;\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("binds generated wealth and scripts checks before the release build", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const checkStages = packageJson.scripts.check.split(" && ");
    expect(packageJson.scripts["check:character-wealth"]).toMatch(/generate-character-wealth.*--check/u);
    expect(packageJson.scripts["check:generated-scripts"]).toBe("node tools/release/check-generated-scripts.mjs");
    expect(checkStages).toEqual(
      expect.arrayContaining([
        "npm run check:character-wealth",
        "npm run check:generated-scripts",
        "npm run build",
        "npm test",
      ])
    );
    expect(checkStages.indexOf("npm run check:character-wealth")).toBeLessThan(checkStages.indexOf("npm run build"));
    expect(checkStages.indexOf("npm run check:generated-scripts")).toBeLessThan(checkStages.indexOf("npm run build"));
  });

  it("keeps shipped source surfaces free of direct PF2E artwork dependencies", () => {
    const roots = ["src", "scripts", "styles", "templates"];
    const files = roots.flatMap((root) => listTextFiles(resolve(root)));
    files.push(resolve("module.json"), resolve("README.md"));

    for (const file of files) {
      expect(readFileSync(file, "utf8"), relative(process.cwd(), file)).not.toMatch(
        /systems\/pf2e\/(?:assets|icons)\//u
      );
    }
  });

  it("builds a normal release package without inspection-only qualification metadata", { timeout: 15_000 }, () => {
    const output = "dist/test-release-package-contract";
    rmSync(resolve(output), { force: true, recursive: true });

    try {
      execFileSync(
        process.execPath,
        ["tools/release/prepare-package.mjs", "--repo", "bestlux/wayfinder", "--out", output],
        { stdio: "pipe" }
      );
      const manifest = JSON.parse(readFileSync(resolve(output, "package-manifest.json"), "utf8"));

      expect(manifest).not.toHaveProperty("legalQualification");
      expect(manifest.entries).not.toContain("INSPECTION-ONLY.txt");
      expect(existsSync(resolve(output, "INSPECTION-ONLY.txt"))).toBe(false);
      expect(existsSync(resolve(output, "module.zip"))).toBe(true);
    } finally {
      rmSync(resolve(output), { force: true, recursive: true });
    }
  });
});

function listTextFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listTextFiles(path);
    return [".css", ".hbs", ".js", ".json", ".ts"].includes(extname(entry.name)) ? [path] : [];
  });
}
