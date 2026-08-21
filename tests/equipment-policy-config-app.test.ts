import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";

const globals = globalThis as typeof globalThis & { foundry: any; game: any; ui: any; FormData: any };

describe("equipment policy config app", () => {
  beforeEach(() => {
    vi.resetModules();
    class TestApplicationV2 {
      constructor(_options: unknown = {}) {}
      render(_force?: boolean): this {
        return this;
      }
      async close(): Promise<this> {
        return this;
      }
      async _prepareContext(): Promise<Record<string, unknown>> {
        return {};
      }
    }
    globals.foundry.applications.api = {
      ApplicationV2: TestApplicationV2,
      HandlebarsApplicationMixin: (Base: unknown) => Base,
    };
    globals.game = {
      i18n: { localize: (key: string) => key },
      user: { id: "gm-1", name: "GM", isGM: true },
      users: { get: vi.fn((id: string) => (id === "gm-1" ? { id: "gm-1", name: "GM", isGM: true } : null)) },
      packs: new Map(),
      settings: { get: vi.fn(), set: vi.fn(async () => undefined) },
    };
    globals.ui = { notifications: { error: vi.fn(), info: vi.fn() } };
    globals.FormData = class {
      getAll(key: string) {
        if (key === "enabledRecipes") return ["permanent-items", "lump-sum"];
        if (key === "allowedEquipmentPackFamilies") return ["pf2e"];
        return [];
      }
      get(key: string) {
        return (
          {
            defaultRecipe: "permanent-items",
            recipeChoiceAuthority: "actor-owner",
            higherLevelStartAuthority: "gm-confirmation",
            blanketRarity: "common",
            applyAuthority: "actor-owner",
          }[key] ?? null
        );
      }
    };
  });

  it("saves one normalized atomic policy as a current GM", async () => {
    const { EquipmentPolicyConfigApp } = await import("../src/equipment-policy-config-app");
    const app = new EquipmentPolicyConfigApp();
    const handler = (EquipmentPolicyConfigApp.DEFAULT_OPTIONS.form as any).handler;
    await handler.call(app, {}, {});
    expect(globals.game.settings.set).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.equipmentPolicy,
      expect.objectContaining({
        version: 1,
        enabledRecipes: ["lump-sum", "permanent-items"],
        recipeDecision: expect.objectContaining({ configuredBy: { userId: "gm-1", userName: "GM" } }),
      })
    );
    expect(globals.ui.notifications.info).toHaveBeenCalled();
  });

  it("rejects direct non-GM submission and opening", async () => {
    globals.game.user = { id: "owner-1", isGM: false };
    const { EquipmentPolicyConfigApp } = await import("../src/equipment-policy-config-app");
    const app = new EquipmentPolicyConfigApp();
    const handler = (EquipmentPolicyConfigApp.DEFAULT_OPTIONS.form as any).handler;
    await handler.call(app, {}, {});
    EquipmentPolicyConfigApp.open();
    expect(globals.game.settings.set).not.toHaveBeenCalled();
    expect(globals.ui.notifications.error).toHaveBeenCalledTimes(2);
  });

  it("counts only installed packs classified for PF2E's equipment tab", async () => {
    globals.game.settings.get.mockReturnValue({
      version: 1,
      enabledRecipes: ["permanent-items"],
      defaultRecipe: "permanent-items",
      allowedEquipmentPackFamilies: ["pf2e", "battlezoo"],
    });
    globals.game.packs = new Map([
      ["pf2e.equipment-srd", pack("pf2e.equipment-srd", "PF2E")],
      ["battlezoo.items", pack("battlezoo.items", "Battlezoo")],
      ["battlezoo.feats", pack("battlezoo.feats", "Battlezoo")],
    ]);
    const { EquipmentPolicyConfigApp } = await import("../src/equipment-policy-config-app");
    const context = await (new EquipmentPolicyConfigApp() as any)._prepareContext();
    expect(context.families).toEqual([
      { id: "battlezoo", label: "Battlezoo", packCount: 1, selected: true },
      { id: "pf2e", label: "PF2E", packCount: 1, selected: true },
    ]);
  });
});

function pack(id: string, packageName: string) {
  return {
    collection: id,
    documentName: "Item",
    metadata: { id, type: "Item", label: id, packageName },
    index: [{ _id: `${id}-entry`, type: id.endsWith(".feats") ? "feat" : "equipment" }],
  };
}
