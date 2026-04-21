import { describe, expect, it } from "vitest";
import { getClassContributor } from "../src/wayfinder/classes/registry";

describe("wayfinder class registry", () => {
  it("returns known contributors and falls back to base for unknown class slugs", () => {
    expect(getClassContributor("wizard").slug).toBe("wizard");
    expect(getClassContributor("cleric").slug).toBe("cleric");
    expect(getClassContributor("inventor").slug).toBe("base");
    expect(getClassContributor(null).slug).toBe("base");
  });
});
