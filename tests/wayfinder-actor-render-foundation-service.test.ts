import { describe, expect, it, vi } from "vitest";
import { inspectActor } from "../src/actor-inspector";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { DraftState } from "../src/types";
import {
  ActorRenderFoundationCache,
  buildActorRenderFoundationKey,
  buildActorRenderFoundationLanguageSettings,
  getActorRenderFoundationSourceGeneration,
  handleActorRenderFoundationSourceChange,
  noteActorRenderFoundationSourceChange,
  registerActorRenderFoundationSourceInvalidation,
} from "../src/wayfinder/application/actor-render-foundation-service";
import { acquisitionFixture } from "./fixtures/acquisition-fixture";

describe("actor render foundation cache", () => {
  it("reuses one actor-bound foundation across close, reopen, and equipment-only draft changes", async () => {
    const actor = actorFixture();
    const initial = equipmentDraft();
    const quantity = withQuantity(initial, 2);
    const awaitingRecipe = createEmptyDraft(5);
    awaitingRecipe.acquisition = null;
    const cache = new ActorRenderFoundationCache<string>();
    const counters = { plan: 0, effectiveBuildState: 0, nonEquipmentEvaluations: 0 };
    const build = vi.fn(async () => {
      counters.plan += 1;
      counters.effectiveBuildState += 1;
      counters.nonEquipmentEvaluations += 1;
      return "foundation";
    });

    await expect(cache.resolve(actor, key(actor, initial), build)).resolves.toBe("foundation");
    await expect(cache.resolve(actor, key(actor, initial), build)).resolves.toBe("foundation");
    await expect(cache.resolve(actor, key(actor, quantity), build)).resolves.toBe("foundation");
    await expect(cache.resolve(actor, key(actor, awaitingRecipe), build)).resolves.toBe("foundation");

    expect(build).toHaveBeenCalledOnce();
    expect(counters).toEqual({ plan: 1, effectiveBuildState: 1, nonEquipmentEvaluations: 1 });
  });

  it("coalesces same-key in-flight work", async () => {
    const cache = new ActorRenderFoundationCache<string>();
    const actor = {};
    const pending = deferred<string>();
    const build = vi.fn(() => pending.promise);

    const first = cache.resolve(actor, "same", build);
    const second = cache.resolve(actor, "same", build);
    await Promise.resolve();
    expect(build).toHaveBeenCalledOnce();
    pending.resolve("shared");

    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);
  });

  it("does not let stale in-flight work replace a newer actor foundation", async () => {
    const cache = new ActorRenderFoundationCache<string>();
    const actor = {};
    const stale = deferred<string>();
    const current = deferred<string>();
    const staleResult = cache.resolve(actor, "stale", () => stale.promise);
    const currentResult = cache.resolve(actor, "current", () => current.promise);

    current.resolve("current-value");
    await expect(currentResult).resolves.toBe("current-value");
    stale.resolve("stale-value");
    await expect(staleResult).resolves.toBe("stale-value");

    const rebuildCurrent = vi.fn(async () => "wrong");
    await expect(cache.resolve(actor, "current", rebuildCurrent)).resolves.toBe("current-value");
    expect(rebuildCurrent).not.toHaveBeenCalled();
  });

  it("does not cache failed foundation work", async () => {
    const cache = new ActorRenderFoundationCache<string>();
    const actor = {};
    await expect(cache.resolve(actor, "key", async () => Promise.reject(new Error("failed")))).rejects.toThrow(
      "failed"
    );
    await expect(cache.resolve(actor, "key", async () => "recovered")).resolves.toBe("recovered");
  });

  it("misses exact actor, draft, target, settings, source, and schema drift", () => {
    const actor = actorFixture();
    const draft = equipmentDraft();
    const base = key(actor, draft);

    const selected = structuredClone(draft);
    selected.manual["manual-level-2"] = true;
    expect(key(actor, selected)).not.toBe(base);

    const target = structuredClone(draft);
    target.targetLevel = 6;
    expect(key(actor, target)).not.toBe(base);

    actor._source.system.details.level.value = 2;
    expect(key(actor, draft)).not.toBe(base);
    actor._source.system.details.level.value = 1;

    expect(key(actor, draft, { spellRarityCeiling: "rare" })).not.toBe(base);
    expect(key(actor, draft, { unavailableCampaignLanguages: ["draconic"] })).not.toBe(base);
    expect(key(actor, draft, {}, 4)).not.toBe(base);
    expect(key(actor, draft, {}, 0, "next-plan-schema")).not.toBe(base);
  });

  it("keys the exact language labels and case-sensitive campaign exclusions used by plan building", () => {
    const actor = actorFixture();
    const draft = equipmentDraft();
    const settings = (languages: Record<string, string>, unavailable: string[]) => ({
      ...buildActorRenderFoundationLanguageSettings(languages, new Set(unavailable)),
    });
    const base = key(actor, draft, settings({ draconic: "PF2E.Language.Draconic" }, ["draconic"]));

    expect(key(actor, draft, settings({ draconic: "MODULE.Language.Draconic" }, ["draconic"]))).not.toBe(base);
    expect(key(actor, draft, settings({ draconic: "PF2E.Language.Draconic" }, ["Draconic"]))).not.toBe(base);
  });

  it("keeps catalogue-only cache work stable but misses real compendium source changes", () => {
    const before = getActorRenderFoundationSourceGeneration();
    expect(getActorRenderFoundationSourceGeneration()).toBe(before);

    expect(noteActorRenderFoundationSourceChange({ pack: "pf2e.feats-srd", type: "feat" })).toBe(true);
    expect(getActorRenderFoundationSourceGeneration()).toBe(before + 1);
  });

  it("rerenders after source generation advances even when another source hook rendered first", () => {
    const rerender = vi.fn();
    registerActorRenderFoundationSourceInvalidation(rerender);
    const before = getActorRenderFoundationSourceGeneration();

    expect(handleActorRenderFoundationSourceChange({ pack: "pf2e.feats-srd", type: "feat" })).toBe(true);
    expect(getActorRenderFoundationSourceGeneration()).toBe(before + 1);
    expect(rerender).toHaveBeenCalledOnce();
  });
});

function key(
  actor: ReturnType<typeof actorFixture>,
  draft: DraftState,
  settings: Record<string, unknown> = {},
  sourceGeneration = 0,
  planSchema?: string
): string {
  return buildActorRenderFoundationKey({
    actor,
    snapshot: inspectActor(actor),
    draft,
    recentlyInvalidatedStepIds: new Set(),
    settings: { extraPacks: "", spellRarityCeiling: "common", locale: "en", ...settings },
    sourceGeneration,
    ...(planSchema ? { planSchema } : {}),
  });
}

function actorFixture() {
  return {
    id: "actor-1",
    system: {
      details: { level: { value: 1 }, languages: { value: ["common"] } },
      skills: { arcana: { rank: 1 } },
      build: { attributes: { boosts: {} } },
    },
    _source: {
      system: {
        details: { level: { value: 1 }, languages: { value: ["common"] } },
        skills: { arcana: { rank: 1 } },
        build: { attributes: { boosts: {} } },
      },
      flags: { [MODULE_ID]: { draft: { ignored: true }, state: { completedStepIds: [] } } },
    },
    flags: { [MODULE_ID]: { state: { completedStepIds: [] } } },
    items: { contents: [] as unknown[] },
    feats: { get: () => null },
  };
}

function equipmentDraft(): DraftState {
  const draft = createEmptyDraft(5);
  draft.acquisition = acquisitionFixture({ disposition: "unreviewed" }).draft;
  return draft;
}

function withQuantity(draft: DraftState, quantity: number): DraftState {
  const candidate = structuredClone(draft);
  const line = candidate.acquisition!.lines[0]!;
  candidate.acquisition = {
    ...candidate.acquisition!,
    lines: [{ ...line, price: { ...line.price, requestedQuantity: quantity } }],
  };
  return candidate;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
