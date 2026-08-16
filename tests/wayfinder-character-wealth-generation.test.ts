import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactCharacterWealthSha256,
  characterWealthDataSha256,
  digest,
  extractCharacterWealthJournal,
  extractPinnedCharacterWealthFixture,
  parseCurrencyToCopper,
  parsePermanentItemAllowances,
  sha256,
} from "../tools/starting-equipment/character-wealth-extractor.mjs";
import {
  assertCharacterWealthRuntimeCurrent,
  assertGeneratedCharacterWealthIntegrity,
  buildCharacterWealthPolicy,
  generateCharacterWealth,
  materializeCharacterWealthNegativeFixture,
  parseGeneratedCharacterWealthModule,
  renderCharacterWealthFixtureJournal,
} from "../tools/starting-equipment/generate-character-wealth.mjs";

const fixturePath = resolve("tools/starting-equipment/fixtures/pf2e-8.4.0-character-wealth-policy.json");
const generatedPath = resolve("src/wayfinder/domain/character-wealth-policy.generated.ts");
const partyNegativePath = resolve("tools/starting-equipment/fixtures/party-treasure-negative.json");
const premasterNegativePath = resolve("tools/starting-equipment/fixtures/premaster-character-wealth-negative.json");
const fixture = readJson(fixturePath);

describe("Character Wealth extraction and generation", () => {
  it("binds generation to the exact pinned source, table, rows, and provenance", () => {
    const extracted = extractPinnedCharacterWealthFixture(fixture);
    expect(fixture.source).toEqual({
      pf2eVersion: "8.4.0",
      pf2eCommit: "90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1",
      upstreamPath: "packs/pf2e/journals/gm-screen.json",
      journalId: "S55aqwWIzpQRFhcq",
      pageId: "Dae8LHdXZuBv06Jk",
      sourceDigest: "sha256:fb2f442ee26e834306cb886eb2d55d399cdc5b717ceab3a6f202e7af592bb463",
      tableDigest: "sha256:53307fd2c31195065f12d3d61d00f5a0b5cf5ccfd4e79a745c17785467a3104e",
    });
    expect(extracted.rows).toHaveLength(20);
    expect(fixture.tableIdentity.attribution).toEqual({
      journalFooter: "Section: Running the Game Pathfinder GM Core pg. 59 and 61",
      book: "Pathfinder GM Core",
      journalPages: [59, 61],
      rulebookPage: 61,
    });
  });

  it.each([
    "pf2eVersion",
    "pf2eCommit",
    "upstreamPath",
    "journalId",
    "pageId",
    "sourceDigest",
    "tableDigest",
  ])("rejects altered pinned source field %s", (field) => {
    const changed = structuredClone(fixture);
    changed.source[field] = `${changed.source[field]}-changed`;
    expect(() => extractPinnedCharacterWealthFixture(changed)).toThrow(/fixture source|digest/u);
  });

  it("rejects a changed wealth value that still claims the pinned source and table", () => {
    const changed = structuredClone(fixture);
    changed.rows[5].permanentRecipeCurrencyCopper += 100;
    expect(() => extractPinnedCharacterWealthFixture(changed)).toThrow(/data digest/u);
  });

  it("rejects the Party Treasure lookalike and a pre-remaster table shape", () => {
    const party = materializeCharacterWealthNegativeFixture(fixture, readJson(partyNegativePath));
    const premaster = materializeCharacterWealthNegativeFixture(fixture, readJson(premasterNegativePath));

    expect(() => extractPinnedCharacterWealthFixture(party)).toThrow(/table identity/u);
    expect(() => extractPinnedCharacterWealthFixture(premaster)).toThrow(/table identity/u);
    expect(() => extractCharacterWealthJournal(renderCharacterWealthFixtureJournal(party))).toThrow(
      /Character Wealth.*heading/u
    );
    expect(() => extractCharacterWealthJournal(renderCharacterWealthFixtureJournal(premaster))).toThrow(
      /class token remaster/u
    );
  });

  it("rejects altered heading, headers, and attribution identity", () => {
    for (const changed of [
      withFixtureChange((value) => (value.tableIdentity.heading = "Character wealth")),
      withFixtureChange((value) => (value.tableIdentity.headers[2] = "Coins")),
      withFixtureChange((value) => (value.tableIdentity.attribution.journalFooter = "Pathfinder GM Core pg. 61")),
    ]) {
      expect(() => extractPinnedCharacterWealthFixture(changed)).toThrow(/table identity/u);
    }
  });

  it.each([
    ["missing row", (content: string) => content.replace(/<tr><td>20<\/td>[\s\S]*?<\/tr>/u, "")],
    ["duplicate level", (content: string) => content.replace("<tr><td>2</td>", "<tr><td>1</td>")],
    [
      "malformed cell count",
      (content: string) =>
        content.replace(
          "<tr><td>2</td><td><strong>1st</strong>: 1</td><td>2000 cp</td><td>3000 cp</td></tr>",
          "<tr><td>2</td><td><strong>1st</strong>: 1</td><td>2000 cp</td></tr>"
        ),
    ],
    [
      "at-level allowance",
      (content: string) =>
        content.replace(
          "<tr><td>2</td><td><strong>1st</strong>: 1</td>",
          "<tr><td>2</td><td><strong>2nd</strong>: 1</td>"
        ),
    ],
  ])("rejects a %s", (_label, mutate) => {
    expect(() => extractCharacterWealthJournal(withRenderedContent(mutate))).toThrow();
  });

  it("parses every currency denomination and rejects residue, duplicates, and overflow", () => {
    expect(parseCurrencyToCopper("4 cp")).toBe(4);
    expect(parseCurrencyToCopper("3 sp")).toBe(30);
    expect(parseCurrencyToCopper("2 gp")).toBe(200);
    expect(parseCurrencyToCopper("1 pp")).toBe(1_000);
    expect(parseCurrencyToCopper("1 pp, 2 gp, 3 sp, 4 cp")).toBe(1_234);
    expect(parseCurrencyToCopper("1,234 gp")).toBe(123_400);
    expect(() => parseCurrencyToCopper("1 gp plus 2 sp")).toThrow(/residue/u);
    expect(() => parseCurrencyToCopper("1 gp, 2 gp")).toThrow(/repeats denomination/u);
    expect(() => parseCurrencyToCopper("9,007,199,254,740,991 pp")).toThrow(/safe integer/u);
  });

  it("parses ordered allowance buckets and rejects malformed, duplicate, or unordered buckets", () => {
    expect(parsePermanentItemAllowances("-")).toEqual([]);
    expect(parsePermanentItemAllowances("4th: 1, 3rd: 2, 2nd: 1, 1st: 2")).toEqual([
      { itemLevel: 4, count: 1 },
      { itemLevel: 3, count: 2 },
      { itemLevel: 2, count: 1 },
      { itemLevel: 1, count: 2 },
    ]);
    expect(() => parsePermanentItemAllowances("1th: 1")).toThrow(/ordinal suffix/u);
    expect(() => parsePermanentItemAllowances("2nd: 1, 2nd: 2")).toThrow(/repeats level/u);
    expect(() => parsePermanentItemAllowances("1st: 1, 2nd: 1")).toThrow(/highest to lowest/u);
    expect(() => parsePermanentItemAllowances("1st: 0")).toThrow(/positive/u);
    expect(() => parsePermanentItemAllowances("21st: 1")).toThrow(/levels must be 1-20/u);
    expect(() => parsePermanentItemAllowances("1st: 1 leftovers")).toThrow(/unparsed residue/u);
  });

  it("regenerates byte-for-byte and validates both semantic and artifact digests", async () => {
    const first = await generateCharacterWealth();
    const second = await generateCharacterWealth();
    const checkedInSource = readFileSync(generatedPath, "utf8");

    expect(first).toEqual(second);
    expect(first.source).toBe(checkedInSource);
    expect(first.source).not.toMatch(/capturedAt|generatedAt|new Date/u);
    expect(parseGeneratedCharacterWealthModule(checkedInSource)).toEqual(first.policy);

    const dataTamper = structuredClone(first.policy);
    dataTamper.rows[5].permanentRecipeCurrencyCopper += 1;
    expect(() => assertGeneratedCharacterWealthIntegrity(dataTamper)).toThrow(/data digest/u);

    const artifactTamper = { ...first.policy, artifactDigest: digest(sha256("wrong artifact")) };
    expect(() => assertGeneratedCharacterWealthIntegrity(artifactTamper)).toThrow(/artifact digest/u);

    const selfConsistentDataTamper = structuredClone(first.policy);
    selfConsistentDataTamper.rows[0].lumpSumCopper += 100;
    selfConsistentDataTamper.dataDigest = digest(characterWealthDataSha256(selfConsistentDataTamper.rows));
    selfConsistentDataTamper.artifactDigest = recomputeArtifactDigest(selfConsistentDataTamper);
    expect(() => assertGeneratedCharacterWealthIntegrity(selfConsistentDataTamper)).toThrow(/reviewed policy rows/u);

    const selfConsistentFixtureTamper = structuredClone(first.policy);
    selfConsistentFixtureTamper.source.fixtureDigest = digest(sha256("different fixture"));
    selfConsistentFixtureTamper.artifactDigest = recomputeArtifactDigest(selfConsistentFixtureTamper);
    expect(() => assertGeneratedCharacterWealthIntegrity(selfConsistentFixtureTamper)).toThrow(
      /reviewed generator input/u
    );
  });

  it("fails before build when the checked-in Character Wealth runtime is stale", async () => {
    await expect(assertCharacterWealthRuntimeCurrent()).resolves.toBeUndefined();
    await expect(
      assertCharacterWealthRuntimeCurrent({
        readRuntimeFile: async (outputPath: string) =>
          outputPath.endsWith("character-wealth-policy.js") ? "// stale runtime\n" : readFileSync(outputPath, "utf8"),
      })
    ).rejects.toThrow(/Compiled Character Wealth runtime is stale/u);
  });

  it("emits the complete source, table, fixture, data, and artifact digest chain", () => {
    const policy = buildCharacterWealthPolicy(fixture);
    expect(policy.source.fixtureDigest).toBe(digest(sha256(JSON.stringify(sortKeysDeep(fixture)))));
    expect(policy.source.sourceDigest).toBe(fixture.source.sourceDigest);
    expect(policy.source.tableDigest).toBe(fixture.source.tableDigest);
    expect(policy.dataDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(policy.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function withRenderedContent(mutate: (content: string) => string) {
  const journal = renderCharacterWealthFixtureJournal(fixture);
  journal.pages[0].text.content = mutate(journal.pages[0].text.content);
  return journal;
}

function withFixtureChange(change: (value: any) => void) {
  const changed = structuredClone(fixture);
  change(changed);
  return changed;
}

function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])])
    );
  }
  return value;
}

function recomputeArtifactDigest(policy: Record<string, any>) {
  const { artifactDigest: _artifactDigest, ...payload } = policy;
  return digest(artifactCharacterWealthSha256(payload));
}
