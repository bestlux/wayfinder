import { describe, expect, it, vi } from "vitest";
import {
  cleanupWf43ExperienceWithRecovery,
  createWf43RecoveryPage,
  recoverWf43FailedSetupWithRecovery,
  restoreWf43WorldSettingsWithRecovery,
} from "../tools/foundry-smoke/wf43-experience-browser-lifecycle.mjs";

describe("WF-080-43 cleanup recovery lifecycle", () => {
  it("recovers exact guarded cleanup through a fresh ready GM authority", async () => {
    const failedPage = fakeAuthorityPage(false);
    const recoveredPage = fakeAuthorityPage(true, { actorsDeleted: 2 });
    const recoverPage = vi.fn().mockResolvedValue(recoveredPage);

    await expect(cleanupWf43ExperienceWithRecovery([failedPage], { runId: "run-id" }, recoverPage)).resolves.toEqual({
      actorsDeleted: 2,
    });
    expect(recoverPage).toHaveBeenCalledOnce();
    expect(recoveredPage.execute).toHaveBeenCalledWith({ runId: "run-id" });
  });

  it("preserves an exact cleanup rejection without retrying it on another GM session", async () => {
    const exactFailure = new Error("exact fixture did not match");
    const page = fakeAuthorityPage(true, exactFailure);
    const recoverPage = vi.fn();

    await expect(cleanupWf43ExperienceWithRecovery([page], { runId: "run-id" }, recoverPage)).rejects.toBe(
      exactFailure
    );
    expect(recoverPage).not.toHaveBeenCalled();
  });

  it("restores exact policy and pack snapshots after the original GM authority is lost", async () => {
    const failedPage = fakeAuthorityPage(false);
    const recoveredPage = fakeAuthorityPage(true, {
      policyRestored: true,
      packsRestored: true,
      failures: [],
    });
    const recoverPage = vi.fn().mockResolvedValue(recoveredPage);
    const payload = { snapshots: { policy: { enabled: true }, packs: { equipment: {} } } };

    await expect(restoreWf43WorldSettingsWithRecovery([failedPage], payload, recoverPage)).resolves.toEqual({
      policyRestored: true,
      packsRestored: true,
      failures: [],
    });
    expect(recoverPage).toHaveBeenCalledOnce();
    expect(recoveredPage.execute).toHaveBeenCalledWith(payload);
  });

  it("accepts canonically equal reordered policy and pack records from Foundry", async () => {
    const snapshots = {
      policy: { zeta: { second: 2, first: 1 }, alpha: true },
      packs: { equipment: { beta: { load: false }, alpha: { load: true } } },
    };
    const page = callbackPage({ actorCount: 0, snapshots, reorderSettings: true });
    const recoverPage = vi.fn();

    await expect(
      restoreWf43WorldSettingsWithRecovery(
        [page],
        {
          expectedWorldId: "testing-world",
          moduleId: "wayfinder-pf2e",
          packsSetting: "compendiumBrowserPacks",
          policySetting: "equipmentPolicy",
          snapshots,
        },
        recoverPage
      )
    ).resolves.toEqual({ policyRestored: true, packsRestored: true, failures: [] });
    expect(recoverPage).not.toHaveBeenCalled();
  });

  it("independently recovers an exact unmarked actor left by failed fixture setup", async () => {
    const runId = "run-id";
    const fixtureName = `WF Smoke Harness - en - wf43-experience-en-${runId} - ${runId}`;
    const snapshots = {
      actorCount: 0,
      language: "en",
      policy: { enabled: true },
      packs: { equipment: {} },
    };
    const page = callbackPage({ actorCount: 1, snapshots, fixtureName });

    await expect(
      recoverWf43FailedSetupWithRecovery(
        [page],
        {
          allowDestructive: true,
          expectedFixtures: [
            {
              definitionFingerprint: "fingerprint",
              fixtureName,
              locale: "en",
              profileId: `wf43-experience-en-${runId}`,
            },
          ],
          expectedWorldId: "testing-world",
          moduleId: "wayfinder-pf2e",
          packsSetting: "compendiumBrowserPacks",
          policySetting: "equipmentPolicy",
          runId,
          snapshots,
        },
        vi.fn()
      )
    ).resolves.toMatchObject({
      attempted: true,
      setupCompleted: false,
      actorsDeleted: 1,
      actorsMissingAfterCleanup: true,
      actorCountRestored: true,
      exactFixturesMatched: true,
      policyRestored: true,
      packsRestored: true,
      languageRestored: true,
      restorationFailures: [],
    });
  });

  it.each([
    ["locale", { locale: "cn" }],
    ["profile", { profileId: "changed-profile" }],
    ["fingerprint", { definitionFingerprint: "changed-fingerprint" }],
  ])("refuses failed-setup deletion when exact-name %s provenance changed", async (_label, changed) => {
    const runId = "run-id";
    const profileId = `wf43-experience-en-${runId}`;
    const fixtureName = `WF Smoke Harness - en - ${profileId} - ${runId}`;
    const snapshots = {
      actorCount: 0,
      language: "en",
      policy: { enabled: true },
      packs: { equipment: {} },
    };
    const experienceMarker = {
      purpose: "wf08043-live-experience",
      runId,
      locale: "en",
      definitionFingerprint: "fingerprint",
      fixtureName,
      profileId,
      ...changed,
    };
    const page = callbackPage({ actorCount: 1, snapshots, fixtureName, experienceMarker });

    const result = await recoverWf43FailedSetupWithRecovery(
      [page],
      {
        allowDestructive: true,
        expectedFixtures: [{ definitionFingerprint: "fingerprint", fixtureName, locale: "en", profileId }],
        expectedWorldId: "testing-world",
        moduleId: "wayfinder-pf2e",
        packsSetting: "compendiumBrowserPacks",
        policySetting: "equipmentPolicy",
        runId,
        snapshots,
      },
      vi.fn()
    );

    expect(result).toMatchObject({
      actorsDeleted: 0,
      actorsMissingAfterCleanup: false,
      actorCountRestored: false,
      exactFixturesMatched: false,
      restorationFailures: expect.arrayContaining([expect.stringContaining("refused changed fixture provenance")]),
    });
  });

  it("closes the failed GM context before opening recovery and closes a failed replacement", async () => {
    const calls: string[] = [];
    const failedContext = { close: vi.fn(async () => calls.push("failed-close")) };
    const replacementContext = {
      newPage: vi.fn(async () => ({ id: "recovery-page" })),
      close: vi.fn(async () => calls.push("replacement-close")),
    };
    const browser = {
      newContext: vi.fn(async () => {
        calls.push("replacement-open");
        return replacementContext;
      }),
    };
    const login = vi.fn(async () => calls.push("login"));
    const load = vi.fn(async () => {
      calls.push("load");
      throw new Error("suite load failed");
    });

    await expect(createWf43RecoveryPage({ browser, failedContext, login, load })).rejects.toThrow("suite load failed");
    expect(calls).toEqual(["failed-close", "replacement-open", "login", "load", "replacement-close"]);
  });
});

function fakeAuthorityPage(available: boolean, result: unknown = undefined) {
  const execute = vi.fn(async (_payload: unknown) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    execute,
    evaluate: vi.fn(async (_callback: unknown, payload: unknown) => {
      if (typeof payload === "string" || payload === null) return available;
      return execute(payload);
    }),
  };
}

function callbackPage({
  actorCount,
  snapshots,
  fixtureName,
  experienceMarker,
  reorderSettings = false,
}: {
  actorCount: number;
  snapshots: { language?: string; packs: unknown; policy: unknown };
  fixtureName?: string;
  experienceMarker?: Record<string, unknown>;
  reorderSettings?: boolean;
}) {
  const actors = new Map<string, any>();
  if (fixtureName) {
    const actor = {
      name: fixtureName,
      apps: {},
      getFlag: (_moduleId: string, key: string) => (key === "smokeWf43Experience" ? (experienceMarker ?? null) : null),
      delete: async () => actors.delete("fixture"),
    };
    actors.set("fixture", actor);
  }
  expect(actors.size).toBe(actorCount);
  const settings = new Map<string, unknown>([
    ["wayfinder-pf2e.equipmentPolicy", snapshots.policy],
    ["pf2e.compendiumBrowserPacks", snapshots.packs],
    ["core.language", snapshots.language ?? "en"],
  ]);
  const game = {
    ready: true,
    user: { isGM: true },
    world: { id: "testing-world" },
    actors,
    i18n: { lang: snapshots.language ?? "en" },
    settings: {
      get: (scope: string, key: string) => settings.get(`${scope}.${key}`),
      set: async (scope: string, key: string, value: unknown) => {
        settings.set(`${scope}.${key}`, reorderSettings ? reverseObjectKeys(value) : value);
      },
    },
  };
  return {
    evaluate: async (callback: (payload: any) => unknown, payload: unknown) => {
      const previousGame = (globalThis as any).game;
      (globalThis as any).game = game;
      try {
        return await callback(payload);
      } finally {
        (globalThis as any).game = previousGame;
      }
    },
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectKeys(entry)])
  );
}
