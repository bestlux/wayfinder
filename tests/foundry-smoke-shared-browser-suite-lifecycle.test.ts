import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadWayfinderBrowserSuite,
  reloadWayfinderBrowserSuite,
} from "../tools/foundry-smoke/shared-browser-suite-lifecycle.mjs";

const smokeRoot = resolve("tools/foundry-smoke");

describe("Foundry shared browser-suite lifecycle", () => {
  it("loads preconditions, policy, shared suite, and extensions in exact order", async () => {
    const calls: string[] = [];
    const page = {
      addScriptTag: async ({ path }: { path: string }) => calls.push(basename(path)),
    };

    await loadWayfinderBrowserSuite(page, {
      beforeSuitePaths: [resolve(smokeRoot, "cleanup.js")],
      afterSuitePaths: [resolve(smokeRoot, "extension.js")],
    });

    expect(calls).toEqual(["cleanup.js", "skill-selection-policy.js", "browser-suite.js", "extension.js"]);
  });

  it("fails before the shared suite or extension when policy injection fails", async () => {
    const calls: string[] = [];
    const page = {
      addScriptTag: async ({ path }: { path: string }) => {
        const name = basename(path);
        calls.push(name);
        if (name === "skill-selection-policy.js") throw new Error("policy injection failed");
      },
    };

    await expect(
      loadWayfinderBrowserSuite(page, { afterSuitePaths: [resolve(smokeRoot, "extension.js")] })
    ).rejects.toThrow("policy injection failed");
    expect(calls).toEqual(["skill-selection-policy.js"]);
  });

  it("waits for a ready Foundry document before restoring ordered suite globals after reload", async () => {
    const calls: string[] = [];
    const page = {
      addInitScript: async ({ path }: { path: string }) => calls.push(`init:${basename(path)}`),
      reload: async ({ waitUntil }: { waitUntil: string }) => calls.push(`reload:${waitUntil}`),
      waitForFunction: async (_predicate: () => boolean, value: unknown, { timeout }: { timeout: number }) =>
        calls.push(`ready:${String(value)}:${timeout}`),
      addScriptTag: async ({ path }: { path: string }) => calls.push(`script:${basename(path)}`),
    };

    await reloadWayfinderBrowserSuite(page, {
      beforeSuitePaths: [resolve(smokeRoot, "cleanup.js")],
      afterSuitePaths: [resolve(smokeRoot, "extension.js")],
      initScriptPaths: [resolve(smokeRoot, "cleanup.js")],
    });

    expect(calls).toEqual([
      "init:cleanup.js",
      "reload:domcontentloaded",
      "ready:null:60000",
      "script:cleanup.js",
      "script:skill-selection-policy.js",
      "script:browser-suite.js",
      "script:extension.js",
    ]);
  });

  it("routes every shared-suite consumer through the policy-first lifecycle", () => {
    const consumers = {
      "acquisition-browser-lifecycle.mjs": ["loadWayfinderBrowserSuite", "reloadWayfinderBrowserSuite"],
      "run-draft-persistence-tracer.mjs": [
        "loadWayfinderBrowserSuite(setupPage)",
        "loadWayfinderBrowserSuite(playerPage)",
      ],
      "run-foundry-smoke.mjs": ["loadWayfinderBrowserSuite(page)"],
      "run-owner-access-probe.mjs": ["loadWayfinderBrowserSuite(setupPage)", "loadWayfinderBrowserSuite(playerPage)"],
      "run-wf43-experience-smoke.mjs": ["loadWayfinderBrowserSuite(page", "reloadWayfinderBrowserSuite(page"],
    };
    for (const [file, anchors] of Object.entries(consumers)) {
      const source = readFileSync(resolve(smokeRoot, file), "utf8");
      for (const anchor of anchors) expect(source, `${file}: ${anchor}`).toContain(anchor);
    }

    const directConsumers = readdirSync(smokeRoot)
      .filter((file) => file.endsWith(".mjs"))
      .filter((file) => readFileSync(resolve(smokeRoot, file), "utf8").includes('"browser-suite.js"'))
      .sort();
    expect(directConsumers).toEqual(["shared-browser-suite-lifecycle.mjs"]);
  });
});
