import type { ActorSnapshot, PendingStep, ProgressionPlan } from "./types.js";

const ANCESTRY_FEAT_LEVELS = [1, 5, 9, 13, 17];
const CLASS_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const SKILL_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const GENERAL_FEAT_LEVELS = [3, 7, 11, 15, 19];
const SKILL_INCREASE_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19];
const ABILITY_BOOST_LEVELS = [5, 10, 15, 20];

export function buildProgressionPlan(snapshot: ActorSnapshot, requestedTargetLevel?: number): ProgressionPlan {
  const currentLevel = clampLevel(snapshot.level);
  const currentSteps = buildSteps(snapshot, currentLevel, currentLevel);
  const recommendedTargetLevel = currentSteps.length > 0 || snapshot.isBlank
    ? currentLevel
    : Math.min(currentLevel + 1, 20);
  const targetLevel = clampLevel(requestedTargetLevel ?? recommendedTargetLevel);

  return {
    recommendedTargetLevel,
    targetLevel,
    steps: buildSteps(snapshot, currentLevel, targetLevel)
  };
}

export function buildSteps(snapshot: ActorSnapshot, currentLevel: number, targetLevel: number): PendingStep[] {
  const steps: PendingStep[] = [];

  if (!snapshot.singletonSlots.ancestry) {
    steps.push(makePickStep("ancestry", 1, "Choose an ancestry", "Select the ancestry item that anchors this character's build.", {
      itemType: "ancestry"
    }));
  }

  if (!snapshot.singletonSlots.heritage) {
    steps.push(makePickStep("heritage", 1, "Choose a heritage", "Select a heritage after ancestry so PF2E can layer the heritage item onto the actor.", {
      itemType: "heritage"
    }));
  }

  if (!snapshot.singletonSlots.background) {
    steps.push(makePickStep("background", 1, "Choose a background", "Select the background that supplies early trained skills and boosts.", {
      itemType: "background"
    }));
  }

  if (!snapshot.singletonSlots.class) {
    steps.push(makePickStep("class", 1, "Choose a class", "Select the class item that defines class progression and downstream PF2E automation.", {
      itemType: "class"
    }));
  }

  steps.push(...buildFeatSteps("ancestry-feat", "Level {level} ancestry feat", "Pick the ancestry feat unlocked at this milestone.", ANCESTRY_FEAT_LEVELS, snapshot.featCounts.ancestry, targetLevel, {
    itemType: "feat",
    featTypes: ["ancestry"]
  }));

  steps.push(...buildFeatSteps("class-feat", "Level {level} class feat", "Pick a class or archetype feat unlocked at this milestone.", CLASS_FEAT_LEVELS, snapshot.featCounts.class + snapshot.featCounts.archetype, targetLevel, {
    itemType: "feat",
    featTypes: ["class", "archetype"]
  }));

  steps.push(...buildFeatSteps("skill-feat", "Level {level} skill feat", "Pick the skill feat unlocked at this milestone.", SKILL_FEAT_LEVELS, snapshot.featCounts.skill, targetLevel, {
    itemType: "feat",
    featTypes: ["skill"]
  }));

  steps.push(...buildFeatSteps("general-feat", "Level {level} general feat", "Pick the general feat unlocked at this milestone.", GENERAL_FEAT_LEVELS, snapshot.featCounts.general, targetLevel, {
    itemType: "feat",
    featTypes: ["general"]
  }));

  if (snapshot.isBlank || !allCreationAnchorsPresent(snapshot)) {
    steps.push(makeBoostStep("ability-boosts", 1, "Assign creation boosts", "Allocate ancestry, background, class, and free level 1 boosts inside Wayfinder before finalizing the draft."));
  }

  for (const level of ABILITY_BOOST_LEVELS) {
    if (level > currentLevel && level <= targetLevel) {
      steps.push(makeBoostStep("ability-boosts", level, `Level ${level} ability boosts`, "Allocate this level's four free boosts directly in Wayfinder and keep the draft coherent before applying."));
    }
  }

  for (const level of SKILL_INCREASE_LEVELS) {
    if (level > currentLevel && level <= targetLevel) {
      steps.push(makeManualStep("skill-increase", level, `Level ${level} skill increase`, "Apply this level's skill increase using PF2E's native actor controls, then mark the checkpoint complete."));
    }
  }

  return steps.sort((left, right) => {
    const levelDelta = left.level - right.level;
    if (levelDelta !== 0) {
      return levelDelta;
    }

    const kindDelta = sortWeight(left.slotKind) - sortWeight(right.slotKind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

export function parseCompendiumAllowlist(raw: unknown): string[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function mergePackIds(basePackIds: string[], extraPackIds: string[]): string[] {
  return Array.from(new Set([...basePackIds, ...extraPackIds]));
}

function buildFeatSteps(
  slotKind: "ancestry-feat" | "class-feat" | "skill-feat" | "general-feat",
  titleTemplate: string,
  description: string,
  slotLevels: number[],
  fulfilledCount: number,
  targetLevel: number,
  filters: { itemType: string; featTypes: string[] }
): PendingStep[] {
  const steps: PendingStep[] = [];
  const milestones = slotLevels.filter((value) => value <= targetLevel);
  const startIndex = Math.min(Math.max(0, fulfilledCount), milestones.length);

  for (const level of milestones.slice(startIndex)) {
    steps.push(makePickStep(slotKind, level, titleTemplate.replace("{level}", String(level)), description, {
      itemType: filters.itemType,
      featTypes: filters.featTypes,
      maxLevel: level
    }));
  }

  return steps;
}

function makePickStep(slotKind: PendingStep["slotKind"], level: number, title: string, description: string, filters: PendingStep["filters"]): PendingStep {
  const slotId = `${slotKind}-level-${level}`;
  return {
    id: slotId,
    level,
    kind: "pick-item",
    slotKind,
    title,
    description,
    required: true,
    slotId,
    filters
  };
}

function makeManualStep(slotKind: PendingStep["slotKind"], level: number, title: string, description: string): PendingStep {
  const slotId = `${slotKind}-level-${level}`;
  return {
    id: slotId,
    level,
    kind: "manual",
    slotKind,
    title,
    description,
    required: true,
    slotId
  };
}

function makeBoostStep(slotKind: PendingStep["slotKind"], level: number, title: string, description: string): PendingStep {
  const slotId = `${slotKind}-level-${level}`;
  return {
    id: slotId,
    level,
    kind: "boost",
    slotKind,
    title,
    description,
    required: true,
    slotId
  };
}

function allCreationAnchorsPresent(snapshot: ActorSnapshot): boolean {
  return snapshot.singletonSlots.ancestry
    && snapshot.singletonSlots.heritage
    && snapshot.singletonSlots.background
    && snapshot.singletonSlots.class;
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }

  return Math.max(1, Math.min(20, Math.floor(level)));
}

function sortWeight(kind: PendingStep["slotKind"]): number {
  switch (kind) {
    case "ancestry":
      return 0;
    case "heritage":
      return 1;
    case "background":
      return 2;
    case "class":
      return 3;
    case "ancestry-feat":
      return 4;
    case "class-feat":
      return 5;
    case "skill-feat":
      return 6;
    case "general-feat":
      return 7;
    case "ability-boosts":
      return 8;
    case "skill-increase":
      return 9;
    default:
      return 99;
  }
}
