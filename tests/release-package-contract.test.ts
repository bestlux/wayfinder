import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredPackageEntries, validatePackageEntries } from "../tools/release/prepare-package.mjs";

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
    expect(() => validatePackageEntries(requiredPackageEntries)).not.toThrow();

    for (const notice of requiredNotices) {
      expect(() => validatePackageEntries(requiredPackageEntries.filter((entry) => entry !== notice))).toThrow(
        /missing required entries/i
      );
    }
  });

  it("rejects development documents and redistributed books or compendium packs", () => {
    expect(() => validatePackageEntries([...requiredPackageEntries, "docs/legal/internal.md"])).toThrow(
      /forbidden development entries/i
    );
    expect(() => validatePackageEntries([...requiredPackageEntries, "packs/rules.db"])).toThrow(
      /forbidden development entries/i
    );
    expect(() => validatePackageEntries([...requiredPackageEntries, "assets/rulebook.pdf"])).toThrow(
      /forbidden development entries/i
    );
    expect(() => validatePackageEntries([...requiredPackageEntries, "assets/unreviewed.webp"])).toThrow(
      /unreviewed asset entries/i
    );
    expect(() => validatePackageEntries([...requiredPackageEntries, "assets/unreviewed.avif"])).toThrow(
      /unreviewed asset entries/i
    );
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
