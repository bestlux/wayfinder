import type { DraftApplyCheckpoint, DraftApplyCheckpointHook } from "../../actor-updater.js";
import { MODULE_ID } from "../../constants.js";
import type { DraftState } from "../../types.js";

const DRIVER_GLOBAL = "__wayfinderAcquisitionSmokeDriver";
const CAPABILITY_TOMBSTONE = "wayfinder-pf2e:acquisition-smoke-capability-consumed:v1";
const DRIVER_TIMEOUT_MS = 45_000;
const CAPABILITY_MAX_AGE_MS = 15 * 60_000;
const LEVEL_ONE_BUDGET_COPPER = 1_500;
const DAGGER_SOURCE_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
const DAGGER_UNIT_PRICE_COPPER = 20;
const EQUIPMENT_STEP_ID = "starting-equipment-level-1";
const RECOVERY_STATUS =
  "Wayfinder partially applied this draft. Retry Apply without changing choices; details are in the console.";
const LATE_ACKNOWLEDGEMENT_STATUS =
  "The actor reached the reviewed final state, but Foundry reported a late Apply error. Review the actor before closing.";

type AcquisitionDisposition = "purchase-ledger" | "retain-all";
type AcquisitionExecutorRole = "non-gm-owner" | "gm-reviewer";
type SmokeCheckpointTarget = Readonly<{
  checkpointId: string;
  occurrence: number;
  expectedPoint: string;
}>;

interface AcquisitionSmokeBinding {
  readonly actorId: string;
  readonly caseId: string;
  readonly definitionFingerprint: string;
  readonly checkpointTarget: SmokeCheckpointTarget | null;
  readonly caseDefinition: AcquisitionSmokeCaseDefinition;
}

interface AcquisitionSmokeBootstrap {
  readonly schemaVersion: 1;
  readonly nonce: string;
  readonly createdAt: number;
  readonly moduleId: string;
  readonly worldId: string;
  readonly executorUserId: string;
  readonly executorRole: AcquisitionExecutorRole;
  readonly preparedByUserId: string;
  readonly runId: string;
  readonly bindings: readonly AcquisitionSmokeBinding[];
}

interface AcquisitionSmokeMarker {
  readonly schemaVersion: 1;
  readonly purpose: "acquisition-ui-smoke";
  readonly runId: string;
  readonly caseId: string;
  readonly definitionFingerprint: string;
  readonly fixtureName: string;
  readonly executorUserId: string;
  readonly executorRole: AcquisitionExecutorRole;
  readonly preparedByUserId: string;
  readonly worldId: string;
  readonly runtime: {
    readonly foundryVersion: string;
    readonly pf2eVersion: string;
    readonly moduleVersion: string;
  };
}

interface AcquisitionSmokeCaseDefinition {
  readonly id: string;
  readonly caseKind: "acquisition";
  readonly targetLevel: 1;
  readonly definitionFingerprint: string;
  readonly acquisitionCase: {
    readonly schemaVersion: 1;
    readonly executorRole: AcquisitionExecutorRole;
    readonly targetLevel: 1;
    readonly disposition: AcquisitionDisposition;
    readonly expectedBudgetCopper: number;
    readonly expectedSpentCopper: number;
    readonly expectedRemainingCopper: number;
    readonly expectedEntries: readonly Record<string, unknown>[];
    readonly policyReview: { readonly required: boolean; readonly reviewerRole: "gm" };
    readonly failure: SmokeCheckpointTarget | null;
  };
}

interface SmokeActor {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly apps: Record<string, unknown>;
  readonly sheet: {
    readonly element?: unknown;
    render: (force?: boolean) => unknown;
    close?: (options?: Record<string, unknown>) => unknown;
  };
  readonly items?: unknown;
  readonly isOwner?: boolean;
  readonly ownership?: Record<string, unknown>;
  getFlag: (scope: string, key: string) => unknown;
  testUserPermission?: (user: unknown, level: unknown) => boolean;
  canUserModify?: (user: unknown, action: string) => boolean;
}

interface AcquisitionSmokeRunCaseArgs {
  readonly actor: unknown;
  readonly caseDefinition: unknown;
  readonly checkpointTarget: unknown;
  readonly moduleId: string;
  readonly onFailure?: (error: AcquisitionSmokeCheckpointFailure) => void | Promise<void>;
  readonly onRetryCheckpoint?: (checkpoint: DraftApplyCheckpoint) => void | Promise<void>;
}

interface AcquisitionSmokeUiEvidence {
  actorSheetOpened: boolean;
  launchControlClicked: boolean;
  equipmentPaneOpened: boolean;
  dispositionReviewed: boolean;
  applyClicked: boolean;
  completed: boolean;
  retryClicked: boolean;
  failureVisible: boolean;
  partialStateVisible: boolean;
  draftRecoveryVisible: boolean;
  lateAcknowledgementConverged: boolean;
}

interface AcquisitionSmokeDriver {
  runCase: (args: AcquisitionSmokeRunCaseArgs) => Promise<{ readonly ui: AcquisitionSmokeUiEvidence }>;
  revoke: () => void;
}

type AcquisitionSmokeGlobals = typeof globalThis & {
  __wayfinderAcquisitionSmokeBootstrap?: unknown;
  __wayfinderAcquisitionSmokeDriver?: AcquisitionSmokeDriver;
};

interface BoundAcquisitionIdentity {
  readonly draftId: string;
  readonly batchId: string;
  readonly manifestId: string;
}

let activeSession: AcquisitionSmokeSession | null = null;

export class AcquisitionSmokeCheckpointFailure extends Error {
  readonly checkpoint: DraftApplyCheckpoint;

  constructor(checkpoint: DraftApplyCheckpoint) {
    super(`Acquisition smoke fault injected at ${checkpoint.checkpointId}.`);
    this.name = "AcquisitionSmokeCheckpointFailure";
    this.checkpoint = cloneCheckpoint(checkpoint);
  }
}

export class AcquisitionSmokeCheckpointController {
  readonly #target: SmokeCheckpointTarget | null;
  readonly #onRetryCheckpoint: ((checkpoint: DraftApplyCheckpoint) => void | Promise<void>) | undefined;
  #mode: "initial" | "retry" | "finished" = "initial";
  #targetOccurrences = 0;
  #failure: AcquisitionSmokeCheckpointFailure | null = null;

  constructor(
    target: SmokeCheckpointTarget | null,
    onRetryCheckpoint?: (checkpoint: DraftApplyCheckpoint) => void | Promise<void>
  ) {
    this.#target = target ? normalizeCheckpointTarget(target) : null;
    this.#onRetryCheckpoint = onRetryCheckpoint;
  }

  readonly hook: DraftApplyCheckpointHook = async (checkpoint) => {
    if (this.#mode === "finished") {
      throw new Error("The acquisition smoke checkpoint capability has been revoked.");
    }
    assertValidCheckpoint(checkpoint);
    if (this.#mode === "retry") {
      if (checkpoint.kind === "write") {
        await this.#onRetryCheckpoint?.(cloneCheckpoint(checkpoint));
      }
      return;
    }
    if (!this.#target || checkpoint.checkpointId !== this.#target.checkpointId) return;
    this.#targetOccurrences += 1;
    if (this.#targetOccurrences !== this.#target.occurrence) return;
    if (this.#failure) {
      throw new Error("The acquisition smoke failure boundary was reached more than once.");
    }
    this.#failure = new AcquisitionSmokeCheckpointFailure(checkpoint);
    throw this.#failure;
  };

  get failure(): AcquisitionSmokeCheckpointFailure | null {
    return this.#failure;
  }

  assertInitialAttemptComplete(): void {
    if (this.#target && !this.#failure) {
      throw new Error(`The acquisition smoke Apply never reached ${this.#target.checkpointId}.`);
    }
    if (!this.#target && this.#failure) {
      throw new Error("The acquisition smoke Apply injected an unconfigured failure.");
    }
  }

  beginRetry(): void {
    if (!this.#target || !this.#failure || this.#mode !== "initial") {
      throw new Error("The acquisition smoke retry cannot begin without its exact one-shot failure.");
    }
    this.#mode = "retry";
  }

  finish(): void {
    this.#mode = "finished";
  }
}

class AcquisitionSmokeSession {
  readonly actor: SmokeActor;
  readonly caseDefinition: AcquisitionSmokeCaseDefinition;
  readonly binding: AcquisitionSmokeBinding;
  readonly markerFingerprint: string;
  readonly controller: AcquisitionSmokeCheckpointController;
  #boundAcquisition: BoundAcquisitionIdentity | null = null;
  #handledFailure: AcquisitionSmokeCheckpointFailure | null = null;
  #settledFailure: AcquisitionSmokeCheckpointFailure | null = null;

  constructor(args: {
    actor: SmokeActor;
    caseDefinition: AcquisitionSmokeCaseDefinition;
    binding: AcquisitionSmokeBinding;
    marker: AcquisitionSmokeMarker;
    onRetryCheckpoint?: (checkpoint: DraftApplyCheckpoint) => void | Promise<void>;
  }) {
    this.actor = args.actor;
    this.caseDefinition = args.caseDefinition;
    this.binding = args.binding;
    this.markerFingerprint = canonicalJson(args.marker);
    this.controller = new AcquisitionSmokeCheckpointController(args.binding.checkpointTarget, args.onRetryCheckpoint);
  }

  checkpointHook(draft: DraftState): DraftApplyCheckpointHook {
    this.assertLiveIdentity();
    this.#assertBoundAcquisition(draft);
    return async (checkpoint) => {
      this.assertLiveIdentity();
      await this.controller.hook(checkpoint);
    };
  }

  handleFailedApply(draft: DraftState, error: unknown): void {
    this.assertLiveIdentity();
    this.#assertBoundAcquisition(draft);
    const failure = this.controller.failure;
    const candidate = error as {
      readonly name?: unknown;
      readonly failureKind?: unknown;
      readonly checkpoint?: unknown;
      readonly cause?: unknown;
    };
    if (
      !failure ||
      candidate?.name !== "DraftApplyPhaseError" ||
      candidate.failureKind !== "checkpoint-hook" ||
      candidate.cause !== failure ||
      canonicalJson(candidate.checkpoint) !== canonicalJson(failure.checkpoint)
    ) {
      throw new Error("The acquisition smoke Apply settled without its exact injected checkpoint failure.");
    }
    if (this.#handledFailure) {
      throw new Error("The acquisition smoke Apply failure was handled more than once.");
    }
    this.#handledFailure = failure;
  }

  settleFailedApplyRender(): void {
    if (!this.#handledFailure || this.#settledFailure) {
      throw new Error("The acquisition smoke Apply rendered without one exact unsettled failure.");
    }
    this.#settledFailure = this.#handledFailure;
  }

  failureSettled(failure: AcquisitionSmokeCheckpointFailure): boolean {
    return this.#settledFailure === failure;
  }

  #assertBoundAcquisition(draft: DraftState): void {
    const acquisition = assertReviewedAcquisitionDraft(draft, this.caseDefinition);
    const identity = {
      draftId: acquisition.draftId,
      batchId: acquisition.batchId,
      manifestId: acquisition.manifestId,
    };
    if (this.#boundAcquisition && canonicalJson(this.#boundAcquisition) !== canonicalJson(identity)) {
      throw new Error("The acquisition smoke retry changed its draft, batch, or manifest identity.");
    }
    this.#boundAcquisition ??= identity;
  }

  assertLiveIdentity(): void {
    const marker = normalizeMarker(this.actor.getFlag(MODULE_ID, "smokeAcquisitionTracer"));
    if (!marker || canonicalJson(marker) !== this.markerFingerprint) {
      throw new Error("The guarded acquisition smoke actor identity changed while Apply was running.");
    }
    assertCurrentExecutorAndRuntime(this.actor, marker);
  }
}

/** Dormant in ordinary pages; only an exact active smoke session can obtain a hook. */
export function acquisitionSmokeCheckpointHookFor(
  actor: unknown,
  draft: DraftState
): DraftApplyCheckpointHook | undefined {
  if (!activeSession || activeSession.actor !== actor) return undefined;
  return activeSession.checkpointHook(draft);
}

/** Records only the exact active smoke fault after app recovery handling has completed. */
export function acquisitionSmokeApplyFailureHandledFor(actor: unknown, draft: DraftState, error: unknown): void {
  if (!activeSession || activeSession.actor !== actor) return;
  activeSession.handleFailedApply(draft, error);
}

/** Settles the exact handled smoke fault only after the outer post-barrier render completes. */
export function acquisitionSmokeApplyFailureRenderedFor(actor: unknown): void {
  if (!activeSession || activeSession.actor !== actor) return;
  activeSession.settleFailedApplyRender();
}

export function registerAcquisitionSmokeDriver(): void {
  const globals = globalThis as AcquisitionSmokeGlobals;
  const bootstrap = normalizeBootstrap(globals.__wayfinderAcquisitionSmokeBootstrap);
  delete globals.__wayfinderAcquisitionSmokeBootstrap;
  if (!bootstrap || bootstrap.moduleId !== MODULE_ID) return;
  if (Date.now() - bootstrap.createdAt > CAPABILITY_MAX_AGE_MS || bootstrap.createdAt > Date.now() + 5_000) return;
  if (globalThis.sessionStorage.getItem(CAPABILITY_TOMBSTONE) !== null) return;
  globalThis.sessionStorage.setItem(CAPABILITY_TOMBSTONE, bootstrap.nonce);
  if (globals.__wayfinderAcquisitionSmokeDriver) return;

  const remainingBindings = new Map(bootstrap.bindings.map((binding) => [binding.caseId, binding]));
  const driver: AcquisitionSmokeDriver = {
    runCase: (args) => runAcquisitionSmokeCase(bootstrap, remainingBindings, args),
    revoke: () => {
      activeSession?.controller.finish();
      activeSession = null;
      remainingBindings.clear();
      if (globals.__wayfinderAcquisitionSmokeDriver === driver) {
        delete globals.__wayfinderAcquisitionSmokeDriver;
      }
    },
  };
  Object.defineProperty(globals, DRIVER_GLOBAL, {
    configurable: true,
    enumerable: false,
    value: driver,
    writable: false,
  });
}

async function runAcquisitionSmokeCase(
  bootstrap: AcquisitionSmokeBootstrap,
  remainingBindings: Map<string, AcquisitionSmokeBinding>,
  args: AcquisitionSmokeRunCaseArgs
): Promise<{ readonly ui: AcquisitionSmokeUiEvidence }> {
  if (activeSession) throw new Error("Another acquisition smoke UI case is already active.");
  if (args.moduleId !== MODULE_ID || bootstrap.moduleId !== MODULE_ID) {
    throw new Error("The acquisition smoke capability belongs to another module.");
  }
  const actor = normalizeActor(args.actor);
  const caseDefinition = normalizeCaseDefinition(args.caseDefinition);
  const binding = remainingBindings.get(caseDefinition.id);
  if (!binding) throw new Error("The acquisition smoke case is absent or was already consumed.");
  if (
    binding.actorId !== actor.id ||
    binding.definitionFingerprint !== caseDefinition.definitionFingerprint ||
    canonicalJson(binding.caseDefinition) !== canonicalJson(caseDefinition) ||
    canonicalJson(binding.checkpointTarget) !== canonicalJson(normalizeNullableTarget(args.checkpointTarget)) ||
    canonicalJson(binding.checkpointTarget) !== canonicalJson(caseDefinition.acquisitionCase.failure)
  ) {
    throw new Error("The acquisition smoke case does not match its pre-page capability binding.");
  }
  if (binding.checkpointTarget && (!args.onFailure || !args.onRetryCheckpoint)) {
    throw new Error("A forced acquisition smoke case requires failure capture and retry checkpoint callbacks.");
  }
  const marker = normalizeMarker(actor.getFlag(MODULE_ID, "smokeAcquisitionTracer"));
  if (
    !marker ||
    marker.runId !== bootstrap.runId ||
    marker.caseId !== binding.caseId ||
    marker.definitionFingerprint !== binding.definitionFingerprint ||
    marker.executorUserId !== bootstrap.executorUserId ||
    marker.executorRole !== bootstrap.executorRole ||
    marker.preparedByUserId !== bootstrap.preparedByUserId ||
    marker.worldId !== bootstrap.worldId
  ) {
    throw new Error("The acquisition smoke actor does not match its exact GM-prepared marker.");
  }
  if (marker.executorRole !== caseDefinition.acquisitionCase.executorRole) {
    throw new Error("The acquisition smoke actor marker belongs to another executor role.");
  }
  assertCurrentExecutorAndRuntime(actor, marker);
  assertCleanSmokeActor(actor);
  remainingBindings.delete(caseDefinition.id);

  const session = new AcquisitionSmokeSession({
    actor,
    caseDefinition,
    binding,
    marker,
    onRetryCheckpoint: args.onRetryCheckpoint,
  });
  activeSession = session;
  const ui = emptyUiEvidence();
  let wayfinderApplication: Record<string, unknown> | null = null;
  try {
    await openActorSheet(actor);
    ui.actorSheetOpened = true;
    const launch = await waitForValue(
      () => actorSheetRootOf(actor)?.querySelector<HTMLElement>(".wayfinder-launch") ?? null,
      "Wayfinder actor-sheet launch control"
    );
    clickElement(launch);
    ui.launchControlClicked = true;

    wayfinderApplication = await waitForValue(() => wayfinderApplicationFor(actor), "Wayfinder application");
    await openEquipmentPane(wayfinderApplication);
    ui.equipmentPaneOpened = true;
    await initializeEquipment(wayfinderApplication);
    await reviewDisposition(wayfinderApplication, caseDefinition);
    ui.dispositionReviewed = true;

    await clickApplyAndConfirm(wayfinderApplication, actor.name);
    ui.applyClicked = true;
    if (binding.checkpointTarget) {
      const failure = await waitForValue(() => session.controller.failure, "configured acquisition failure");
      session.controller.assertInitialAttemptComplete();
      await waitForValue(() => (session.failureSettled(failure) ? true : null), "settled acquisition failure recovery");
      if (binding.checkpointTarget.expectedPoint === "final-state-after") {
        await waitForValue(() => completedActorState(actor), "durable lost-ack acquisition convergence");
        await waitForValue(
          () => visibleLateAcknowledgementEvidence(actor, wayfinderApplication!),
          "visible lost-ack status and durable acquisition receipt"
        );
        await args.onFailure?.(failure);
        ui.lateAcknowledgementConverged = true;
        ui.completed = true;
        return { ui };
      }
      const recovery = await waitForValue(
        () => visibleRecoveryEvidence(actor, wayfinderApplication!),
        "visible acquisition recovery state"
      );
      ui.failureVisible = recovery.failureVisible;
      ui.draftRecoveryVisible = recovery.draftRecoveryVisible;
      ui.partialStateVisible = await exposePartialItemOnActorSheet(
        actor,
        recovery.batchId,
        Number(caseDefinition.acquisitionCase.expectedEntries[0]?.quantity)
      );
      if (!ui.partialStateVisible) {
        throw new Error("The PF2E inventory did not visibly expose the partially created acquisition item.");
      }
      await args.onFailure?.(failure);
      session.controller.beginRetry();
      await clickApplyAndConfirm(wayfinderApplication, actor.name);
      ui.retryClicked = true;
    }

    await waitForValue(() => completedActorState(actor), "completed acquisition manifest and cleared draft");
    session.controller.assertInitialAttemptComplete();
    await waitForValue(
      () => (wayfinderRoot(wayfinderApplication!)?.isConnected === false ? true : null),
      "closed Wayfinder application"
    );
    ui.completed = true;
    return { ui };
  } finally {
    session.controller.finish();
    if (activeSession === session) activeSession = null;
    await closeApplication(wayfinderApplication);
    await closeActorSheet(actor);
  }
}

async function openActorSheet(actor: SmokeActor): Promise<HTMLElement> {
  await Promise.resolve(actor.sheet.render(true));
  return waitForValue(() => actorSheetRootOf(actor), "connected PF2E actor sheet");
}

async function openEquipmentPane(application: Record<string, unknown>): Promise<void> {
  const step = await waitForValue(
    () =>
      wayfinderRoot(application)?.querySelector<HTMLElement>(
        `[data-wayfinder-action="select-step"][data-step-id="${EQUIPMENT_STEP_ID}"]`
      ) ?? null,
    "starting-equipment step control"
  );
  clickElement(step);
  await waitForValue(
    () => wayfinderRoot(application)?.querySelector<HTMLElement>(".starting-equipment-pane") ?? null,
    "starting-equipment pane"
  );
}

async function initializeEquipment(application: Record<string, unknown>): Promise<void> {
  const setup = await waitForValue(
    () =>
      wayfinderRoot(application)?.querySelector<HTMLElement>(
        `[data-wayfinder-action="initialize-starting-equipment"][data-step-id="${EQUIPMENT_STEP_ID}"]`
      ) ?? null,
    "starting-equipment setup control"
  );
  clickElement(setup);
  await waitForValue(
    () =>
      wayfinderRoot(application)?.querySelector<HTMLInputElement>(
        `input[data-wayfinder-equipment-search][data-step-id="${EQUIPMENT_STEP_ID}"]`
      ) ?? null,
    "initialized starting-equipment catalogue"
  );
}

async function reviewDisposition(
  application: Record<string, unknown>,
  caseDefinition: AcquisitionSmokeCaseDefinition
): Promise<void> {
  const acquisition = caseDefinition.acquisitionCase;
  if (acquisition.disposition === "purchase-ledger") {
    const quantity = Number(acquisition.expectedEntries[0]?.quantity);
    const search = await waitForValue(
      () =>
        wayfinderRoot(application)?.querySelector<HTMLInputElement>(
          `input[data-wayfinder-equipment-search][data-step-id="${EQUIPMENT_STEP_ID}"]`
        ) ?? null,
      "equipment search input"
    );
    search.value = "Dagger";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const result = await waitForValue(
      () =>
        wayfinderRoot(application)?.querySelector<HTMLElement>(
          `[data-equipment-item][data-source-uuid="${DAGGER_SOURCE_UUID}"]`
        ) ?? null,
      "exact PF2E Dagger catalogue result"
    );
    const add = result.querySelector<HTMLElement>(
      `[data-wayfinder-action="add-equipment-item"][data-source-uuid="${DAGGER_SOURCE_UUID}"]`
    );
    if (!add || isDisabled(add)) throw new Error("The exact Dagger result cannot be added through the UI.");
    clickElement(add);
    await waitForCartQuantity(application, 1);
    for (let current = 1; current < quantity; current += 1) {
      const increase = await waitForValue(
        () =>
          daggerCartLine(application)?.querySelector<HTMLElement>(
            '[data-wayfinder-action="change-equipment-quantity"][data-delta="1"]'
          ) ?? null,
        "Dagger quantity control"
      );
      clickElement(increase);
      await waitForCartQuantity(application, current + 1);
    }
    const review = await waitForEnabledAction(application, "review-equipment-purchases");
    clickElement(review);
    await waitForReviewLabel(application, "Purchases reviewed");
  } else {
    if (daggerCartLine(application)) throw new Error("Retain-all acquisition unexpectedly contains a cart item.");
    const retain = await waitForEnabledAction(application, "retain-all-equipment");
    clickElement(retain);
    await waitForReviewLabel(application, "All starting wealth retained");
  }
  await waitForValue(() => {
    const apply = applyButton(application);
    return apply && !apply.disabled && apply.dataset.wayfinderReadinessReady === "true" ? apply : null;
  }, "enabled reviewed Apply control");
}

async function clickApplyAndConfirm(application: Record<string, unknown>, actorName: string): Promise<void> {
  const apply = await waitForValue(() => {
    const candidate = applyButton(application);
    return candidate && !candidate.disabled && candidate.dataset.wayfinderReadinessReady === "true" ? candidate : null;
  }, "enabled Apply control");
  const confirmation = waitForApplyConfirmation(actorName);
  clickElement(apply);
  clickElement(await confirmation);
}

function waitForApplyConfirmation(actorName: string): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const localizedTitle = String(game.i18n.localize("wayfinder-pf2e.App.ApplyConfirmTitle"));
    const localizedYes = String(game.i18n.localize("wayfinder-pf2e.App.ApplyConfirmYes"));
    const hookId = Hooks.on("renderDialogV2", (application: unknown, html: unknown) => {
      const root = rootElement(html) ?? rootElement((application as { element?: unknown } | null)?.element);
      const applicationTitle = String((application as { title?: unknown } | null)?.title ?? "");
      const text = root?.textContent ?? "";
      if (!root || (!applicationTitle.includes(localizedTitle) && !text.includes(actorName))) return;
      const buttons = [...root.querySelectorAll<HTMLElement>("button")];
      const yes =
        root.querySelector<HTMLElement>('button[data-action="yes"]') ??
        buttons.find((button) => button.textContent?.trim() === localizedYes) ??
        null;
      if (!yes) return;
      clearTimeout(timeoutId);
      Hooks.off("renderDialogV2", hookId);
      resolve(yes);
    });
    const timeoutId = globalThis.setTimeout(() => {
      Hooks.off("renderDialogV2", hookId);
      reject(new Error("The real Foundry Apply confirmation dialog did not render."));
    }, DRIVER_TIMEOUT_MS);
  });
}

async function exposePartialItemOnActorSheet(
  actor: SmokeActor,
  batchId: string,
  expectedQuantity: number
): Promise<boolean> {
  const item = actorItems(actor).find((candidate) => {
    const acquisition = recordValue(recordValue(candidate, "flags"), MODULE_ID)?.acquisition;
    return stringValue(acquisition, "batchId") === batchId;
  });
  const itemId = stringValue(item, "id");
  if (!itemId) return false;
  const root = await rerenderActorSheet(actor);
  const inventoryTab = root.querySelector<HTMLElement>('nav.sheet-navigation a[data-tab="inventory"]');
  if (!inventoryTab) return false;
  clickElement(inventoryTab);
  const row = await waitForValue(() => {
    const currentRoot = actorSheetRootOf(actor);
    const inventory = currentRoot?.querySelector<HTMLElement>('.tab.inventory[data-tab="inventory"].active');
    const candidate = inventory?.querySelector<HTMLElement>(`[data-inventory] [data-item-id="${itemId}"]`) ?? null;
    return candidate?.isConnected && candidate.getClientRects().length > 0 ? candidate : null;
  }, "visible partially created PF2E inventory row");
  const name = row.querySelector<HTMLElement>('h4.name a[data-action="toggle-summary"]')?.textContent?.trim();
  const quantity = Number(row.querySelector<HTMLElement>(".quantity > span")?.textContent?.trim());
  return name === "Dagger" && quantity === expectedQuantity;
}

function rerenderActorSheet(actor: SmokeActor): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const hookId = Hooks.on("renderActorSheet", (application: unknown, html: unknown) => {
      const candidate = application as {
        readonly actor?: { readonly id?: unknown };
        readonly document?: { readonly id?: unknown };
      };
      if (candidate?.actor?.id !== actor.id && candidate?.document?.id !== actor.id) return;
      const root = rootElement(html) ?? actorSheetRootOf(actor);
      if (!root?.isConnected) return;
      clearTimeout(timeoutId);
      Hooks.off("renderActorSheet", hookId);
      resolve(root);
    });
    const timeoutId = globalThis.setTimeout(() => {
      Hooks.off("renderActorSheet", hookId);
      reject(new Error("The PF2E actor sheet did not rerender for partial-state review."));
    }, DRIVER_TIMEOUT_MS);
    try {
      actor.sheet.render(true);
    } catch (error) {
      clearTimeout(timeoutId);
      Hooks.off("renderActorSheet", hookId);
      reject(error);
    }
  });
}

function visibleLateAcknowledgementEvidence(actor: SmokeActor, application: Record<string, unknown>): true | null {
  if (!completedActorState(actor)) return null;
  const root = wayfinderRoot(application);
  const status = [...(root?.querySelectorAll<HTMLElement>(".status-note span") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === LATE_ACKNOWLEDGEMENT_STATUS
  );
  const receipt = root?.querySelector<HTMLElement>(
    '.wayfinder-acquisition-receipt[aria-label="Last starting-equipment Apply receipt"]'
  );
  return status && receipt ? true : null;
}

function visibleRecoveryEvidence(
  actor: SmokeActor,
  application: Record<string, unknown>
): { readonly failureVisible: true; readonly draftRecoveryVisible: true; readonly batchId: string } | null {
  const root = wayfinderRoot(application);
  const status = [...(root?.querySelectorAll<HTMLElement>(".status-note span") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === RECOVERY_STATUS
  );
  const draft = normalizeDraftRecord(actor.getFlag(MODULE_ID, "draft"));
  const acquisition = draft ? recordValue(draft, "acquisition") : null;
  const batchId = stringValue(acquisition, "batchId");
  const hasRecovery =
    Array.isArray(draft?.applyAttemptStepIds) &&
    draft.applyAttemptStepIds.includes(EQUIPMENT_STEP_ID) &&
    batchId !== null;
  const apply = applyButton(application);
  if (!status || !hasRecovery || !daggerCartLine(application) || !apply || apply.disabled) return null;
  return { failureVisible: true, draftRecoveryVisible: true, batchId };
}

function completedActorState(actor: SmokeActor): true | null {
  const state = normalizeDraftRecord(actor.getFlag(MODULE_ID, "state"));
  return actor.getFlag(MODULE_ID, "draft") == null && recordValue(state, "completedAcquisitionManifest") ? true : null;
}

function assertReviewedAcquisitionDraft(
  draft: DraftState,
  caseDefinition: AcquisitionSmokeCaseDefinition
): { readonly draftId: string; readonly batchId: string; readonly manifestId: string } {
  if (draft.targetLevel !== 1 || !draft.acquisition) {
    throw new Error("The acquisition smoke hook requires a reviewed level-1 acquisition draft.");
  }
  const acquisition = draft.acquisition;
  if (acquisition.targetLevel !== 1 || acquisition.disposition.kind !== caseDefinition.acquisitionCase.disposition) {
    throw new Error("The acquisition smoke Apply disposition differs from the exact case definition.");
  }
  const review = acquisition.disposition.review;
  if (review.reviewedByUserId !== String(game.user?.id ?? "")) {
    throw new Error("The acquisition smoke Apply was not reviewed by the bound executor.");
  }
  const expected = caseDefinition.acquisitionCase;
  const expectedApplyAuthority = expected.executorRole === "gm-reviewer" ? "gm-review" : "actor-owner";
  if (acquisition.policySnapshot?.material.authorityPolicy.apply !== expectedApplyAuthority) {
    throw new Error("The acquisition smoke Apply did not capture its exact executor authority policy.");
  }
  if (expected.disposition === "retain-all") {
    if (acquisition.lines.length !== 0 || acquisition.disposition.kind !== "retain-all") {
      throw new Error("The retain-all smoke case acquired an item.");
    }
  } else {
    const line = acquisition.lines[0];
    const quantity = Number(expected.expectedEntries[0]?.quantity);
    if (
      acquisition.lines.length !== 1 ||
      !line ||
      line.sourceUuid !== DAGGER_SOURCE_UUID ||
      line.itemLevel !== 0 ||
      line.policyDecision.rarity !== "common" ||
      line.policyDecision.publicationSlug !== "pathfinder-player-core" ||
      line.funding.lane !== "currency" ||
      line.stackingIntent !== "aggregate" ||
      line.price.sourceQuantity !== 1 ||
      line.price.requestedQuantity !== quantity ||
      line.price.materializedQuantity !== quantity ||
      line.price.unitPriceCopper !== DAGGER_UNIT_PRICE_COPPER ||
      line.price.linePriceCopper !== expected.expectedSpentCopper
    ) {
      throw new Error("The reviewed acquisition draft differs from the exact Dagger smoke case.");
    }
  }
  for (const value of [acquisition.draftId, acquisition.batchId, acquisition.manifestId]) {
    if (!nonEmptyString(value)) throw new Error("The acquisition smoke draft is missing durable identity.");
  }
  return {
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    manifestId: acquisition.manifestId,
  };
}

function normalizeBootstrap(value: unknown): AcquisitionSmokeBootstrap | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.bindings)) return null;
  if (
    !randomUuid(value.nonce) ||
    !Number.isSafeInteger(value.createdAt) ||
    !nonEmptyString(value.moduleId) ||
    !nonEmptyString(value.worldId) ||
    !nonEmptyString(value.executorUserId) ||
    (value.executorRole !== "non-gm-owner" && value.executorRole !== "gm-reviewer") ||
    !nonEmptyString(value.preparedByUserId) ||
    !nonEmptyString(value.runId)
  ) {
    return null;
  }
  const bindings = value.bindings.map(normalizeBinding);
  if (bindings.some((binding) => binding === null)) return null;
  const typedBindings = bindings as AcquisitionSmokeBinding[];
  if (
    typedBindings.length === 0 ||
    new Set(typedBindings.map((binding) => binding.caseId)).size !== typedBindings.length ||
    typedBindings.some((binding) => binding.caseDefinition.acquisitionCase.executorRole !== value.executorRole)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    nonce: value.nonce,
    createdAt: Number(value.createdAt),
    moduleId: value.moduleId,
    worldId: value.worldId,
    executorUserId: value.executorUserId,
    executorRole: value.executorRole,
    preparedByUserId: value.preparedByUserId,
    runId: value.runId,
    bindings: typedBindings,
  };
}

function normalizeBinding(value: unknown): AcquisitionSmokeBinding | null {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.actorId) ||
    !nonEmptyString(value.caseId) ||
    !definitionFingerprint(value.definitionFingerprint)
  ) {
    return null;
  }
  let checkpointTarget: SmokeCheckpointTarget | null;
  let caseDefinition: AcquisitionSmokeCaseDefinition;
  try {
    checkpointTarget = normalizeNullableTarget(value.checkpointTarget);
    caseDefinition = normalizeCaseDefinition(value.caseDefinition);
  } catch {
    return null;
  }
  if (
    caseDefinition.id !== value.caseId ||
    caseDefinition.definitionFingerprint !== value.definitionFingerprint ||
    canonicalJson(caseDefinition.acquisitionCase.failure) !== canonicalJson(checkpointTarget)
  ) {
    return null;
  }
  return {
    actorId: value.actorId,
    caseId: value.caseId,
    definitionFingerprint: value.definitionFingerprint,
    checkpointTarget,
    caseDefinition,
  };
}

function normalizeMarker(value: unknown): AcquisitionSmokeMarker | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.purpose !== "acquisition-ui-smoke" ||
    !nonEmptyString(value.runId) ||
    !nonEmptyString(value.caseId) ||
    !definitionFingerprint(value.definitionFingerprint) ||
    !nonEmptyString(value.fixtureName) ||
    !nonEmptyString(value.executorUserId) ||
    (value.executorRole !== "non-gm-owner" && value.executorRole !== "gm-reviewer") ||
    !nonEmptyString(value.preparedByUserId) ||
    !nonEmptyString(value.worldId) ||
    !isRecord(value.runtime) ||
    !nonEmptyString(value.runtime.foundryVersion) ||
    !nonEmptyString(value.runtime.pf2eVersion) ||
    !nonEmptyString(value.runtime.moduleVersion)
  ) {
    return null;
  }
  return value as unknown as AcquisitionSmokeMarker;
}

function normalizeCaseDefinition(value: unknown): AcquisitionSmokeCaseDefinition {
  if (!isRecord(value) || !isRecord(value.acquisitionCase)) {
    throw new Error("The acquisition smoke case definition is malformed.");
  }
  const acquisition = value.acquisitionCase;
  const disposition = acquisition.disposition;
  const entries = acquisition.expectedEntries;
  const expectedSpentCopper = Number(acquisition.expectedSpentCopper);
  const expectedRemainingCopper = Number(acquisition.expectedRemainingCopper);
  if (
    !nonEmptyString(value.id) ||
    value.caseKind !== "acquisition" ||
    value.targetLevel !== 1 ||
    !definitionFingerprint(value.definitionFingerprint) ||
    acquisition.schemaVersion !== 1 ||
    (acquisition.executorRole !== "non-gm-owner" && acquisition.executorRole !== "gm-reviewer") ||
    acquisition.targetLevel !== 1 ||
    (disposition !== "purchase-ledger" && disposition !== "retain-all") ||
    acquisition.expectedBudgetCopper !== LEVEL_ONE_BUDGET_COPPER ||
    !Number.isSafeInteger(expectedSpentCopper) ||
    !Number.isSafeInteger(expectedRemainingCopper) ||
    expectedSpentCopper + expectedRemainingCopper !== LEVEL_ONE_BUDGET_COPPER ||
    !Array.isArray(entries) ||
    !isRecord(acquisition.policyReview) ||
    acquisition.policyReview.reviewerRole !== "gm" ||
    (acquisition.executorRole === "non-gm-owner" && acquisition.policyReview.required !== false) ||
    (acquisition.executorRole === "gm-reviewer" && acquisition.policyReview.required !== true)
  ) {
    throw new Error("The acquisition smoke case is outside the supported level-1 owner boundary.");
  }
  if (disposition === "retain-all") {
    if (entries.length !== 0 || expectedSpentCopper !== 0) {
      throw new Error("The retain-all smoke case has purchase facts.");
    }
  } else {
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      !isRecord(entry) ||
      entry.sourceUuid !== DAGGER_SOURCE_UUID ||
      entry.name !== "Dagger" ||
      entry.itemType !== "weapon" ||
      entry.level !== 0 ||
      entry.rarity !== "common" ||
      entry.publication !== "Pathfinder Player Core" ||
      entry.sourceQuantity !== 1 ||
      entry.rulesCount !== 0 ||
      entry.containerId !== null ||
      entry.stackingIntent !== "aggregate" ||
      entry.unitPriceCopper !== DAGGER_UNIT_PRICE_COPPER ||
      !Number.isSafeInteger(entry.quantity) ||
      Number(entry.quantity) < 1 ||
      expectedSpentCopper !== Number(entry.quantity) * DAGGER_UNIT_PRICE_COPPER
    ) {
      throw new Error("The purchase smoke case is not the exact supported PF2E Dagger candidate.");
    }
  }
  const failure = normalizeNullableTarget(acquisition.failure);
  return {
    id: value.id,
    caseKind: "acquisition",
    targetLevel: 1,
    definitionFingerprint: value.definitionFingerprint,
    acquisitionCase: {
      schemaVersion: 1,
      executorRole: acquisition.executorRole,
      targetLevel: 1,
      disposition,
      expectedBudgetCopper: LEVEL_ONE_BUDGET_COPPER,
      expectedSpentCopper,
      expectedRemainingCopper,
      expectedEntries: entries,
      policyReview: { required: acquisition.policyReview.required === true, reviewerRole: "gm" },
      failure,
    },
  };
}

function normalizeNullableTarget(value: unknown): SmokeCheckpointTarget | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error("The acquisition smoke checkpoint target is malformed.");
  return normalizeCheckpointTarget(value as unknown as SmokeCheckpointTarget);
}

function normalizeCheckpointTarget(value: SmokeCheckpointTarget): SmokeCheckpointTarget {
  const supported = new Map<string, { readonly point: string; readonly phase: string }>([
    ["write:embedded-item-create:after", { point: "item-after", phase: "acquisition-items" }],
    ["write:currency-convergence:before", { point: "currency-before", phase: "acquisition-currency" }],
    ["write:currency-convergence:after", { point: "currency-after", phase: "acquisition-currency" }],
    ["write:final-actor-update:before", { point: "final-state-before", phase: "finalize-actor" }],
    ["write:final-actor-update:after", { point: "final-state-after", phase: "finalize-actor" }],
  ]);
  const supportedTarget = supported.get(value.checkpointId);
  if (
    !supportedTarget ||
    !Number.isSafeInteger(value.occurrence) ||
    value.occurrence < 1 ||
    (value.checkpointId !== "write:embedded-item-create:after" && value.occurrence !== 1) ||
    value.expectedPoint !== supportedTarget.point
  ) {
    throw new Error("The acquisition smoke checkpoint target is unsupported.");
  }
  return {
    checkpointId: value.checkpointId,
    occurrence: value.occurrence,
    expectedPoint: value.expectedPoint,
  };
}

function assertCurrentExecutorAndRuntime(actor: SmokeActor, marker: AcquisitionSmokeMarker): void {
  const user = game.user;
  const runtime = currentRuntime();
  const role = Number(user?.role);
  const executorRoleMatches =
    marker.executorRole === "gm-reviewer"
      ? user?.isGM === true && Number.isInteger(role) && role >= 3
      : user?.isGM === false && Number.isInteger(role) && role < 3;
  if (
    !user ||
    !executorRoleMatches ||
    user.id !== marker.executorUserId ||
    game.world?.id !== marker.worldId ||
    actor.id.length === 0 ||
    actor.name !== marker.fixtureName ||
    actor.type !== "character" ||
    actor.isOwner !== true ||
    actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) !== true ||
    actor.canUserModify?.(user, "update") !== true ||
    canonicalJson(runtime) !== canonicalJson(marker.runtime)
  ) {
    throw new Error("The acquisition smoke capability is unavailable to this actor, user, world, or runtime.");
  }
}

function assertCleanSmokeActor(actor: SmokeActor): void {
  const state = normalizeDraftRecord(actor.getFlag(MODULE_ID, "state"));
  if (
    actor.getFlag(MODULE_ID, "draft") != null ||
    recordValue(state, "completedAcquisitionManifest") != null ||
    actorItems(actor).some((item) => Boolean(recordValue(recordValue(item, "flags"), MODULE_ID)?.acquisition))
  ) {
    throw new Error("The acquisition smoke actor is not a clean GM-prepared fixture.");
  }
}

function currentRuntime(): AcquisitionSmokeMarker["runtime"] {
  return {
    foundryVersion: requiredString(game.version, "Foundry version"),
    pf2eVersion: requiredString(game.system?.id === "pf2e" ? game.system.version : null, "PF2E version"),
    moduleVersion: requiredString(game.modules?.get?.(MODULE_ID)?.version, "Wayfinder version"),
  };
}

function normalizeActor(value: unknown): SmokeActor {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name) || !isRecord(value.apps)) {
    throw new Error("The acquisition smoke driver requires an exact Foundry actor.");
  }
  if (!isRecord(value.sheet) || typeof value.sheet.render !== "function" || typeof value.getFlag !== "function") {
    throw new Error("The acquisition smoke actor lacks its real PF2E sheet or flags.");
  }
  return value as unknown as SmokeActor;
}

function emptyUiEvidence(): AcquisitionSmokeUiEvidence {
  return {
    actorSheetOpened: false,
    launchControlClicked: false,
    equipmentPaneOpened: false,
    dispositionReviewed: false,
    applyClicked: false,
    completed: false,
    retryClicked: false,
    failureVisible: false,
    partialStateVisible: false,
    draftRecoveryVisible: false,
    lateAcknowledgementConverged: false,
  };
}

function actorSheetRootOf(actor: SmokeActor): HTMLElement | null {
  const root = rootElement(actor.sheet.element);
  return root?.isConnected ? root : null;
}

function wayfinderApplicationFor(actor: SmokeActor): Record<string, unknown> | null {
  const application = actor.apps[`${MODULE_ID}-${actor.id}`];
  if (!isRecord(application)) return null;
  return wayfinderRoot(application)?.isConnected ? application : null;
}

function wayfinderRoot(application: Record<string, unknown>): HTMLElement | null {
  return rootElement(application.element);
}

function rootElement(value: unknown): HTMLElement | null {
  if (value instanceof HTMLElement) return value;
  if (isRecord(value) && value[0] instanceof HTMLElement) return value[0];
  return null;
}

function applyButton(application: Record<string, unknown>): HTMLButtonElement | null {
  return wayfinderRoot(application)?.querySelector<HTMLButtonElement>('[data-wayfinder-action="apply-draft"]') ?? null;
}

function daggerCartLine(application: Record<string, unknown>): HTMLElement | null {
  return (
    [...(wayfinderRoot(application)?.querySelectorAll<HTMLElement>(".equipment-cart-line") ?? [])].find(
      (line) => line.querySelector("span strong")?.textContent?.trim() === "Dagger"
    ) ?? null
  );
}

async function waitForCartQuantity(application: Record<string, unknown>, quantity: number): Promise<void> {
  await waitForValue(() => {
    const line = daggerCartLine(application);
    return Number(line?.querySelector<HTMLElement>(".equipment-quantity > strong")?.textContent?.trim()) === quantity
      ? true
      : null;
  }, `Dagger cart quantity ${quantity}`);
}

async function waitForEnabledAction(application: Record<string, unknown>, action: string): Promise<HTMLElement> {
  return waitForValue(() => {
    const candidate = wayfinderRoot(application)?.querySelector<HTMLElement>(`[data-wayfinder-action="${action}"]`);
    return candidate && !isDisabled(candidate) ? candidate : null;
  }, `${action} control`);
}

async function waitForReviewLabel(application: Record<string, unknown>, expected: string): Promise<void> {
  await waitForValue(
    () =>
      [
        ...(wayfinderRoot(application)?.querySelectorAll<HTMLElement>(".equipment-cart footer > span > strong") ?? []),
      ].some((element) => element.textContent?.trim() === expected)
        ? true
        : null,
    `review label ${expected}`
  );
}

function isDisabled(element: HTMLElement): boolean {
  return element instanceof HTMLButtonElement ? element.disabled : element.getAttribute("aria-disabled") === "true";
}

function clickElement(element: HTMLElement): void {
  if (isDisabled(element)) throw new Error("The acquisition smoke driver refused to click a disabled control.");
  element.click();
}

async function waitForValue<T>(read: () => T | null, label: string): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < DRIVER_TIMEOUT_MS) {
    try {
      const value = read();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 25));
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}.${detail}`);
}

async function closeApplication(application: Record<string, unknown> | null): Promise<void> {
  if (application && typeof application.close === "function") {
    await Promise.resolve(application.close({ animate: false })).catch(() => undefined);
  }
}

async function closeActorSheet(actor: SmokeActor): Promise<void> {
  if (typeof actor.sheet.close === "function") {
    await Promise.resolve(actor.sheet.close({ animate: false })).catch(() => undefined);
  }
}

function actorItems(actor: SmokeActor): Record<string, unknown>[] {
  const items = actor.items;
  if (Array.isArray(items)) return items.filter(isRecord);
  if (!isRecord(items)) return [];
  if (Array.isArray(items.contents)) return items.contents.filter(isRecord);
  if (typeof items.values === "function") {
    return [...(items.values as () => Iterable<unknown>)()].filter(isRecord);
  }
  return [];
}

function normalizeDraftRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function recordValue(value: unknown, key: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function stringValue(value: unknown, key: string): string | null {
  return isRecord(value) && nonEmptyString(value[key]) ? value[key] : null;
}

function assertValidCheckpoint(checkpoint: DraftApplyCheckpoint): void {
  if (checkpoint.kind === "phase") {
    if (
      !nonEmptyString(checkpoint.phase) ||
      (checkpoint.boundary !== "before" && checkpoint.boundary !== "after") ||
      checkpoint.checkpointId !== `phase:${checkpoint.phase}:${checkpoint.boundary}`
    ) {
      throw new Error("The acquisition smoke driver observed a malformed Apply phase checkpoint.");
    }
    return;
  }
  const phaseByOperation = {
    "embedded-item-create": "acquisition-items",
    "currency-convergence": "acquisition-currency",
    "final-actor-update": "finalize-actor",
  } as const;
  const expectedPhase = phaseByOperation[checkpoint.operation];
  if (
    checkpoint.phase !== expectedPhase ||
    (checkpoint.boundary !== "before" && checkpoint.boundary !== "after") ||
    checkpoint.checkpointId !== `write:${checkpoint.operation}:${checkpoint.boundary}` ||
    !Number.isSafeInteger(checkpoint.ordinal) ||
    checkpoint.ordinal < 1 ||
    (checkpoint.operation !== "embedded-item-create" && checkpoint.ordinal !== 1)
  ) {
    throw new Error("The acquisition smoke driver observed a malformed Apply write checkpoint.");
  }
}

function cloneCheckpoint(checkpoint: DraftApplyCheckpoint): DraftApplyCheckpoint {
  return Object.freeze({ ...checkpoint }) as DraftApplyCheckpoint;
}

function requiredString(value: unknown, label: string): string {
  if (!nonEmptyString(value)) throw new Error(`Acquisition smoke requires the current ${label}.`);
  return value.trim();
}

function definitionFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^wf-acquisition-case-v1-[a-f0-9]{64}$/u.test(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function randomUuid(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Smoke identity cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Smoke identity contains unsupported data.");
}
