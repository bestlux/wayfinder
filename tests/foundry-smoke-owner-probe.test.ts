import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createExclusiveOwnerProbeArtifactDirectory,
  writeOwnerProbeArtifacts,
} from "../tools/foundry-smoke/owner-probe-artifacts.mjs";
import {
  buildOwnerProbeEvidence,
  OWNER_PROBE_SCHEMA_VERSION,
  validateOwnerProbeOptions,
} from "../tools/foundry-smoke/owner-probe-contract.mjs";

const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");
const runner = readFileSync(resolve("tools/foundry-smoke/run-owner-access-probe.mjs"), "utf8");

describe("Foundry two-session owner probe", () => {
  it("accepts only distinct configured users with guarded cleanup", () => {
    expect(
      validateOwnerProbeOptions({
        setupUser: "Gamemaster",
        playerUser: "Owner Probe Player",
        allowDestructive: true,
        expectedWorldId: "testing-world",
      })
    ).toMatchObject({ allowDestructive: true, expectedWorldId: "testing-world" });

    for (const overrides of [
      { setupUser: "", playerUser: "Player", allowDestructive: true, expectedWorldId: "world" },
      { setupUser: "GM", playerUser: "gm", allowDestructive: true, expectedWorldId: "world" },
      { setupUser: "GM", playerUser: "Player", allowDestructive: false, expectedWorldId: "world" },
      { setupUser: "GM", playerUser: "Player", allowDestructive: true, expectedWorldId: "" },
    ]) {
      expect(() => validateOwnerProbeOptions(overrides)).toThrow();
    }
  });

  it("qualifies explicit non-GM ownership and the actor-sheet launch path", () => {
    const result = buildOwnerProbeEvidence(rawProbeFixture());

    expect(result).toMatchObject({
      schemaVersion: OWNER_PROBE_SCHEMA_VERSION,
      evidenceId: "owner-probe-evidence",
      qualification: { passed: true },
      failures: [],
      actorAuthority: {
        defaultOwnershipLevel: 0,
        explicitOwnershipLevel: 3,
        isOwner: true,
        ownerPermission: true,
        canUpdate: true,
      },
      ui: {
        launchControlClicked: true,
        actorBoundAppOpened: true,
        renderLifecycleCompleted: true,
      },
    });
  });

  it("rejects GM-as-player, default-owner, insufficient authority, UI, runtime, and cleanup gaps", () => {
    const raw = rawProbeFixture();
    Object.assign(raw.player.session, { isGM: true });
    Object.assign(raw.player.authority, {
      defaultOwnershipLevel: 3,
      explicitOwnershipLevel: 2,
      isOwner: false,
      ownerPermission: false,
      canUpdate: false,
    });
    raw.player.ui.actorBoundAppOpened = false;
    raw.player.runtime.moduleVersion = "different";
    raw.cleanup.actorMissingAfterCleanup = false;
    const result = buildOwnerProbeEvidence(raw);

    expect(result.qualification.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "Player session is not a current non-GM.",
        "Fixture default ownership is not NONE.",
        "Player explicit ownership is not OWNER.",
        "Player lacks actor.isOwner.",
        "Player lacks OWNER permission.",
        "Player lacks actor update permission.",
        "Owner UI probe did not prove actor-bound Wayfinder app.",
        "GM and player sessions did not prove one guarded runtime.",
        "Owner probe cleanup did not prove post-cleanup absence.",
      ])
    );
  });

  it("whitelists evidence without user, actor, credential, cookie, or storage identities", () => {
    const raw = rawProbeFixture() as any;
    raw.setup.userName = "PRIVATE_SETUP_USER";
    raw.setup.playerId = "PRIVATE_PLAYER_ID";
    raw.setup.actorId = "PRIVATE_ACTOR_ID";
    raw.player.password = "PRIVATE_PASSWORD";
    raw.player.cookies = "PRIVATE_COOKIE";
    raw.player.storageState = "PRIVATE_STORAGE";
    raw.execution.failureStages = ["PRIVATE_FAILURE_MESSAGE"];
    const serialized = JSON.stringify(buildOwnerProbeEvidence(raw));

    for (const sentinel of [
      "PRIVATE_SETUP_USER",
      "PRIVATE_PLAYER_ID",
      "PRIVATE_ACTOR_ID",
      "PRIVATE_PASSWORD",
      "PRIVATE_COOKIE",
      "PRIVATE_STORAGE",
      "PRIVATE_FAILURE_MESSAGE",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("fails closed for incomplete execution and normalizes failure stages", () => {
    const raw = rawProbeFixture();
    raw.execution = {
      completed: true,
      failureStages: ["player-session", "player-session", "PRIVATE_ERROR"],
    };

    const result = buildOwnerProbeEvidence(raw);

    expect(result.execution).toEqual({
      completed: false,
      failureStages: ["player-session", "invalid-execution-stage"],
    });
    expect(result.qualification.passed).toBe(false);
  });

  it("publishes immutable hash-bound artifacts only in a fresh directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "wayfinder-owner-probe-"));
    try {
      const outDir = await createExclusiveOwnerProbeArtifactDirectory(
        temporaryRoot,
        "evidence",
        "owner-probe-evidence"
      );
      await expect(
        createExclusiveOwnerProbeArtifactDirectory(temporaryRoot, "evidence", "another-evidence-id")
      ).rejects.toThrow();

      const result = buildOwnerProbeEvidence(rawProbeFixture());
      const markdown = "# Owner probe\n";
      const completion = await writeOwnerProbeArtifacts(outDir, result, markdown);
      const resultBytes = await readFile(join(outDir, "owner-probe-results.json"), "utf8");
      const summaryBytes = await readFile(join(outDir, "owner-probe-summary.md"), "utf8");
      const completionBytes = await readFile(join(outDir, "owner-probe-completion.json"), "utf8");

      expect(JSON.parse(completionBytes)).toEqual(completion);
      expect(completion).toMatchObject({
        evidenceId: "owner-probe-evidence",
        qualified: true,
        resultSha256: sha256(resultBytes),
        summarySha256: sha256(summaryBytes),
      });
      await expect(writeOwnerProbeArtifacts(outDir, result, "changed\n")).rejects.toThrow();
      expect(await readFile(join(outDir, "owner-probe-summary.md"), "utf8")).toBe(markdown);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("publishes a fresh non-qualifying completion marker after a failed run", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "wayfinder-owner-probe-failed-"));
    try {
      const firstDir = await createExclusiveOwnerProbeArtifactDirectory(
        temporaryRoot,
        undefined,
        "first-evidence",
        new Date("2026-08-16T12:00:00.000Z")
      );
      const secondDir = await createExclusiveOwnerProbeArtifactDirectory(
        temporaryRoot,
        undefined,
        "second-evidence",
        new Date("2026-08-16T12:00:00.000Z")
      );
      expect(firstDir).not.toBe(secondDir);

      const raw = rawProbeFixture();
      raw.evidenceId = "second-evidence";
      raw.execution = { completed: false, failureStages: ["player-session"] };
      const result = buildOwnerProbeEvidence(raw);
      const completion = await writeOwnerProbeArtifacts(secondDir, result, "# Failed owner probe\n");

      expect(result.qualification.passed).toBe(false);
      expect(completion).toMatchObject({ evidenceId: "second-evidence", qualified: false });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("uses a real sheet control, two isolated contexts, player-first close, and exact GM cleanup", () => {
    expect(browserSuite).toContain("globalThis.__prepareWayfinderOwnerProbe");
    expect(browserSuite).toContain("globalThis.__runWayfinderOwnerProbe");
    expect(browserSuite).toContain('sheetRoot.querySelector(".wayfinder-launch")');
    expect(browserSuite).toContain('Hooks.on("renderWayfinderApp"');
    expect(browserSuite).toContain("renderedApp === app && rootElementOf(app.element)?.isConnected");
    expect(browserSuite).toContain("await sheet.close();");
    expect(browserSuite).toContain("candidate instanceof modules.WayfinderApp && candidate.actor?.id === actor.id");
    expect(browserSuite).toContain('actor.getFlag(moduleId, "smokeOwnerProbe")?.runId === runId');
    expect(browserSuite).toContain("globalThis.__cleanupWayfinderOwnerProbe");
    expect(runner.match(/browser\.newContext\(/gu)).toHaveLength(2);
    expect(runner.indexOf("await playerContext.close();")).toBeLessThan(
      runner.indexOf("globalThis.__cleanupWayfinderOwnerProbe")
    );
    expect(runner).toContain("createExclusiveOwnerProbeArtifactDirectory");
    expect(runner).toContain("writeOwnerProbeArtifacts");
    expect(runner).not.toContain("console.error(error)");
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rawProbeFixture() {
  const runtime = {
    foundryVersion: "14.366",
    moduleVersion: "0.8.0-dev",
    pf2eVersion: "8.4.0",
    guardedWorldMatched: true,
  };
  return {
    evidenceId: "owner-probe-evidence",
    startedAt: "2026-08-16T12:00:00.000Z",
    finishedAt: "2026-08-16T12:00:05.000Z",
    execution: { completed: true, failureStages: [] },
    setup: {
      session: { role: 4, isGM: true, distinctPlayerResolved: true },
      runtime,
    },
    player: {
      session: { role: 1, isGM: false },
      authority: {
        noneLevel: 0,
        ownerLevel: 3,
        defaultOwnershipLevel: 0,
        explicitOwnershipLevel: 3,
        isOwner: true,
        ownerPermission: true,
        canUpdate: true,
      },
      ui: {
        actorSheetOpened: true,
        launchControlFound: true,
        launchControlClicked: true,
        actorBoundAppOpened: true,
        renderLifecycleCompleted: true,
        appClosed: true,
        actorSheetClosed: true,
      },
      runtime: { ...runtime },
    },
    cleanup: {
      exactFixtureMatched: true,
      actorDeleted: true,
      actorMissingAfterCleanup: true,
    },
  };
}
