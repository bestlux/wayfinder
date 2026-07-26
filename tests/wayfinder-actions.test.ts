import { describe, expect, it } from "vitest";
import { parseWayfinderAction } from "../src/wayfinder/actions";

describe("Wayfinder actions", () => {
  it("parses the existing-character history import action", () => {
    const element = {
      dataset: {
        wayfinderAction: "import-existing-history",
      },
    } as unknown as HTMLElement;

    expect(parseWayfinderAction(element)).toEqual({ type: "import-existing-history" });
  });
});
