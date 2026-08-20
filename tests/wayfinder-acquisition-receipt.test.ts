import { describe, expect, it, vi } from "vitest";
import { reviewRetainAll } from "../src/wayfinder/domain/acquisition-ledger";
import { buildAcquisitionReceiptViewModel } from "../src/wayfinder/panes/acquisition-receipt";
import { acquisitionFixture, completedAcquisitionFixture } from "./fixtures/acquisition-fixture";

describe("completed acquisition receipt", () => {
  it("derives durable item, currency, authority, and runtime details from the manifest", async () => {
    const completed = await completedAcquisitionFixture();
    const resolveItemName = vi.fn(() => "Dagger");
    const receipt = await buildAcquisitionReceiptViewModel(completed.manifest, { resolveItemName });

    expect(receipt).toMatchObject({
      manifestId: "manifest-1",
      batchId: "batch-1",
      disposition: "purchase-ledger",
      dispositionLabel: "Bought starting gear",
      appliedBy: "Owner",
      currency: {
        preCopper: 0,
        budgetCopper: 1_000,
        spentCopper: 100,
        remainingCopper: 900,
        observedCopper: 900,
        spentLabel: "1 gp",
        remainingLabel: "9 gp",
        observedLabel: "9 gp",
      },
      authority: {
        applyLabel: "Applied by you",
        recipeChoiceLabel: "Funding chosen by you",
        higherLevelStartLabel: "Higher-level start noted by you",
        judgmentIds: [],
      },
      environmentLabel: "Foundry 14.366 · PF2E 8.4.0 · Wayfinder 0.8.0",
      canOpenInventory: true,
    });
    expect(receipt.itemRows).toEqual([
      expect.objectContaining({
        name: "Dagger",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
        quantity: 1,
        containerId: null,
        fundingLabel: "Currency",
      }),
    ]);
    expect(resolveItemName).toHaveBeenCalledWith("Compendium.pf2e.equipment-srd.Item.item", "actor-item-1");
  });

  it("shows an explicit retain-all outcome with no purchased item rows", async () => {
    const fixture = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const draft = reviewRetainAll(fixture.draft, fixture.ledger, {
      userId: "owner-1",
      reviewedAt: "2026-08-18T21:00:00.000Z",
    });
    const completed = await completedAcquisitionFixture({
      fixture: { ...fixture, draft },
      draft,
    });
    const receipt = await buildAcquisitionReceiptViewModel(completed.manifest);

    expect(receipt.dispositionLabel).toBe("Kept all your starting coin");
    expect(receipt.itemRows).toEqual([]);
    expect(receipt.currency).toMatchObject({ spentCopper: 0, remainingCopper: 1_000, observedCopper: 1_000 });
  });

  it("fails closed for malformed durable evidence", async () => {
    await expect(buildAcquisitionReceiptViewModel({ schemaVersion: 1 })).rejects.toThrow(/valid completed/i);
  });
});
