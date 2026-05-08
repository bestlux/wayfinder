import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichHtml, foundryDeleteValue, preloadHandlebarsTemplates, resolveUuid } from "../src/shared/foundry-compat";

const testGlobals = globalThis as typeof globalThis & {
  foundry?: unknown;
};

describe("Foundry v14 compatibility helpers", () => {
  afterEach(() => {
    delete testGlobals.foundry;
  });

  it("loads templates through the v14 handlebars namespace", async () => {
    const loadTemplates = vi.fn(async (paths: string[]) => paths.map((path) => `loaded:${path}`));
    testGlobals.foundry = {
      applications: {
        handlebars: {
          loadTemplates,
        },
      },
    };

    await expect(preloadHandlebarsTemplates(["templates/wayfinder/pick-pane.hbs"])).resolves.toEqual([
      "loaded:templates/wayfinder/pick-pane.hbs",
    ]);
    expect(loadTemplates).toHaveBeenCalledWith(["templates/wayfinder/pick-pane.hbs"]);
  });

  it("enriches HTML through the configured v14 TextEditor implementation", async () => {
    const enrichHTML = vi.fn(
      async (content: string, options: Record<string, unknown>) => `${content}:${options.async}`
    );
    testGlobals.foundry = {
      applications: {
        ux: {
          TextEditor: {
            implementation: {
              enrichHTML,
            },
          },
        },
      },
    };

    await expect(enrichHtml("<p>@UUID[test]</p>", { async: true })).resolves.toBe("<p>@UUID[test]</p>:true");
    expect(enrichHTML).toHaveBeenCalledWith("<p>@UUID[test]</p>", { async: true });
  });

  it("uses Foundry's v14 forced-deletion operator for update payloads", () => {
    class TestForcedDeletion {}
    testGlobals.foundry = {
      data: {
        operators: {
          ForcedDeletion: TestForcedDeletion,
        },
      },
    };

    expect(foundryDeleteValue()).toBeInstanceOf(TestForcedDeletion);
  });

  it("resolves UUIDs through the v14 foundry.utils namespace", async () => {
    const document = { name: "Resolved Item" };
    const fromUuid = vi.fn(async () => document);
    testGlobals.foundry = {
      utils: {
        fromUuid,
      },
    };

    await expect(resolveUuid("Compendium.pf2e.feats-srd.Item.test")).resolves.toBe(document);
    expect(fromUuid).toHaveBeenCalledWith("Compendium.pf2e.feats-srd.Item.test");
  });
});
