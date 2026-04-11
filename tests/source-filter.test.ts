import { describe, expect, it } from "vitest";
import { mergePackIds, parseCompendiumAllowlist } from "../src/source-filter";

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
});
