import type { DraftState, ProgressionPlan } from "../../types.js";
import type { AcquisitionLineDraft } from "../domain/acquisition-types.js";
import type { StartingEquipmentStep } from "../domain/step-types.js";
import type { StartingEquipmentCatalogueProjection } from "../panes/starting-equipment-pane.js";

export interface StartingEquipmentUiRequest {
  readonly actor: unknown;
  readonly draft: DraftState;
  readonly step: StartingEquipmentStep;
  readonly query: string;
  readonly filters: Readonly<Record<string, readonly string[]>>;
  readonly offset: number;
  readonly limit: number;
  readonly previewSourceUuid: string | null;
}

export interface StartingEquipmentUiAdapter {
  /** Project search/filter state from a cached normalized catalogue; do not reread pack indexes or hydrate documents. */
  project(request: StartingEquipmentUiRequest): Promise<StartingEquipmentCatalogueProjection>;
  prepareLine(
    request: StartingEquipmentUiRequest & {
      readonly sourceUuid: string;
      readonly funding?: { readonly lane: "currency" } | { readonly lane: "allowance"; readonly allowanceId: string };
    }
  ): Promise<AcquisitionLineDraft>;
  prepareTitanMaulerLine(
    request: StartingEquipmentUiRequest & { readonly sourceUuid: string }
  ): Promise<AcquisitionLineDraft>;
}

export async function resolveStartingEquipmentRenderPlan(args: {
  readonly equipmentOnlyUpdate: boolean;
  readonly targetLevel: number;
  readonly cachedPlan: ProgressionPlan | null;
  readonly buildPlan: () => Promise<ProgressionPlan>;
}): Promise<ProgressionPlan> {
  return args.equipmentOnlyUpdate && args.cachedPlan?.targetLevel === args.targetLevel
    ? args.cachedPlan
    : args.buildPlan();
}

const UNAVAILABLE_ADAPTER: StartingEquipmentUiAdapter = {
  async project(request) {
    return {
      state: "pending",
      message: "The gear list is not loaded yet.",
      query: request.query,
      offset: 0,
      limit: request.limit,
      matchedRecordCount: 0,
      records: [],
      filters: [],
      activeFilters: request.filters,
      previewSourceUuid: request.previewSourceUuid,
      titanMauler: { required: false, selectedSourceUuid: null },
    };
  },
  async prepareLine() {
    throw new Error("The approved Common-equipment catalogue is not loaded yet.");
  },
  async prepareTitanMaulerLine() {
    throw new Error("The approved Common-equipment catalogue is not loaded yet.");
  },
};

let registeredAdapter: StartingEquipmentUiAdapter = UNAVAILABLE_ADAPTER;

export function registerStartingEquipmentUiAdapter(adapter: StartingEquipmentUiAdapter): void {
  registeredAdapter = adapter;
}

export function getStartingEquipmentUiAdapter(): StartingEquipmentUiAdapter {
  return registeredAdapter;
}
