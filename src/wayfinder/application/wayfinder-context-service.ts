import type { PendingStep } from "../../types.js";
import { modeLabel } from "../plan-service.js";
import type { ActivePane, StepNavRow, SummaryItem } from "../view-models.js";

interface NamedDocument {
  name: string;
}

export interface WayfinderSummaryDocuments {
  ancestry: NamedDocument | null;
  heritage: NamedDocument | null;
  background: NamedDocument | null;
  classDocument: NamedDocument | null;
  deity: NamedDocument | null;
}

export interface BuildWayfinderContextArgs {
  actorName: string;
  currentLevel: number;
  targetLevel: number;
  steps: PendingStep[];
  activeStep: PendingStep | null;
  activePane: ActivePane | null;
  statusNote: string | null;
  recentlyInvalidatedStepIds: Set<string>;
  summaryDocuments: WayfinderSummaryDocuments;
  isStepComplete: (step: PendingStep) => Promise<boolean>;
  getStepStatus: (step: PendingStep) => Promise<string>;
}

export interface WayfinderTemplateContext {
  actorName: string;
  dossierLine: string;
  currentLevel: number;
  targetLevel: number;
  hasPendingSteps: boolean;
  canApplyDraft: boolean;
  guidance: string;
  summary: SummaryItem[];
  stepCount: number;
  completedCount: number;
  activeStepIndex: number;
  statusNote: string | null;
  steps: StepNavRow[];
  activePane: ActivePane | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
}

export async function buildWayfinderContext(args: BuildWayfinderContextArgs): Promise<WayfinderTemplateContext> {
  const summary = buildSummaryItems(args.summaryDocuments);
  const dossierLine =
    summary
      .filter((item) => item.complete)
      .map((item) => item.value)
      .filter(Boolean)
      .join(" • ") || "Creation path in progress";
  const activeStepIndex = args.activeStep ? args.steps.findIndex((step) => step.id === args.activeStep?.id) : -1;
  const stepRows = await Promise.all(
    args.steps.map(async (step, index): Promise<StepNavRow> => {
      const complete = await args.isStepComplete(step);
      return {
        id: step.id,
        index: index + 1,
        level: step.level,
        title: step.title,
        active: step.id === args.activeStep?.id,
        complete,
        invalidated: args.recentlyInvalidatedStepIds.has(step.slotId) && !complete,
        modeLabel: modeLabel(step.kind),
        status: await args.getStepStatus(step),
        firstInLevel: index === 0 || args.steps[index - 1]?.level !== step.level,
      };
    })
  );

  return {
    actorName: args.actorName,
    dossierLine,
    currentLevel: args.currentLevel,
    targetLevel: args.targetLevel,
    hasPendingSteps: args.steps.length > 0,
    canApplyDraft: args.steps.length > 0,
    guidance: "Review one decision at a time, keep the draft coherent, and let earlier choices narrow what comes next.",
    summary,
    stepCount: args.steps.length,
    completedCount: stepRows.filter((step) => step.complete).length,
    activeStepIndex: activeStepIndex + 1,
    statusNote: args.statusNote,
    steps: stepRows,
    activePane: args.activePane,
    canGoPrevious: activeStepIndex > 0,
    canGoNext: activeStepIndex >= 0 && activeStepIndex < args.steps.length - 1,
  };
}

function buildSummaryItems(documents: WayfinderSummaryDocuments): SummaryItem[] {
  const summary: SummaryItem[] = [
    {
      label: "Ancestry",
      value: documents.ancestry?.name ?? "Missing",
      complete: !!documents.ancestry,
    },
    {
      label: "Heritage",
      value: documents.heritage?.name ?? "Missing",
      complete: !!documents.heritage,
    },
    {
      label: "Background",
      value: documents.background?.name ?? "Missing",
      complete: !!documents.background,
    },
    {
      label: "Class",
      value: documents.classDocument?.name ?? "Missing",
      complete: !!documents.classDocument,
    },
  ];

  if (documents.classDocument?.name === "Cleric" || documents.deity) {
    summary.push({
      label: "Deity",
      value: documents.deity?.name ?? "Missing",
      complete: !!documents.deity,
    });
  }

  return summary;
}
