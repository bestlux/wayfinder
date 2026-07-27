import type { PendingStep } from "../../types.js";

export interface ChoiceRuleIdentity {
  key: string;
  sourceUuid: string;
  ruleIndex: number;
  flag: string;
}

interface OwnedChoiceRuleStep {
  identity: ChoiceRuleIdentity;
  priority: number;
  step: PendingStep;
}

/**
 * Registers one owner for each underlying ChoiceSet rule.
 *
 * Discovery lanes are intentionally allowed to overlap: a class-feature rule
 * can be representable as both a generic singleton and a richer class choice.
 * The plan must still ask it once, so ownership is resolved centrally by the
 * source item UUID plus rule index rather than by lane-specific exclusions.
 */
export function dedupeChoiceRuleSteps(steps: PendingStep[]): PendingStep[] {
  const owners = new Map<string, OwnedChoiceRuleStep>();

  for (const step of steps) {
    const candidate = ownedChoiceRuleStep(step);
    if (!candidate) {
      continue;
    }

    const current = owners.get(candidate.identity.key);
    if (!current || candidate.priority > current.priority) {
      owners.set(candidate.identity.key, candidate);
    }
  }

  return steps.filter((step) => {
    const candidate = ownedChoiceRuleStep(step);
    return !candidate || owners.get(candidate.identity.key)?.step === step;
  });
}

export function choiceRuleIdentity(step: PendingStep): ChoiceRuleIdentity | null {
  if (step.kind === "class-branch") {
    return identity(step.branch.selectorUuid, step.branch.selectorRuleIndex, step.branch.flag);
  }

  if (step.kind === "class-choice") {
    return identity(step.classChoice.sourceUuid, step.classChoice.sourceRuleIndex, step.classChoice.flag);
  }

  if (step.kind === "singleton-choice") {
    return identity(step.singletonChoice.sourceUuid, step.singletonChoice.sourceRuleIndex, step.singletonChoice.flag);
  }

  if (step.kind !== "pick-item") {
    return null;
  }

  if (step.grantSelection) {
    return identity(step.grantSelection.selectorUuid, step.grantSelection.selectorRuleIndex, step.grantSelection.flag);
  }

  if (step.flagChoice) {
    return identity(step.flagChoice.sourceUuid, step.flagChoice.sourceRuleIndex, step.flagChoice.flag);
  }

  return null;
}

function ownedChoiceRuleStep(step: PendingStep): OwnedChoiceRuleStep | null {
  const identity = choiceRuleIdentity(step);
  if (!identity) {
    return null;
  }

  return {
    identity,
    priority: choiceRuleOwnerPriority(step),
    step,
  };
}

function choiceRuleOwnerPriority(step: PendingStep): number {
  if (step.kind === "class-branch") {
    return 600;
  }
  if (step.kind === "class-choice") {
    return 500;
  }
  if (step.kind === "pick-item" && step.grantSelection && step.slotKind !== "grant-choice") {
    return 450;
  }
  if (step.kind === "pick-item" && step.grantSelection) {
    return 400;
  }
  if (step.kind === "pick-item" && step.flagChoice) {
    return 300;
  }
  return 200;
}

function identity(sourceUuid: string, ruleIndex: number, flag: string): ChoiceRuleIdentity {
  const normalizedSourceUuid = sourceUuid.trim().toLowerCase();
  return {
    key: `${normalizedSourceUuid}#${ruleIndex}`,
    sourceUuid,
    ruleIndex,
    flag,
  };
}
