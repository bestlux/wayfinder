import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPackIndex, invalidatePackSourceCaches } from "../src/pack/access";
import { registerPackSourceCacheInvalidation } from "../src/pack/cache-invalidation";

const testGlobals = globalThis as typeof globalThis & { Hooks: any };

describe("pack source cache invalidation hooks", () => {
  beforeEach(() => {
    invalidatePackSourceCaches();
  });

  it("invalidates cached indexes and refreshes open apps for compendium item changes", async () => {
    const callbacks = new Map<string, (document: { pack?: string | null }) => void>();
    testGlobals.Hooks = {
      on: vi.fn((hook: string, callback: (document: { pack?: string | null }) => void) =>
        callbacks.set(hook, callback)
      ),
    };
    const entries = [{ _id: "first" }];
    const pack = { getIndex: vi.fn(async () => entries) } as any;
    const rerender = vi.fn();
    registerPackSourceCacheInvalidation(rerender);

    expect(await getPackIndex(pack, "third-party.feats")).toEqual([{ _id: "first" }]);
    entries.splice(0, entries.length, { _id: "second" });
    expect(await getPackIndex(pack, "third-party.feats")).toEqual([{ _id: "first" }]);

    callbacks.get("updateItem")?.({ pack: "third-party.feats" });

    expect(await getPackIndex(pack, "third-party.feats")).toEqual([{ _id: "second" }]);
    expect(rerender).toHaveBeenCalledOnce();
    expect(testGlobals.Hooks.on).toHaveBeenCalledTimes(3);
  });

  it("ignores world item changes", () => {
    const callbacks = new Map<string, (document: { pack?: string | null }) => void>();
    testGlobals.Hooks = {
      on: (hook: string, callback: (document: { pack?: string | null }) => void) => callbacks.set(hook, callback),
    };
    const rerender = vi.fn();
    registerPackSourceCacheInvalidation(rerender);

    callbacks.get("createItem")?.({ pack: null });

    expect(rerender).not.toHaveBeenCalled();
  });
});
