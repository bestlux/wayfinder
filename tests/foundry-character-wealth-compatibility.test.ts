import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compareCharacterWealthCompatibility } from "../tools/foundry-smoke/character-wealth-compatibility.mjs";
import {
  inspectCharacterWealthRuntimeArtifact,
  reserveCharacterWealthCompatibilityDirectory,
  writeCharacterWealthCompatibilityArtifacts,
} from "../tools/foundry-smoke/run-character-wealth-compatibility.mjs";
import { sha256 } from "../tools/starting-equipment/character-wealth-extractor.mjs";
import {
  parseGeneratedCharacterWealthModule,
  renderCharacterWealthFixtureJournal,
} from "../tools/starting-equipment/generate-character-wealth.mjs";

const fixture = JSON.parse(
  readFileSync(resolve("tools/starting-equipment/fixtures/pf2e-8.4.0-character-wealth-policy.json"), "utf8")
);
const policy = parseGeneratedCharacterWealthModule(
  readFileSync(resolve("src/wayfinder/domain/character-wealth-policy.generated.ts"), "utf8")
);
const builtPolicy = parseGeneratedCharacterWealthModule(
  readFileSync(resolve("scripts/wayfinder/domain/character-wealth-policy.generated.js"), "utf8")
);
const builtPolicySource = readFileSync(
  resolve("scripts/wayfinder/domain/character-wealth-policy.generated.js"),
  "utf8"
);

describe("installed Character Wealth compatibility", () => {
  it("reports an exact semantic match without requiring source-byte equality", () => {
    const journal = withContent((content) => content.replace("<table class", '<table data-probe="true" class'));
    const result = compareCharacterWealthCompatibility(journal, policy);

    expect(result).toMatchObject({
      status: "match",
      differenceKind: null,
      expectedDataDigest: policy.dataDigest,
      installedDataDigest: policy.dataDigest,
      diagnostics: [],
    });
    expect(result.installedSourceDigest).not.toBe(policy.source.sourceDigest);
  });

  it("binds compatibility to the generated runtime artifact", () => {
    expect(builtPolicy).toEqual(policy);
  });

  it("binds live evidence to exact served bytes and the executed runtime export", () => {
    expect(
      inspectCharacterWealthRuntimeArtifact({
        builtSource: builtPolicySource,
        servedSource: builtPolicySource,
        runtimePolicy: builtPolicy,
      }).evidence
    ).toMatchObject({ matched: true, runtimeExportMatched: true, sourceMatched: true });

    expect(
      inspectCharacterWealthRuntimeArtifact({
        builtSource: builtPolicySource,
        servedSource: `${builtPolicySource}\n// unexpected served mutation surface\n`,
        runtimePolicy: builtPolicy,
      }).evidence
    ).toMatchObject({ matched: false, runtimeExportMatched: true, sourceMatched: false });

    const mutatedRuntimePolicy = structuredClone(builtPolicy);
    mutatedRuntimePolicy.rows[0].lumpSumCopper = 1;
    expect(() =>
      inspectCharacterWealthRuntimeArtifact({
        builtSource: builtPolicySource,
        servedSource: `${builtPolicySource}\nGENERATED_CHARACTER_WEALTH_POLICY.rows[0].lumpSumCopper = 1;\n`,
        runtimePolicy: mutatedRuntimePolicy,
      })
    ).toThrow(/reviewed policy rows/u);
  });

  it.each([
    [1, "1500 cp</td><td>1500 cp", "1600 cp</td><td>1500 cp"],
    [5, "5000 cp</td><td>27000 cp", "5100 cp</td><td>27000 cp"],
    [6, "8000 cp</td><td>45000 cp", "8100 cp</td><td>45000 cp"],
    [20, "2000000 cp</td><td>11200000 cp", "2000100 cp</td><td>11200000 cp"],
  ])("classifies a structurally valid level %i value change as semantic drift", (level, before, after) => {
    const journal = withContent((content) => content.replace(before, after));
    expect(compareCharacterWealthCompatibility(journal, policy)).toMatchObject({
      status: "diff",
      differenceKind: "semantic",
      diagnostics: [`Installed Character Wealth level ${level} differs from the generated policy.`],
    });
  });

  it.each([
    [
      "visible content before the table",
      (content: string) => content.replace("</h2><table", "</h2><p>Double all amounts.</p><table"),
    ],
    [
      "entity-escaped visible content before the table",
      (content: string) => content.replace("</h2><table", "</h2>&lt;double-all&gt;<table"),
    ],
    ["entity-escaped header residue", (content: string) => content.replace("Level</th>", "Level&lt;legacy&gt;</th>")],
    [
      "entity-escaped currency residue",
      (content: string) => content.replace("1500 cp</td><td>1500 cp", "1500 cp&lt;double&gt;</td><td>1500 cp"),
    ],
    [
      "raw visible angle-bracket residue",
      (content: string) => content.replace("1500 cp</td><td>1500 cp", "1500 cp < double ></td><td>1500 cp"),
    ],
    [
      "a table caption",
      (content: string) => content.replace("<thead>", "<caption>Use half these values.</caption><thead>"),
    ],
    [
      "a table footer",
      (content: string) => content.replace("</tbody>", "</tbody><tfoot><tr><td>Special rule</td></tr></tfoot>"),
    ],
    ["a row span", (content: string) => content.replace("<td>2</td>", '<td rowspan="2">2</td>')],
    ["a column span", (content: string) => content.replace("<th>Currency</th>", '<th colspan="2">Currency</th>')],
    ["a malformed cell tag name", (content: string) => content.replace("<td>2</td>", "<td.foo>2</td>")],
    ["a slash-separated row span", (content: string) => content.replace("<td>2</td>", '<td/rowspan="2">2</td>')],
    ["a Unicode-space cell tag name", (content: string) => content.replace("<td>2</td>", "<td\u00a0data-x>2</td>")],
    [
      "a Unicode-space class attribute delimiter",
      (content: string) => content.replace('class="pf2e remaster"', 'class\u00a0="pf2e remaster"'),
    ],
    ["a Unicode-space closing tag", (content: string) => content.replace("<td>2</td>", "<td>2</td\u00a0>")],
    [
      "a malformed heading tag name",
      (content: string) => content.replace("<h2>Character Wealth</h2>", "<h2.foo>Character Wealth</h2>"),
    ],
    ["a malformed table tag name", (content: string) => content.replace("<table class=", "<table.foo class=")],
  ])("classifies %s as structural drift", (_label, mutate) => {
    expect(compareCharacterWealthCompatibility(withContent(mutate), policy)).toMatchObject({
      status: "diff",
      differenceKind: "structural",
      installedDataDigest: null,
    });
  });

  it("classifies an invalid table shape as structural drift", () => {
    const journal = withContent((content) => content.replace('class="pf2e remaster"', 'class="pf2e"'));
    expect(compareCharacterWealthCompatibility(journal, policy)).toMatchObject({
      status: "diff",
      differenceKind: "structural",
      installedDataDigest: null,
      diagnostics: [expect.stringContaining("class token remaster")],
    });
  });

  it("reports an unavailable installed journal explicitly", () => {
    expect(compareCharacterWealthCompatibility(null, policy)).toMatchObject({
      status: "unavailable",
      differenceKind: null,
      installedSourceDigest: null,
      installedTableDigest: null,
      installedDataDigest: null,
    });
  });

  it("refuses to reuse an evidence directory that could contain an older PASS", async () => {
    const parent = await mkdtemp(join(tmpdir(), "wayfinder-character-wealth-"));
    const outDir = join(parent, "evidence");
    try {
      expect(await reserveCharacterWealthCompatibilityDirectory(outDir)).toBe(outDir);
      await expect(reserveCharacterWealthCompatibilityDirectory(outDir)).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("publishes hash-bound evidence with the completion marker last", async () => {
    const parent = await mkdtemp(join(tmpdir(), "wayfinder-character-wealth-publication-"));
    const outDir = join(parent, "evidence");
    const result = {
      schemaVersion: 1,
      storyId: "WF-080-10",
      evidenceId: "character-wealth-test-evidence",
      capturedAt: "2026-08-16T00:00:00.000Z",
      runtime: { foundryVersion: "14.366", pf2eVersion: "8.4.0", locale: "en" },
      policyArtifact: { matched: true, sourceMatched: true, runtimeExportMatched: true },
      comparison: {
        status: "match",
        differenceKind: null,
        expectedDataDigest: policy.dataDigest,
        installedDataDigest: policy.dataDigest,
        diagnostics: [],
      },
      execution: { completed: true, failureStage: null },
      qualification: { passed: true },
    };
    try {
      await reserveCharacterWealthCompatibilityDirectory(outDir);
      const completion = await writeCharacterWealthCompatibilityArtifacts(outDir, result);
      const resultBytes = await readFile(join(outDir, "character-wealth-compatibility.json"), "utf8");
      const summaryBytes = await readFile(join(outDir, "character-wealth-compatibility.md"), "utf8");
      const completionBytes = await readFile(join(outDir, "character-wealth-compatibility-completion.json"), "utf8");

      expect(JSON.parse(completionBytes)).toEqual(completion);
      expect(completion).toMatchObject({
        evidenceId: result.evidenceId,
        qualified: true,
        resultSha256: sha256(resultBytes),
        summarySha256: sha256(summaryBytes),
      });
      await expect(writeCharacterWealthCompatibilityArtifacts(outDir, result)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

function withContent(mutate: (content: string) => string) {
  const journal = renderCharacterWealthFixtureJournal(fixture);
  journal.pages[0].text.content = mutate(journal.pages[0].text.content);
  return journal;
}
