import type { DraftState, PendingStep } from "../../types.js";
import type {
  buildClassBranchSteps,
  buildClassChoiceSteps,
  buildClassGrantedItemSteps,
} from "../class-choice-service.js";
import type { buildSpellChoiceSteps } from "../spell-choice-service.js";

export interface BuildClassContributionDependencies {
  buildClassBranchSteps: typeof buildClassBranchSteps;
  buildClassGrantedItemSteps: typeof buildClassGrantedItemSteps;
  buildClassChoiceSteps: typeof buildClassChoiceSteps;
  buildSpellChoiceSteps: typeof buildSpellChoiceSteps;
}

export interface BuildClassContributionArgs {
  draft: DraftState;
  currentLevel: number;
  targetLevel: number;
  effectiveClassDocument: unknown | null;
  effectiveDeityDocument: unknown | null;
  effectiveSchoolDocument: unknown | null;
  deps: BuildClassContributionDependencies;
}

export interface ClassContributor {
  slug: string;
  buildPlanSteps(args: BuildClassContributionArgs): Promise<PendingStep[]>;
}
