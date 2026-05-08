import { describe, expect, it } from "vitest";
import { parseCompendiumItemUuid } from "../src/shared/compendium";

describe("shared compendium helpers", () => {
  it("parses PF2E item UUIDs into pack and document ids", () => {
    expect(parseCompendiumItemUuid("Compendium.pf2e.feats-srd.Item.Titan Swing")).toEqual({
      packId: "pf2e.feats-srd",
      documentId: "Titan Swing",
    });
  });

  it("trims surrounding whitespace but rejects non-item UUIDs", () => {
    expect(parseCompendiumItemUuid(" Compendium.pf2e.classfeatures.Item.Cascade Bearers ")).toEqual({
      packId: "pf2e.classfeatures",
      documentId: "Cascade Bearers",
    });
    expect(parseCompendiumItemUuid("Compendium.pf2e.feats-srd.Actor.NotAnItem")).toBeNull();
  });
});
