import type { ExistingCharacterHistory, ExistingCharacterHistoryEntry, PendingStep } from "../../types.js";
import { type WayfinderDraftReadiness, type WayfinderStepIssue } from "../domain/step-evaluation.js";
import { modeLabel } from "../plan-service.js";
import type { ActivePane, StepNavRow, SummaryItem } from "../view-models.js";
import type { DraftSaveState } from "./draft-persistence-service.js";

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
  planningNote?: string | null;
  summaryDocuments: WayfinderSummaryDocuments;
  readiness: WayfinderDraftReadiness;
  canImportExistingHistory?: boolean;
  existingCharacterHistory?: ExistingCharacterHistory | null;
  draftSaveState?: DraftSaveState;
  lifecycleBusy?: boolean;
}

export interface WayfinderTemplateContext {
  actorName: string;
  dossierLine: string;
  currentLevel: number;
  targetLevel: number;
  hasPendingSteps: boolean;
  canApplyDraft: boolean;
  readinessReady: boolean;
  applyBlocker: WayfinderStepIssue | null;
  guidance: string;
  summary: SummaryItem[];
  stepCount: number;
  completedCount: number;
  activeStepIndex: number;
  statusNote: string | null;
  planningNote: string | null;
  steps: StepNavRow[];
  activePane: ActivePane | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canImportExistingHistory: boolean;
  existingCharacterHistory: ExistingCharacterHistoryView | null;
  draftSave: DraftSaveView;
  lifecycleBusy: boolean;
}

export interface DraftSaveView {
  phase: DraftSaveState["phase"];
  visible: boolean;
  saving: boolean;
  saved: boolean;
  error: boolean;
  retryable: boolean;
  labelKey: string;
  live: "polite" | "assertive";
}

export interface ExistingCharacterHistoryView {
  actorLevel: number;
  importedAt: string;
  mappedCount: number;
  reviewCount: number;
  levels: Array<{
    level: number;
    entries: Array<ExistingCharacterHistoryEntry & { mapped: boolean; review: boolean }>;
  }>;
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
  const readiness = args.readiness;
  const draftSave = buildDraftSaveView(args.draftSaveState);
  const lifecycleBusy = args.lifecycleBusy ?? false;
  if (readiness.evaluations.length !== args.steps.length) {
    throw new Error("Wayfinder readiness did not evaluate every planned step.");
  }
  const stepRows = readiness.evaluations.map((evaluation, index): StepNavRow => {
    const step = args.steps[index];
    if (!step) {
      throw new Error(`Missing Wayfinder step for readiness evaluation ${index}.`);
    }
    return {
      id: step.id,
      index: index + 1,
      level: step.level,
      title: step.title,
      active: step.id === args.activeStep?.id,
      complete: evaluation.complete,
      invalidated: evaluation.state === "invalid" || evaluation.state === "excess",
      modeLabel: modeLabel(step.kind),
      status: evaluation.status,
      firstInLevel: index === 0 || args.steps[index - 1]?.level !== step.level,
    };
  });

  return {
    actorName: args.actorName,
    dossierLine,
    currentLevel: args.currentLevel,
    targetLevel: args.targetLevel,
    hasPendingSteps: args.steps.length > 0,
    canApplyDraft: readiness.ready && !draftSave.error && !lifecycleBusy,
    readinessReady: readiness.ready,
    applyBlocker: readiness.firstBlocker,
    guidance: "Review one decision at a time, keep the draft coherent, and let earlier choices narrow what comes next.",
    summary,
    stepCount: args.steps.length,
    completedCount: stepRows.filter((step) => step.complete).length,
    activeStepIndex: activeStepIndex + 1,
    statusNote: args.statusNote,
    planningNote: args.planningNote ?? null,
    steps: stepRows,
    activePane: args.activePane,
    canGoPrevious: activeStepIndex > 0,
    canGoNext: activeStepIndex >= 0 && activeStepIndex < args.steps.length - 1,
    canImportExistingHistory: args.canImportExistingHistory ?? false,
    existingCharacterHistory: buildExistingCharacterHistoryView(args.existingCharacterHistory ?? null),
    draftSave,
    lifecycleBusy,
  };
}

export function buildDraftSaveView(state?: DraftSaveState): DraftSaveView {
  const phase = state?.phase ?? "idle";
  return {
    phase,
    visible: phase !== "idle",
    saving: phase === "saving",
    saved: phase === "saved",
    error: phase === "error",
    retryable: state?.retryable ?? false,
    labelKey:
      phase === "saving"
        ? "wayfinder-pf2e.App.DraftSaving"
        : phase === "saved"
          ? "wayfinder-pf2e.App.DraftSavedState"
          : phase === "error"
            ? "wayfinder-pf2e.App.DraftSaveFailed"
            : "",
    live: phase === "error" ? "assertive" : "polite",
  };
}

function buildExistingCharacterHistoryView(
  history: ExistingCharacterHistory | null
): ExistingCharacterHistoryView | null {
  if (!history) {
    return null;
  }

  const levels = Array.from(new Set(history.entries.map((entry) => entry.level)))
    .sort((left, right) => left - right)
    .map((level) => ({
      level,
      entries: history.entries
        .filter((entry) => entry.level === level)
        .map((entry) => ({
          ...entry,
          mapped: entry.status === "mapped",
          review: entry.status === "review",
        })),
    }));

  return {
    actorLevel: history.actorLevel,
    importedAt: history.importedAt,
    mappedCount: history.entries.filter((entry) => entry.status === "mapped").length,
    reviewCount: history.entries.filter((entry) => entry.status === "review").length,
    levels,
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
