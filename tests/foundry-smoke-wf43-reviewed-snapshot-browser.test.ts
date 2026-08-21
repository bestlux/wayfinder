import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;
const browserSuite = readFileSync(resolve("tools/foundry-smoke/wf43-experience-browser-suite.js"), "utf8");

browserIt(
  "validates explicit reviewed snapshot provenance and restores the exact draft durably",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<main></main>");
      await page.addScriptTag({ content: browserSuite });
      const evidence = await page.evaluate(async () => {
        const suite = globalThis as any;
        const moduleId = "wayfinder-pf2e";
        const runId = "run-1";
        const expectedWorldId = "testing-world";
        const fixture = {
          actorId: "actor-1",
          fixtureName: "WF43 actor",
          locale: "en",
          definitionFingerprint: "definition-1",
          profileId: "profile-1",
          itemSourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
          itemName: "Dagger",
        };
        const sparseSlots: unknown[] = [];
        sparseSlots[1] = "kept";
        const reviewedDraft = {
          schemaVersion: 1,
          metadata: { kept: true, omitted: undefined },
          sparseSlots,
          acquisition: {
            disposition: { kind: "purchase-ledger" },
            lines: [{ lineId: "line-1", sourceUuid: "Compendium.pf2e.equipment-srd.Item.item" }],
          },
        };
        const handoffDraft = {
          ...structuredClone(reviewedDraft),
          acquisition: {
            ...structuredClone(reviewedDraft.acquisition),
            disposition: {
              kind: "handoff",
              handoff: {
                kind: "pf2e-sheet",
                reasons: [
                  {
                    code: "unsafe-configured-item",
                    sourceUuid: fixture.itemSourceUuid,
                    itemName: fixture.itemName,
                    issue: "specific-magic-item",
                  },
                ],
              },
            },
          },
        };
        let storedDraft: unknown = structuredClone(handoffDraft);
        let corruptWrites = false;
        const marker = {
          purpose: "wf08043-live-experience",
          runId,
          locale: fixture.locale,
          definitionFingerprint: fixture.definitionFingerprint,
          profileId: fixture.profileId,
        };
        const actor = {
          id: fixture.actorId,
          name: fixture.fixtureName,
          apps: {},
          getFlag(_module: string, key: string) {
            if (key === "draft") return structuredClone(storedDraft);
            if (key === "smokeWf43Experience") return marker;
            if (key === "equipmentProfileFixture") return { profileId: fixture.profileId, runId };
            return null;
          },
          async setFlag(_module: string, key: string, value: unknown) {
            if (key === "draft") {
              storedDraft = structuredClone(value);
              if (corruptWrites && storedDraft && typeof storedDraft === "object") {
                storedDraft = { ...(storedDraft as Record<string, unknown>), corrupted: true };
              }
            }
          },
        };
        suite.game = {
          world: { id: expectedWorldId },
          user: { isGM: false },
          actors: new Map([[actor.id, actor]]),
        };
        const token = suite.__createWayfinderWf43ReviewedSnapshotToken({
          actor,
          draft: reviewedDraft,
          expectedWorldId,
          fixture,
          runId,
        });
        const payload = { expectedWorldId, fixture, moduleId, reviewedSnapshot: token, runId };
        const attempt = async (reviewedSnapshot: unknown, currentDraft: unknown = handoffDraft) => {
          storedDraft = structuredClone(currentDraft);
          try {
            await suite.__restoreWayfinderWf43ReviewedDraft({ ...payload, reviewedSnapshot });
            return "accepted";
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        };

        const missing = await attempt(null);
        const wrongActor = structuredClone(token);
        wrongActor.subject.actorId = "actor-2";
        const actorFailure = await attempt(wrongActor);
        const wrongDraft = structuredClone(token);
        wrongDraft.draft.acquisition.lines.push({ lineId: "line-2" });
        const draftFailure = await attempt(wrongDraft);
        const undefinedDraft = structuredClone(token);
        undefinedDraft.draft.transient = undefined;
        const undefinedFailure = await attempt(undefinedDraft);
        const sparseDraft = structuredClone(token);
        const sparseLines: unknown[] = [];
        sparseLines[1] = structuredClone(token.draft.acquisition.lines[0]);
        sparseDraft.draft.acquisition.lines = sparseLines;
        const sparseFailure = await attempt(sparseDraft);
        const wrongRun = structuredClone(token);
        wrongRun.subject.runId = "run-2";
        const runFailure = await attempt(wrongRun);
        const wrongWorld = structuredClone(token);
        wrongWorld.subject.worldId = "other-world";
        const worldFailure = await attempt(wrongWorld);
        const wrongSubject = structuredClone(token);
        wrongSubject.subject.profileId = "profile-2";
        const subjectFailure = await attempt(wrongSubject);
        const wrongDisposition = structuredClone(token);
        wrongDisposition.subject.dispositionKind = "configured-item-handoff";
        const dispositionFailure = await attempt(wrongDisposition);
        const currentDispositionFailure = await attempt(token, reviewedDraft);
        const wrongIssueHandoff = structuredClone(handoffDraft);
        wrongIssueHandoff.acquisition.disposition.handoff.reasons[0].issue = "changed-issue";
        const currentIssueFailure = await attempt(token, wrongIssueHandoff);
        const extraReasonHandoff = structuredClone(handoffDraft);
        extraReasonHandoff.acquisition.disposition.handoff.reasons.push({
          code: "unsafe-configured-item",
          sourceUuid: fixture.itemSourceUuid,
          itemName: "Other item",
          issue: "specific-magic-item",
        });
        const extraReasonFailure = await attempt(token, extraReasonHandoff);
        corruptWrites = true;
        const durableFailure = await attempt(token);
        corruptWrites = false;

        const nonSerializableFailure = (value: unknown) => {
          try {
            suite.__createWayfinderWf43ReviewedSnapshotToken({
              actor,
              draft: value,
              expectedWorldId,
              fixture,
              runId,
            });
            return "accepted";
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        };
        const functionDraft: Record<string, unknown> = structuredClone(reviewedDraft);
        functionDraft.nonSerializable = () => true;
        const functionFailure = nonSerializableFailure(functionDraft);
        const bigintDraft: Record<string, unknown> = structuredClone(reviewedDraft);
        bigintDraft.nonSerializable = 1n;
        const bigintFailure = nonSerializableFailure(bigintDraft);
        const cyclicDraft: Record<string, unknown> = structuredClone(reviewedDraft);
        cyclicDraft.self = cyclicDraft;
        const cyclicFailure = nonSerializableFailure(cyclicDraft);
        const customArrayDraft = structuredClone(reviewedDraft);
        (customArrayDraft.acquisition.lines as unknown as Record<string, unknown>).extra = () => true;
        const customArrayFailure = nonSerializableFailure(customArrayDraft);
        const toJsonArrayDraft = structuredClone(reviewedDraft);
        (toJsonArrayDraft.acquisition.lines as unknown as Record<string, unknown>).toJSON = () => [];
        const toJsonArrayFailure = nonSerializableFailure(toJsonArrayDraft);
        const symbolArrayDraft = structuredClone(reviewedDraft);
        symbolArrayDraft.acquisition.lines[Symbol("hidden")] = 1n;
        const symbolArrayFailure = nonSerializableFailure(symbolArrayDraft);
        const prototypeArrayDraft = structuredClone(reviewedDraft);
        Object.setPrototypeOf(prototypeArrayDraft.acquisition.lines, Object.create(Array.prototype));
        const prototypeArrayFailure = nonSerializableFailure(prototypeArrayDraft);

        storedDraft = structuredClone(handoffDraft);
        const restored = await suite.__restoreWayfinderWf43ReviewedDraft(payload);
        return {
          failures: {
            missing,
            actorFailure,
            draftFailure,
            undefinedFailure,
            sparseFailure,
            runFailure,
            worldFailure,
            subjectFailure,
            dispositionFailure,
            currentDispositionFailure,
            currentIssueFailure,
            extraReasonFailure,
            durableFailure,
            functionFailure,
            bigintFailure,
            cyclicFailure,
            customArrayFailure,
            toJsonArrayFailure,
            symbolArrayFailure,
            prototypeArrayFailure,
          },
          restored,
          durableDraft: storedDraft,
          tokenDraft: token.draft,
          normalized: {
            omittedUndefined: !Object.hasOwn(token.draft.metadata, "omitted"),
            sparseFirst: token.draft.sparseSlots[0],
            sparseLength: token.draft.sparseSlots.length,
          },
          tokenHasDraft: Object.hasOwn(restored.provenance, "draft"),
        };
      });

      expect(evidence.failures).toEqual({
        missing: "WF-080-43 reviewed snapshot token is required.",
        actorFailure: "WF-080-43 reviewed snapshot token actor changed.",
        draftFailure: "WF-080-43 reviewed snapshot token draft changed.",
        undefinedFailure:
          'WF-080-43 reviewed snapshot token draft is not durable: {"path":"$[\\"transient\\"]","expectedClass":"undefined","observedClass":"missing"}',
        sparseFailure:
          'WF-080-43 reviewed snapshot token draft is not durable: {"path":"$[\\"acquisition\\"][\\"lines\\"][0]","expectedClass":"missing","observedClass":"null"}',
        runFailure: "WF-080-43 reviewed snapshot token run changed.",
        worldFailure: "WF-080-43 reviewed snapshot token world changed.",
        subjectFailure: "WF-080-43 reviewed snapshot token subject changed.",
        dispositionFailure: "WF-080-43 reviewed snapshot token disposition changed.",
        currentDispositionFailure:
          "WF-080-43 reviewed snapshot restore requires the configured-item handoff disposition.",
        currentIssueFailure: "WF-080-43 reviewed snapshot restore requires the configured-item handoff disposition.",
        extraReasonFailure: "WF-080-43 reviewed snapshot restore requires the configured-item handoff disposition.",
        durableFailure:
          'WF-080-43 reviewed snapshot restore persistence changed: {"path":"$[\\"corrupted\\"]","expectedClass":"missing","observedClass":"boolean"}',
        functionFailure: 'WF-080-43 reviewed snapshot is not JSON-durable at $["nonSerializable"] (function).',
        bigintFailure: 'WF-080-43 reviewed snapshot is not JSON-durable at $["nonSerializable"] (bigint).',
        cyclicFailure: 'WF-080-43 reviewed snapshot is not JSON-durable at $["self"] (cyclic-object).',
        customArrayFailure:
          'WF-080-43 reviewed snapshot is not JSON-durable at $["acquisition"]["lines"] (custom-keyed-array).',
        toJsonArrayFailure:
          'WF-080-43 reviewed snapshot is not JSON-durable at $["acquisition"]["lines"] (custom-keyed-array).',
        symbolArrayFailure:
          'WF-080-43 reviewed snapshot is not JSON-durable at $["acquisition"]["lines"] (symbol-keyed-array).',
        prototypeArrayFailure: 'WF-080-43 reviewed snapshot is not JSON-durable at $["acquisition"]["lines"] (array).',
      });
      expect(evidence.durableDraft).toEqual(evidence.tokenDraft);
      expect(evidence.normalized).toEqual({ omittedUndefined: true, sparseFirst: null, sparseLength: 2 });
      expect(evidence.restored).toMatchObject({
        actorId: "actor-1",
        kind: "purchase-ledger",
        provenance: {
          purpose: "wf08043-reviewed-draft-snapshot",
          dispositionKind: "purchase-ledger",
          draftFingerprint: expect.stringMatching(/^fnv1a64:[0-9a-f]{16}$/u),
        },
      });
      expect(evidence.tokenHasDraft).toBe(false);
    } finally {
      await browser.close();
    }
  },
  20_000
);
