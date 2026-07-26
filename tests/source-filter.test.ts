import { describe, expect, it } from "vitest";
import { expandCompendiumAllowlist, mergePackIds, parseCompendiumAllowlist } from "../src/source-filter";

describe("source-filter", () => {
  it("parses a comma-delimited allowlist", () => {
    expect(parseCompendiumAllowlist(" pf2e.foo , my.bar,, world.baz ")).toEqual(["pf2e.foo", "my.bar", "world.baz"]);
  });

  it("deduplicates merged pack ids", () => {
    expect(mergePackIds(["pf2e.feats-srd"], ["pf2e.feats-srd", "world.homebrew"])).toEqual([
      "pf2e.feats-srd",
      "world.homebrew",
    ]);
  });

  it("expands module-prefix and global wildcards against installed packs", () => {
    const installed = [
      "pf2e.feats-srd",
      "battlezoo-dragons.dragon-equipment",
      "battlezoo-dragons.dragon-feats",
      "other-module.options",
    ];

    expect(expandCompendiumAllowlist(["battlezoo-dragons.*"], installed)).toEqual([
      "battlezoo-dragons.dragon-equipment",
      "battlezoo-dragons.dragon-feats",
    ]);
    expect(expandCompendiumAllowlist(["*"], installed)).toEqual(installed);
  });

  it("keeps exact ids, deduplicates overlaps, and rejects unsupported wildcard shapes", () => {
    const installed = ["battlezoo-dragons.dragon-feats", "battlezoo-dragons.dragon-heritages"];

    expect(
      expandCompendiumAllowlist(
        ["world.homebrew", "battlezoo-dragons.*", "battlezoo-dragons.dragon-feats", "battlezoo*", "*.feats"],
        installed
      )
    ).toEqual(["world.homebrew", "battlezoo-dragons.dragon-feats", "battlezoo-dragons.dragon-heritages"]);
  });
});
