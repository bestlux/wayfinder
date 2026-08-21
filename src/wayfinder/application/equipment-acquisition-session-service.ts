import type { DraftState } from "../../types.js";
import {
  type AcquisitionExecutionDependencies,
  type AcquisitionExecutionSession,
  createAcquisitionExecutionSession,
} from "./acquisition-execution-service.js";
import type { EquipmentAcquisitionRuntime } from "./equipment-acquisition-runtime-service.js";

export interface EquipmentAcquisitionSessionOptions {
  readonly characterDraft: DraftState;
  readonly runtime: Pick<
    EquipmentAcquisitionRuntime,
    "assertCurrentSourceHealth" | "resolveCurrentPolicySnapshot" | "resolveSourceForApply"
  >;
  readonly readHistory: AcquisitionExecutionDependencies["readHistory"];
  readonly assertApplyAuthority: AcquisitionExecutionDependencies["assertApplyAuthority"];
  readonly readApplyingUser: AcquisitionExecutionDependencies["readApplyingUser"];
  readonly readEnvironment: AcquisitionExecutionDependencies["readEnvironment"];
  readonly now?: AcquisitionExecutionDependencies["now"];
  readonly inventory?: AcquisitionExecutionDependencies["inventory"];
}

export function createEquipmentAcquisitionExecutionDependencies(
  options: EquipmentAcquisitionSessionOptions
): AcquisitionExecutionDependencies {
  if (!options.characterDraft.acquisition) {
    throw new TypeError("Starting-equipment execution requires an acquisition draft.");
  }
  return {
    resolveSource: ({ actor, draft, entry }) =>
      options.runtime.resolveSourceForApply({
        actor,
        characterDraft: options.characterDraft,
        acquisition: draft,
        entry,
      }),
    readHistory: options.readHistory,
    resolveCurrentPolicySnapshot: ({ actor, draft }) => options.runtime.resolveCurrentPolicySnapshot(actor, draft),
    assertSourceHealth: ({ actor, draft }) =>
      options.runtime.assertCurrentSourceHealth({
        actor,
        characterDraft: options.characterDraft,
        acquisition: draft,
      }),
    assertApplyAuthority: options.assertApplyAuthority,
    readApplyingUser: options.readApplyingUser,
    readEnvironment: options.readEnvironment,
    ...(options.now ? { now: options.now } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {}),
  };
}

export function createEquipmentAcquisitionExecutionSession(
  options: EquipmentAcquisitionSessionOptions
): AcquisitionExecutionSession {
  return createAcquisitionExecutionSession(createEquipmentAcquisitionExecutionDependencies(options));
}
