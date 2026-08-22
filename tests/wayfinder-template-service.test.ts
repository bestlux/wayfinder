import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testGlobals = globalThis as typeof globalThis & {
  foundry: {
    applications: {
      handlebars: {
        loadTemplates: ReturnType<typeof vi.fn>;
      };
    };
  };
};

describe("Wayfinder template readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    testGlobals.foundry.applications.handlebars.loadTemplates = vi.fn(async () => []);
  });

  it("coalesces cold template loads behind one render dependency", async () => {
    let releaseLoad: (() => void) | undefined;
    testGlobals.foundry.applications.handlebars.loadTemplates.mockImplementation(
      () =>
        new Promise<unknown[]>((resolveLoad) => {
          releaseLoad = () => resolveLoad([]);
        })
    );
    const { ensureWayfinderTemplatesLoaded, WAYFINDER_TEMPLATE_PATHS } = await import(
      "../src/wayfinder/application/wayfinder-template-service"
    );

    const first = ensureWayfinderTemplatesLoaded();
    const second = ensureWayfinderTemplatesLoaded();

    expect(second).toBe(first);
    expect(testGlobals.foundry.applications.handlebars.loadTemplates).toHaveBeenCalledOnce();
    expect(testGlobals.foundry.applications.handlebars.loadTemplates).toHaveBeenCalledWith([
      ...WAYFINDER_TEMPLATE_PATHS,
    ]);
    releaseLoad?.();
    await expect(first).resolves.toBeUndefined();
  });

  it("clears a failed preload so the next render can retry", async () => {
    testGlobals.foundry.applications.handlebars.loadTemplates
      .mockRejectedValueOnce(new Error("template request failed"))
      .mockResolvedValueOnce([]);
    const { ensureWayfinderTemplatesLoaded } = await import("../src/wayfinder/application/wayfinder-template-service");

    await expect(ensureWayfinderTemplatesLoaded()).rejects.toThrow("template request failed");
    await expect(ensureWayfinderTemplatesLoaded()).resolves.toBeUndefined();
    expect(testGlobals.foundry.applications.handlebars.loadTemplates).toHaveBeenCalledTimes(2);
  });

  it("awaits template readiness before preparing any full or partial render", () => {
    const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
    const prepareStart = appShell.indexOf("async _prepareContext");
    const prepareEnd = appShell.indexOf("_replaceHTML", prepareStart);
    const prepareContext = appShell.slice(prepareStart, prepareEnd);

    expect(prepareContext.indexOf("await ensureWayfinderTemplatesLoaded();")).toBeGreaterThanOrEqual(0);
    expect(prepareContext.indexOf("await ensureWayfinderTemplatesLoaded();")).toBeLessThan(
      prepareContext.indexOf("const pickerRequest")
    );
  });
});
