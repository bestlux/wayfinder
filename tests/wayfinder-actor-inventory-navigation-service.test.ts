import { describe, expect, it, vi } from "vitest";
import { openActorInventorySheet } from "../src/wayfinder/application/actor-inventory-navigation-service";

describe("actor inventory navigation", () => {
  it("opens the PF2E actor sheet on its inventory tab", async () => {
    const render = vi.fn(async () => undefined);

    await openActorInventorySheet({ sheet: { render } });

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(true, { tab: "inventory" });
  });

  it("fails clearly when the actor has no renderable sheet", async () => {
    await expect(openActorInventorySheet({ sheet: null })).rejects.toThrow(/inventory sheet is unavailable/i);
  });
});
