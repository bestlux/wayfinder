import { listActorItems } from "../build-state.js";
import { sourceIdOf } from "../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef, SpellChoiceMeta } from "../types.js";

interface BuildSpellChoiceStepsParams {
  draft: DraftState;
  currentLevel: number;
  effectiveClassDocument: any | null;
  effectiveDeityDocument: any | null;
  effectiveSchoolDocument: any | null;
  targetLevel: number;
  extractSlug: (document: any) => string | null;
  readExistingSpellChoiceSelections: (choice: SpellChoiceMeta) => SelectionRef[];
}

const WIZARD_SPELLBOOK_DESTINATION = {
  type: "spellbook",
  key: "wizard-arcane-prepared",
  label: "Wizard spellbook",
  entryName: "Arcane Prepared Spells",
  tradition: "arcane",
  ability: "int",
  prepared: "prepared",
} as const;

const CLERIC_PREPARED_DESTINATION = {
  type: "prepared",
  key: "cleric-divine-prepared",
  label: "Divine prepared spells",
  entryName: "Divine Prepared Spells",
  tradition: "divine",
  ability: "wis",
  prepared: "prepared",
} as const;

export async function buildSpellChoiceSteps(params: BuildSpellChoiceStepsParams): Promise<PendingStep[]> {
  const {
    draft,
    currentLevel,
    effectiveClassDocument,
    effectiveDeityDocument,
    effectiveSchoolDocument,
    targetLevel,
    extractSlug,
    readExistingSpellChoiceSelections,
  } = params;
  if (!effectiveClassDocument) {
    return [];
  }

  const classSlug = extractSlug(effectiveClassDocument);
  if (classSlug === "wizard") {
    return buildWizardSpellChoiceSteps({
      draft,
      currentLevel,
      effectiveClassDocument,
      effectiveSchoolDocument,
      targetLevel,
      extractSlug,
      readExistingSpellChoiceSelections,
      classSlug,
    });
  }

  if (classSlug === "cleric") {
    return buildClericSpellChoiceSteps({
      draft,
      effectiveClassDocument,
      effectiveDeityDocument,
      readExistingSpellChoiceSelections,
      classSlug,
    });
  }

  return [];
}

function buildWizardSpellChoiceSteps(params: {
  draft: DraftState;
  currentLevel: number;
  effectiveClassDocument: any;
  effectiveSchoolDocument: any | null;
  targetLevel: number;
  extractSlug: (document: any) => string | null;
  readExistingSpellChoiceSelections: (choice: SpellChoiceMeta) => SelectionRef[];
  classSlug: string;
}): PendingStep[] {
  const {
    draft,
    currentLevel,
    effectiveClassDocument,
    effectiveSchoolDocument,
    targetLevel,
    extractSlug,
    readExistingSpellChoiceSelections,
    classSlug,
  } = params;
  if (!effectiveClassDocument) {
    return [];
  }

  const wizardSpellcastingSource = findClassFeatureSource(effectiveClassDocument, "Wizard Spellcasting");
  const schoolSource = sourceRefFromDocument(effectiveSchoolDocument);
  const schoolName = effectiveSchoolDocument?.name ?? "Arcane School";
  const schoolSlug = extractSlug(effectiveSchoolDocument);
  const schoolCurriculum = parseCurriculumSpells(effectiveSchoolDocument?.system?.description?.value);
  const isUnifiedTheory = schoolSlug === "school-of-unified-magical-theory";
  const steps: PendingStep[] = [];

  const pushStep = (step: PendingStep): void => {
    const existingSelections = readExistingSpellChoiceSelections(step.spellChoice!);
    const draftedSelections = draft.spellChoices[step.slotId] ?? [];
    if (existingSelections.length >= (step.spellChoice?.count ?? 0) && draftedSelections.length === 0) {
      return;
    }

    steps.push(step);
  };

  pushStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-wizard-spellbook-cantrips-level-1",
      level: 1,
      title: "Wizard spellbook cantrips",
      description: "Add the 10 arcane cantrips that begin your wizard spellbook.",
      source: wizardSpellcastingSource,
      classSlug,
      dependsOn: "class",
      count: 10,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
      destination: WIZARD_SPELLBOOK_DESTINATION,
    })
  );

  pushStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
      level: 1,
      title: "Wizard spellbook spells",
      description: "Add the five 1st-rank arcane spells that begin your spellbook.",
      source: wizardSpellcastingSource,
      classSlug,
      dependsOn: "class",
      count: 5,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
      destination: WIZARD_SPELLBOOK_DESTINATION,
    })
  );

  if (isUnifiedTheory) {
    pushStep(
      makeSpellChoiceStep({
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        level: 1,
        title: "Unified theory bonus spell",
        description: "Add the extra 1st-rank arcane spell granted by the School of Unified Magical Theory.",
        source: schoolSource ?? {
          sourcePackId: null,
          sourceDocumentId: null,
          sourceUuid: null,
          sourceName: schoolName,
        },
        classSlug,
        dependsOn: "class-branch",
        count: 1,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
        destination: WIZARD_SPELLBOOK_DESTINATION,
      })
    );
  } else {
    pushStep(
      makeSpellChoiceStep({
        slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
        level: 1,
        title: "Arcane school curriculum spells",
        description: "Add the two 1st-rank curriculum spells granted by your arcane school.",
        source: schoolSource ?? {
          sourcePackId: null,
          sourceDocumentId: null,
          sourceUuid: null,
          sourceName: schoolName,
        },
        classSlug,
        dependsOn: "class-branch",
        count: 2,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: schoolCurriculum[1] ?? [],
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
        destination: WIZARD_SPELLBOOK_DESTINATION,
      })
    );
  }

  for (let level = Math.max(2, currentLevel + 1); level <= targetLevel; level += 1) {
    const maxRank = wizardMaxSpellRank(level);
    pushStep(
      makeSpellChoiceStep({
        slotId: `spell-choice-wizard-spellbook-level-${level}`,
        level,
        title: `Level ${level} spellbook additions`,
        description: `Add the two arcane spells you learn at level ${level}. They can be any spell rank you can currently cast.`,
        source: wizardSpellcastingSource,
        classSlug,
        dependsOn: "class",
        count: 2,
        minRank: 1,
        maxRank,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
        destination: WIZARD_SPELLBOOK_DESTINATION,
      })
    );

    if (!isUnifiedTheory && level >= 3 && level % 2 === 1) {
      pushStep(
        makeSpellChoiceStep({
          slotId: `spell-choice-wizard-curriculum-rank-${maxRank}-level-${level}`,
          level,
          title: `Level ${level} curriculum spell`,
          description: `Add the extra rank ${maxRank} curriculum spell granted when your arcane school unlocks a new spell rank.`,
          source: schoolSource ?? {
            sourcePackId: null,
            sourceDocumentId: null,
            sourceUuid: null,
            sourceName: schoolName,
          },
          classSlug,
          dependsOn: "class-branch",
          count: 1,
          minRank: maxRank,
          maxRank,
          cantrip: false,
          curriculumSpellNames: schoolCurriculum[maxRank] ?? [],
          additionalAllowedSpellNames: [],
          restrictToCommon: false,
          destination: WIZARD_SPELLBOOK_DESTINATION,
        })
      );
    }
  }

  return steps;
}

function buildClericSpellChoiceSteps(params: {
  draft: DraftState;
  effectiveClassDocument: any;
  effectiveDeityDocument: any | null;
  readExistingSpellChoiceSelections: (choice: SpellChoiceMeta) => SelectionRef[];
  classSlug: string;
}): PendingStep[] {
  const { draft, effectiveClassDocument, effectiveDeityDocument, readExistingSpellChoiceSelections, classSlug } =
    params;
  if (!effectiveClassDocument) {
    return [];
  }

  const clericSpellcastingSource = findClassFeatureSource(effectiveClassDocument, "Cleric Spellcasting");
  const deityRankOneSpellNames = parseDeitySpellNames(effectiveDeityDocument, 1);
  const steps: PendingStep[] = [];
  const pushStep = (step: PendingStep): void => {
    const existingSelections = readExistingSpellChoiceSelections(step.spellChoice!);
    const draftedSelections = draft.spellChoices[step.slotId] ?? [];
    if (existingSelections.length >= (step.spellChoice?.count ?? 0) && draftedSelections.length === 0) {
      return;
    }

    steps.push(step);
  };

  pushStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-cleric-cantrips-level-1",
      level: 1,
      title: "Cleric prepared cantrips",
      description: "Choose the five divine cantrips your cleric begins prepared with.",
      source: clericSpellcastingSource,
      classSlug,
      dependsOn: "class",
      count: 5,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination: CLERIC_PREPARED_DESTINATION,
    })
  );

  pushStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-cleric-rank-1-level-1",
      level: 1,
      title: "Cleric prepared spells",
      description: "Choose the two 1st-rank divine spells your cleric begins prepared with.",
      source: clericSpellcastingSource,
      classSlug,
      dependsOn: "class",
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: deityRankOneSpellNames,
      restrictToCommon: true,
      destination: CLERIC_PREPARED_DESTINATION,
    })
  );

  return steps;
}

export function readExistingSpellChoiceSelections(actor: any, choice: SpellChoiceMeta): SelectionRef[] {
  const entry = findSpellcastingEntryForChoice(actor, choice);
  if (!entry?.id) {
    return [];
  }

  const entryId = String(entry.id);

  const selectedBySlot = listActorItems(actor)
    .filter(
      (item: any) =>
        item?.type === "spell" &&
        item?.flags?.["pf2e-wayfinder"]?.slotId === choice.slotId &&
        spellMatchesChoice(item, choice, entryId)
    )
    .map((item: any) => selectionFromActorItem(item, choice.slotId))
    .filter((selection): selection is SelectionRef => !!selection);
  if (selectedBySlot.length > 0) {
    return dedupeSelections(selectedBySlot).slice(0, choice.count);
  }

  const eligible = listActorItems(actor)
    .filter((item: any) => spellMatchesChoice(item, choice, entryId))
    .map((item: any) => selectionFromActorItem(item, choice.slotId))
    .filter((selection): selection is SelectionRef => !!selection);

  return dedupeSelections(eligible).slice(0, choice.count);
}

export function findSpellcastingEntryForChoice(actor: any, choice: SpellChoiceMeta): any | null {
  return (
    listActorItems(actor).find(
      (item: any) =>
        item?.type === "spellcastingEntry" && item?.flags?.["pf2e-wayfinder"]?.destinationKey === choice.destination.key
    ) ??
    listActorItems(actor).find(
      (item: any) =>
        itemMatchesSpellcastingEntry(item, choice) && String(item?.name ?? "") === choice.destination.entryName
    ) ??
    listActorItems(actor).find((item: any) => itemMatchesSpellcastingEntry(item, choice)) ??
    null
  );
}

export function wizardMaxSpellRank(level: number): number {
  return Math.max(1, Math.min(9, Math.ceil(level / 2)));
}

function makeSpellChoiceStep(args: {
  slotId: string;
  level: number;
  title: string;
  description: string;
  source: {
    sourcePackId: string | null;
    sourceDocumentId: string | null;
    sourceUuid: string | null;
    sourceName: string;
  };
  classSlug: string | null;
  dependsOn: "class" | "class-branch";
  count: number;
  minRank: number;
  maxRank: number;
  cantrip: boolean;
  curriculumSpellNames: string[];
  additionalAllowedSpellNames: string[];
  restrictToCommon: boolean;
  destination: SpellChoiceMeta["destination"];
}): PendingStep {
  return {
    id: args.slotId,
    level: args.level,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: args.title,
    description: args.description,
    required: true,
    slotId: args.slotId,
    filters: {
      itemType: "spell",
    },
    spellChoice: {
      slotId: args.slotId,
      sourcePackId: args.source.sourcePackId,
      sourceDocumentId: args.source.sourceDocumentId,
      sourceUuid: args.source.sourceUuid,
      sourceName: args.source.sourceName,
      classSlug: args.classSlug,
      dependsOn: args.dependsOn,
      destination: { ...args.destination },
      count: args.count,
      minRank: args.minRank,
      maxRank: args.maxRank,
      cantrip: args.cantrip,
      curriculumSpellNames: args.curriculumSpellNames,
      additionalAllowedSpellNames: args.additionalAllowedSpellNames,
      restrictToCommon: args.restrictToCommon,
    },
  };
}

function findClassFeatureSource(
  classDocument: any,
  featureName: string
): { sourcePackId: string | null; sourceDocumentId: string | null; sourceUuid: string | null; sourceName: string } {
  const classItems = Object.values(classDocument?.system?.items ?? {}) as Array<{ name?: string; uuid?: string }>;
  const entry = classItems.find((item) => item?.name === featureName && typeof item?.uuid === "string");
  const parsed = entry?.uuid ? parseCompendiumUuid(entry.uuid) : null;

  return {
    sourcePackId: parsed?.packId ?? null,
    sourceDocumentId: parsed?.documentId ?? null,
    sourceUuid: entry?.uuid ?? null,
    sourceName: featureName,
  };
}

function sourceRefFromDocument(document: any): {
  sourcePackId: string | null;
  sourceDocumentId: string | null;
  sourceUuid: string | null;
  sourceName: string;
} | null {
  if (!document) {
    return null;
  }

  const sourceUuid = sourceIdOf(document);
  const parsed = sourceUuid ? parseCompendiumUuid(sourceUuid) : null;
  return {
    sourcePackId: parsed?.packId ?? null,
    sourceDocumentId: parsed?.documentId ?? null,
    sourceUuid,
    sourceName: String(document.name ?? "Class Feature"),
  };
}

function parseCurriculumSpells(raw: unknown): Record<number, string[]> {
  const description = typeof raw === "string" ? raw : "";
  const matches = description.matchAll(/<li><strong>([^<]+):<\/strong>\s*([\s\S]*?)<\/li>/gi);
  const result: Record<number, string[]> = {};

  for (const [, label, content] of matches) {
    const rank = rankFromCurriculumLabel(label);
    if (rank === null) {
      continue;
    }

    const names = collectCurriculumSpellNames(String(content));

    result[rank] = names;
  }

  return result;
}

function collectCurriculumSpellNames(content: string): string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\](?:\{([^}]+)\})?/gi)) {
    const name = normalizeCurriculumSpellName(match[2] ?? match[1] ?? "");
    if (name) {
      names.add(name);
    }
  }

  for (const match of content.matchAll(
    /<a\b[^>]*data-uuid="Compendium\.pf2e\.spells-srd\.Item\.[^"]+"[^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const name = normalizeCurriculumSpellName(match[1] ?? "");
    if (name) {
      names.add(name);
    }
  }

  return Array.from(names);
}

function rankFromCurriculumLabel(label: string): number | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === "cantrips" || normalized === "cantrip") {
    return 0;
  }

  const map: Record<string, number> = {
    "1st": 1,
    "2nd": 2,
    "3rd": 3,
    "4th": 4,
    "5th": 5,
    "6th": 6,
    "7th": 7,
    "8th": 8,
    "9th": 9,
  };
  return map[normalized] ?? null;
}

function decodeCompendiumName(raw: string): string {
  return decodeURIComponent(raw).replace(/\+/g, " ").trim();
}

function normalizeCurriculumSpellName(raw: string): string {
  const decoded = decodeCompendiumName(raw);
  return decoded
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function itemMatchesSpellcastingEntry(item: any, choice: SpellChoiceMeta): boolean {
  return (
    item?.type === "spellcastingEntry" &&
    String(item?.system?.tradition?.value ?? "")
      .trim()
      .toLowerCase() === choice.destination.tradition &&
    String(item?.system?.prepared?.value ?? "")
      .trim()
      .toLowerCase() === choice.destination.prepared &&
    String(item?.system?.ability?.value ?? "")
      .trim()
      .toLowerCase() === choice.destination.ability
  );
}

function spellMatchesChoice(item: any, choice: SpellChoiceMeta, entryId: string): boolean {
  if (item?.type !== "spell") {
    return false;
  }

  const itemEntryId =
    typeof item?.system?.location?.value === "string"
      ? item.system.location.value
      : typeof item?.system?.location === "string"
        ? item.system.location
        : null;
  if (itemEntryId !== entryId) {
    return false;
  }

  const traditions = Array.isArray(item?.system?.traits?.traditions)
    ? item.system.traits.traditions.map((value: string) => value.trim().toLowerCase())
    : [];
  if (!traditions.includes(choice.destination.tradition)) {
    return false;
  }

  const traits = Array.isArray(item?.system?.traits?.value)
    ? item.system.traits.value.map((value: string) => value.trim().toLowerCase())
    : [];
  const isCantrip = traits.includes("cantrip");
  if (choice.cantrip !== isCantrip) {
    return false;
  }

  const level = Number(item?.system?.level?.value ?? 0);
  const rank = choice.cantrip ? 0 : level;
  if (rank < choice.minRank || rank > choice.maxRank) {
    return false;
  }

  const itemName = String(item?.name ?? "");
  const additionalAllowedSpellNames = choice.additionalAllowedSpellNames ?? [];
  const restrictToCommon = choice.restrictToCommon ?? false;
  if (choice.curriculumSpellNames.length === 0) {
    if (additionalAllowedSpellNames.some((name) => namesMatch(name, itemName))) {
      return true;
    }

    if (!restrictToCommon) {
      return true;
    }

    const rarity = String(item?.system?.traits?.rarity ?? "")
      .trim()
      .toLowerCase();
    return rarity === "" || rarity === "common";
  }

  return choice.curriculumSpellNames.some((name) => namesMatch(name, itemName));
}

function selectionFromActorItem(item: any, slotId: string): SelectionRef | null {
  const sourceUuid = sourceIdOf(item);
  const parsed = sourceUuid ? parseCompendiumUuid(sourceUuid) : null;
  if (!parsed || !sourceUuid) {
    return null;
  }

  return {
    slotId,
    packId: parsed.packId,
    documentId: parsed.documentId,
    uuid: sourceUuid,
    itemType: String(item?.type ?? "spell"),
    featType: null,
    name: String(item?.name ?? "Spell"),
    level: typeof item?.system?.level?.value === "number" ? item.system.level.value : null,
  };
}

function parseCompendiumUuid(uuid: string): { packId: string; documentId: string } | null {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid);
  if (!match) {
    return null;
  }

  return {
    packId: match[1],
    documentId: match[2],
  };
}

function dedupeSelections(selections: SelectionRef[]): SelectionRef[] {
  const seen = new Set<string>();
  const result: SelectionRef[] = [];
  for (const selection of selections) {
    if (seen.has(selection.uuid)) {
      continue;
    }

    seen.add(selection.uuid);
    result.push(selection);
  }

  return result;
}

function parseDeitySpellNames(document: any, rank: number): string[] {
  const value = document?.system?.spells?.[rank];
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  const names = new Set<string>();
  for (const raw of rawValues) {
    const name = spellNameFromDeityReference(raw);
    if (name) {
      names.add(name);
    }
  }

  return Array.from(names);
}

function spellNameFromDeityReference(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  const match = /\.Item\.(.+)$/.exec(raw.trim());
  const name = match?.[1] ?? raw;
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function namesMatch(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
