import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";

const testGlobals = globalThis as typeof globalThis & { foundry: any; game: any; ui: any };

describe("compendium source config app", () => {
  beforeEach(() => {
    vi.resetModules();
    class TestApplicationV2 {
      element: unknown = null;
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
      async _onRender(_context: unknown, _options: unknown): Promise<void> {}
    }
    testGlobals.foundry.applications.api = {
      ApplicationV2: TestApplicationV2,
      HandlebarsApplicationMixin: (Base: unknown) => Base,
    };
    testGlobals.game = {
      i18n: { localize: (key: string) => key },
      modules: new Map([["addon", { title: "Addon" }]]),
      packs: new Map([
        [
          "addon.characters",
          {
            documentName: "Item",
            title: "Characters",
            metadata: { packageName: "addon", type: "Item" },
            getIndex: vi.fn(async () => []),
          },
        ],
      ]),
      settings: {
        get: vi.fn(() => "addon.*"),
        set: vi.fn(async () => undefined),
      },
      system: { id: "pf2e", title: "PF2E" },
      user: { isGM: true },
    };
    testGlobals.ui = {
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    };
  });

  it("saves the reviewed wildcard expansion as exact pack ids", async () => {
    const { CompendiumSourceConfigApp } = await import("../src/compendium-source-config-app");
    const app = new CompendiumSourceConfigApp();
    const handler = (CompendiumSourceConfigApp.DEFAULT_OPTIONS.form as any).handler;

    await handler.call(app, {}, {});

    expect(testGlobals.game.settings.set).toHaveBeenCalledWith(MODULE_ID, SETTINGS.extraPacks, "addon.characters");
    expect(testGlobals.ui.notifications.info).toHaveBeenCalled();
  });

  it("rejects a submit if a non-GM reaches the application directly", async () => {
    testGlobals.game.user.isGM = false;
    const { CompendiumSourceConfigApp } = await import("../src/compendium-source-config-app");
    const app = new CompendiumSourceConfigApp();
    const handler = (CompendiumSourceConfigApp.DEFAULT_OPTIONS.form as any).handler;

    await handler.call(app, {}, {});

    expect(testGlobals.game.settings.set).not.toHaveBeenCalled();
    expect(testGlobals.ui.notifications.error).toHaveBeenCalled();
  });

  it("blocks non-GMs before opening the menu", async () => {
    testGlobals.game.user.isGM = false;
    const { CompendiumSourceConfigApp } = await import("../src/compendium-source-config-app");

    CompendiumSourceConfigApp.open();

    expect(testGlobals.ui.notifications.warn).toHaveBeenCalled();
    expect(testGlobals.game.settings.get).not.toHaveBeenCalled();
  });

  it("preserves an exact saved source while its compendium is unavailable", async () => {
    testGlobals.game.settings.get.mockReturnValue("inactive.characters");
    const { CompendiumSourceConfigApp } = await import("../src/compendium-source-config-app");
    const app = new CompendiumSourceConfigApp();
    const handler = (CompendiumSourceConfigApp.DEFAULT_OPTIONS.form as any).handler;

    await handler.call(app, {}, {});

    expect(testGlobals.game.settings.set).toHaveBeenCalledWith(MODULE_ID, SETTINGS.extraPacks, "inactive.characters");
  });

  it("preserves an unmatched legacy pattern until the GM explicitly clears it", async () => {
    testGlobals.game.settings.get.mockReturnValue("inactive-module.*");
    const { CompendiumSourceConfigApp } = await import("../src/compendium-source-config-app");
    const app = new CompendiumSourceConfigApp();
    const handler = (CompendiumSourceConfigApp.DEFAULT_OPTIONS.form as any).handler;

    await handler.call(app, {}, {});

    expect(testGlobals.game.settings.set).toHaveBeenCalledWith(MODULE_ID, SETTINGS.extraPacks, "inactive-module.*");
  });
});
