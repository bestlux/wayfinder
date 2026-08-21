import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DraftApplyCheckpoint } from "../src/actor-updater.js";
import {
  AcquisitionSmokeCheckpointController,
  AcquisitionSmokeCheckpointFailure,
  registerAcquisitionSmokeDriver,
} from "../src/wayfinder/application/acquisition-smoke-driver.js";

const globals = globalThis as typeof globalThis & {
  __wayfinderAcquisitionSmokeBootstrap?: unknown;
  __wayfinderAcquisitionSmokeDriver?: { revoke: () => void };
};
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

afterEach(() => {
  globals.__wayfinderAcquisitionSmokeDriver?.revoke();
  delete globals.__wayfinderAcquisitionSmokeBootstrap;
  if (originalSessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", originalSessionStorage);
  } else {
    delete (globalThis as unknown as Record<string, unknown>).sessionStorage;
  }
});

describe("acquisition UI smoke checkpoint capability", () => {
  it("injects one exact typed boundary and forwards retry writes in execution order", async () => {
    const observed: DraftApplyCheckpoint[] = [];
    const controller = new AcquisitionSmokeCheckpointController(
      {
        checkpointId: "write:embedded-item-create:after",
        occurrence: 1,
        expectedPoint: "item-after",
      },
      (checkpoint) => {
        observed.push(checkpoint);
      }
    );

    await controller.hook(writeCheckpoint("embedded-item-create", "before", 1));
    await expect(controller.hook(writeCheckpoint("embedded-item-create", "after", 1))).rejects.toMatchObject({
      name: "AcquisitionSmokeCheckpointFailure",
      checkpoint: writeCheckpoint("embedded-item-create", "after", 1),
    });
    expect(controller.failure).toBeInstanceOf(AcquisitionSmokeCheckpointFailure);
    controller.assertInitialAttemptComplete();

    controller.beginRetry();
    const retry = [
      writeCheckpoint("currency-convergence", "before", 1),
      writeCheckpoint("currency-convergence", "after", 1),
      writeCheckpoint("final-actor-update", "before", 1),
      writeCheckpoint("final-actor-update", "after", 1),
    ];
    for (const checkpoint of retry) await controller.hook(checkpoint);
    expect(observed).toEqual(retry);

    controller.finish();
    await expect(controller.hook(writeCheckpoint("final-actor-update", "after", 1))).rejects.toThrow(
      "capability has been revoked"
    );
  });

  it("fails closed when a configured occurrence is never reached or a target is unsupported", async () => {
    const secondItem = new AcquisitionSmokeCheckpointController({
      checkpointId: "write:embedded-item-create:after",
      occurrence: 2,
      expectedPoint: "item-after",
    });
    await secondItem.hook(writeCheckpoint("embedded-item-create", "after", 1));
    expect(() => secondItem.assertInitialAttemptComplete()).toThrow("never reached");
    await expect(secondItem.hook(writeCheckpoint("embedded-item-create", "after", 2))).rejects.toBeInstanceOf(
      AcquisitionSmokeCheckpointFailure
    );

    expect(
      () =>
        new AcquisitionSmokeCheckpointController({
          checkpointId: "write:embedded-item-create:before",
          occurrence: 1,
          expectedPoint: "item-before",
        })
    ).toThrow("unsupported");

    const malformed = {
      ...writeCheckpoint("currency-convergence", "before", 1),
      phase: "acquisition-items",
    } as DraftApplyCheckpoint;
    await expect(secondItem.hook(malformed)).rejects.toThrow("malformed Apply write checkpoint");
  });

  it("is inert without a pre-page capability and consumes a nonce only once per browser session", () => {
    delete globals.__wayfinderAcquisitionSmokeBootstrap;
    registerAcquisitionSmokeDriver();
    expect(globals.__wayfinderAcquisitionSmokeDriver).toBeUndefined();

    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const bootstrap = validBootstrap();
    globals.__wayfinderAcquisitionSmokeBootstrap = { ...bootstrap, executorRole: "gm-reviewer" };
    registerAcquisitionSmokeDriver();
    expect(globals.__wayfinderAcquisitionSmokeDriver).toBeUndefined();
    expect(storage.size).toBe(0);

    globals.__wayfinderAcquisitionSmokeBootstrap = bootstrap;
    registerAcquisitionSmokeDriver();
    expect(globals.__wayfinderAcquisitionSmokeDriver).toBeDefined();
    globals.__wayfinderAcquisitionSmokeDriver?.revoke();

    globals.__wayfinderAcquisitionSmokeBootstrap = bootstrap;
    registerAcquisitionSmokeDriver();
    expect(globals.__wayfinderAcquisitionSmokeDriver).toBeUndefined();
    expect(globals.__wayfinderAcquisitionSmokeBootstrap).toBeUndefined();
  });

  it("routes both app Apply paths through the gated hook and keeps UI driving DOM-only", () => {
    const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
    const driver = readFileSync(resolve("src/wayfinder/application/acquisition-smoke-driver.ts"), "utf8");
    const entrypoint = readFileSync(resolve("src/wayfinder.ts"), "utf8");
    const shellTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");

    expect(appShell.match(/onCheckpoint: acquisitionSmokeCheckpointHook/gu)).toHaveLength(2);
    expect(entrypoint).toContain("registerAcquisitionSmokeDriver()");
    expect(driver).toContain("CAPABILITY_TOMBSTONE");
    expect(driver).toContain("acquisitionSmokeApplyFailureHandledFor");
    expect(driver).toContain("acquisitionSmokeApplyFailureRenderedFor");
    expect(appShell).toContain("wayfinderAcquisitionSmokeQuiescent: true");
    expect(appShell).toContain("options.wayfinderAcquisitionSmokeQuiescent");
    expect(driver).toContain('Hooks.on("renderActorSheet"');
    expect(driver).toContain('.tab.inventory[data-tab="inventory"].active');
    expect(driver).toContain("candidate.getClientRects().length > 0");
    expect(shellTemplate.match(/\{\{#if statusNote\}\}/gu)).toHaveLength(2);
    expect(driver).toContain('Hooks.on("renderDialogV2"');
    expect(driver).toContain('.querySelector<HTMLElement>(".wayfinder-launch")');
    expect(driver).toContain('data-wayfinder-action="initialize-starting-equipment"');
    expect(driver).toContain('waitForEnabledAction(application, "review-equipment-purchases")');
    expect(driver).toContain('waitForEnabledAction(application, "retain-all-equipment")');
    expect(driver).not.toContain("WayfinderApp.open(");
    expect(driver).not.toContain("executeStartingEquipmentCommand(");
    expect(driver).not.toContain("DialogV2.confirm =");
  });

  it("previews the settled exact catalogue result before adding from exact item detail", () => {
    const driver = readFileSync(resolve("src/wayfinder/application/acquisition-smoke-driver.ts"), "utf8");
    const searchDispatch = driver.indexOf('search.dispatchEvent(new Event("input"');
    const settledQuery = driver.indexOf('data-wayfinder-rendered-query="Dagger"', searchDispatch);
    const previewAction = driver.indexOf('data-wayfinder-action="preview-equipment-item"', settledQuery);
    const previewDisabled = driver.indexOf("isDisabled(candidate)", previewAction);
    const previewClick = driver.indexOf("clickElement(preview)", previewDisabled);
    const exactDetail = driver.indexOf('data-application-part="equipment-detail"', previewClick);
    const exactDetailSource = driver.indexOf('data-equipment-preview="${DAGGER_SOURCE_UUID}"', exactDetail);
    const addAction = driver.indexOf('data-wayfinder-action="add-equipment-item"', exactDetailSource);
    const currencyFunding = driver.indexOf('data-funding="currency"', addAction);
    const addDisabled = driver.indexOf("isDisabled(candidate)", currencyFunding);
    const addClick = driver.indexOf("clickElement(add)", addDisabled);
    const cartSettlement = driver.indexOf("await waitForCartQuantity(application, 1)", addClick);

    expect(searchDispatch).toBeGreaterThan(-1);
    expect(settledQuery).toBeGreaterThan(searchDispatch);
    expect(previewAction).toBeGreaterThan(settledQuery);
    expect(previewDisabled).toBeGreaterThan(previewAction);
    expect(previewClick).toBeGreaterThan(previewDisabled);
    expect(exactDetail).toBeGreaterThan(previewClick);
    expect(exactDetailSource).toBeGreaterThan(exactDetail);
    expect(addAction).toBeGreaterThan(exactDetailSource);
    expect(currencyFunding).toBeGreaterThan(addAction);
    expect(addDisabled).toBeGreaterThan(currencyFunding);
    expect(addClick).toBeGreaterThan(addDisabled);
    expect(cartSettlement).toBeGreaterThan(addClick);
    expect(driver).toContain('[aria-pressed="true"]');
    expect(driver).not.toContain("result.querySelector<HTMLElement>");
  });
});

function writeCheckpoint(
  operation: "embedded-item-create" | "currency-convergence" | "final-actor-update",
  boundary: "before" | "after",
  ordinal: number
): DraftApplyCheckpoint {
  const phase =
    operation === "embedded-item-create"
      ? "acquisition-items"
      : operation === "currency-convergence"
        ? "acquisition-currency"
        : "finalize-actor";
  return {
    checkpointId: `write:${operation}:${boundary}`,
    kind: "write",
    phase,
    operation,
    boundary,
    ordinal,
  };
}

function validBootstrap() {
  return {
    schemaVersion: 1,
    nonce: "6ce599db-af6d-4e71-9464-f35fc459c92d",
    createdAt: Date.now(),
    moduleId: "wayfinder-pf2e",
    worldId: "smoke-world",
    executorUserId: "player-id",
    executorRole: "non-gm-owner",
    preparedByUserId: "gm-id",
    runId: "run-id",
    bindings: [
      {
        actorId: "actor-id",
        caseId: "equipment-l1-owner-common-purchase",
        definitionFingerprint: `wf-acquisition-case-v2-${"a".repeat(64)}`,
        checkpointTarget: null,
        caseDefinition: {
          id: "equipment-l1-owner-common-purchase",
          caseKind: "acquisition",
          targetLevel: 1,
          definitionFingerprint: `wf-acquisition-case-v2-${"a".repeat(64)}`,
          acquisitionCase: {
            schemaVersion: 2,
            executorRole: "non-gm-owner",
            targetLevel: 1,
            disposition: "purchase-ledger",
            expectedBudgetCopper: 1500,
            expectedSpentCopper: 20,
            expectedRemainingCopper: 1480,
            expectedEntries: [
              {
                sourceUuid: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
                name: "Dagger",
                itemType: "weapon",
                level: 0,
                rarity: "common",
                publication: "Pathfinder Player Core",
                quantity: 1,
                sourceQuantity: 1,
                rulesCount: 0,
                containerId: null,
                stackingIntent: "aggregate",
                unitPriceCopper: 20,
              },
            ],
            nativeGrant: null,
            expectedAcquisitionItemCreateCheckpoints: null,
            policyReview: { required: false, reviewerRole: "gm" },
            failure: null,
          },
        },
      },
    ],
  };
}
