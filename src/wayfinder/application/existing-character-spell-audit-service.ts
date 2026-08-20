import { spellLocationId } from "../../actor-updater/spellcasting-entry-support.js";
import { listActorItems } from "../../build-state.js";
import { createEmptyDraft } from "../../draft-service.js";
import type { ActorItemLike as SharedActorItemLike } from "../../shared/actor-model.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { findSpellcastingEntriesForChoiceInItems, wizardMaxSpellRank } from "../../shared/spellcasting.js";
import type { ExistingCharacterHistoryEntry, PendingStep, SpellChoiceMeta } from "../../types.js";
import { parseSorcerousGiftSpellAccess, parseWitchPatronLessonSpellAccess } from "../spell-choice/metadata-parsing.js";
import {
  findClassFeatureDocumentByOtherTag,
  parseTraditionFromClassFeatureDocument,
} from "../spell-choice/tradition-utils.js";
import type { SpellChoiceSchoolDocument } from "../spell-choice/types.js";
import { buildSpellChoiceSteps } from "../spell-choice-service.js";

const AUDITED_CLASS_SLUGS = new Set(["bard", "magus", "oracle", "sorcerer", "witch", "wizard"]);

const CLASS_BOUNDARIES: Readonly<Record<string, string>> = {
  animist:
    "Wayfinder cannot confidently audit animist spell totals because apparition spells are not fully represented by its spell-choice builder.",
  cleric:
    "Wayfinder does not audit cleric daily preparation slots, and clerics do not have a finite spellbook or repertoire total to compare.",
  druid:
    "Wayfinder does not audit druid daily preparation slots, and druids do not have a finite spellbook or repertoire total to compare.",
  psychic:
    "Wayfinder cannot confidently audit psychic spell totals because psi cantrips and conscious-mind grants are not fully represented by its spell-choice builder.",
  summoner:
    "Wayfinder cannot confidently audit summoner spell totals because bounded repertoire replacement is not fully represented by its spell-choice builder.",
};

type ActorItemLike = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  flags?: {
    pf2e?: {
      grantedBy?: unknown;
    };
  } & Record<string, unknown>;
  system?: {
    category?: unknown;
    featType?: { value?: unknown };
  } & Record<string, unknown>;
};

interface SpellAuditResolution {
  effectiveSchoolDocument: SpellChoiceSchoolDocument | null;
  boundary: string | null;
}

export async function buildExistingCharacterSpellAuditEntries(
  actor: unknown,
  actorLevel: number
): Promise<ExistingCharacterHistoryEntry[]> {
  const items = listActorItems(actor) as ActorItemLike[];
  const classDocument = items.find((item) => item.type === "class") ?? null;
  const classSlug = extractDocumentSlug(classDocument);
  if (!classSlug) {
    return [];
  }

  const classBoundary = CLASS_BOUNDARIES[classSlug];
  if (classBoundary) {
    return [boundaryEntry(classSlug, className(classDocument, classSlug), actorLevel, classBoundary)];
  }
  if (!AUDITED_CLASS_SLUGS.has(classSlug)) {
    return Number(classDocument?.system?.spellcasting) > 0
      ? [
          boundaryEntry(
            classSlug,
            className(classDocument, classSlug),
            actorLevel,
            "Wayfinder's current spell-choice builders do not model this caster profile confidently enough for a numeric audit."
          ),
        ]
      : [];
  }
  if (classSlug === "magus" && actorLevel >= 7) {
    return [
      boundaryEntry(
        classSlug,
        className(classDocument, classSlug),
        actorLevel,
        "Wayfinder does not yet model the fixed and hybrid-study spells added by Magus Studious Spells at levels 7, 11, and 13."
      ),
    ];
  }

  const classFeatures = items.filter(isClassFeatureDocument) as SpellChoiceSchoolDocument[];
  const resolution = resolveRequiredClassChoices(classSlug, classFeatures, actorLevel);
  if (resolution.boundary) {
    return [boundaryEntry(classSlug, className(classDocument, classSlug), actorLevel, resolution.boundary)];
  }

  const steps = await buildSpellChoiceSteps({
    draft: createEmptyDraft(actorLevel),
    currentLevel: 0,
    effectiveClassDocument: classDocument,
    effectiveDeityDocument: items.find((item) => item.type === "deity") ?? null,
    effectiveSchoolDocument: resolution.effectiveSchoolDocument,
    effectiveClassFeatureDocuments: classFeatures,
    targetLevel: actorLevel,
    extractSlug: extractDocumentSlug,
    readExistingSpellChoiceSelections: () => [],
  });
  const countableSteps = steps.filter(isCountableSpellChoiceStep);
  if (countableSteps.length === 0) {
    return [
      boundaryEntry(
        classSlug,
        className(classDocument, classSlug),
        actorLevel,
        "Wayfinder's current spell-choice builder does not expose a finite spellbook or repertoire total for this class."
      ),
    ];
  }

  const comparison = compareObservedSpells(actor, countableSteps);
  if (comparison.boundary) {
    return [boundaryEntry(classSlug, className(classDocument, classSlug), actorLevel, comparison.boundary)];
  }
  return [
    comparisonEntry(
      classSlug,
      className(classDocument, classSlug),
      actorLevel,
      comparison.observed,
      comparison.expected,
      comparison.deficit,
      comparison.extra
    ),
  ];
}

function resolveRequiredClassChoices(
  classSlug: string,
  classFeatures: SpellChoiceSchoolDocument[],
  actorLevel: number
): SpellAuditResolution {
  if (classSlug === "witch") {
    const patron = findClassFeatureDocumentByOtherTag(classFeatures, "witch-patron");
    if (!patron) {
      return unresolved("Wayfinder cannot resolve the witch spell total because no patron is selected on the actor.");
    }
    if (!strictTraditionFromClassFeature(patron)) {
      return unresolved(
        "Wayfinder cannot resolve the witch spell total because the selected patron's tradition is unavailable."
      );
    }
    if (parseWitchPatronLessonSpellAccess(patron).uuids.length === 0) {
      return unresolved(
        "Wayfinder cannot resolve the witch spell total because the selected patron's initial-lesson spell is unavailable."
      );
    }
  }

  if (classSlug === "wizard") {
    const school = findClassFeatureDocumentByOtherTag(classFeatures, "wizard-arcane-school");
    return school
      ? { effectiveSchoolDocument: school, boundary: null }
      : unresolved(
          "Wayfinder cannot resolve the wizard spellbook total because no arcane school is selected on the actor."
        );
  }

  if (classSlug === "sorcerer") {
    const branch = findClassFeatureDocumentByOtherTag(classFeatures, "sorcerer-bloodline");
    if (!branch) {
      return unresolved(
        "Wayfinder cannot resolve the sorcerer repertoire total because no bloodline is selected on the actor."
      );
    }
    if (!strictTraditionFromClassFeature(branch)) {
      return unresolved(
        "Wayfinder cannot resolve the sorcerer repertoire total because the selected bloodline's tradition is unavailable."
      );
    }
    const gifts = parseSorcerousGiftSpellAccess(branch);
    const requiredGiftRanks = [
      0,
      ...Array.from({ length: Math.min(9, wizardMaxSpellRank(actorLevel)) }, (_, index) => index + 1),
    ];
    const missingGiftRanks = requiredGiftRanks.filter((rank) => !gifts[rank]);
    if (missingGiftRanks.length > 0) {
      return unresolved(
        `Wayfinder cannot resolve the sorcerer repertoire total because the selected bloodline is missing sorcerous gift data for ${missingGiftRanks
          .map((rank) => (rank === 0 ? "its cantrip" : `rank ${rank}`))
          .join(", ")}.`
      );
    }
  }

  return { effectiveSchoolDocument: null, boundary: null };
}

function strictTraditionFromClassFeature(document: SpellChoiceSchoolDocument): string | null {
  const withArcaneFallback = parseTraditionFromClassFeatureDocument(document, "arcane");
  const withDivineFallback = parseTraditionFromClassFeatureDocument(document, "divine");
  return withArcaneFallback === withDivineFallback ? withArcaneFallback : null;
}

function unresolved(boundary: string): SpellAuditResolution {
  return { effectiveSchoolDocument: null, boundary };
}

function isClassFeatureDocument(item: ActorItemLike): boolean {
  return item.type === "feat" && (item.system?.featType?.value ?? item.system?.category) === "classfeature";
}

function isCountableSpellChoiceStep(step: PendingStep): boolean {
  return (
    step.kind === "spell-choice" &&
    (step.spellChoice?.destination.type === "spellbook" || step.spellChoice?.destination.type === "spontaneous")
  );
}

interface SpellAuditComparison {
  observed: number;
  expected: number;
  deficit: number;
  extra: number;
  boundary: string | null;
}

interface ExpectedSpellSlot {
  choice: SpellChoiceMeta;
  entryId: string;
}

function compareObservedSpells(actor: unknown, steps: PendingStep[]): SpellAuditComparison {
  const actorItems = listActorItems(actor) as ActorItemLike[];
  const entryIds = new Set<string>();
  const choicesByDestination = new Map<string, SpellChoiceMeta>();
  for (const step of steps) {
    const choice = step.spellChoice;
    if (choice && !choicesByDestination.has(choice.destination.key)) {
      choicesByDestination.set(choice.destination.key, choice);
    }
  }

  for (const choice of choicesByDestination.values()) {
    const entries = findSpellcastingEntriesForChoiceInItems(actorItems, choice);
    if (entries.length !== 1 || typeof entries[0]?.id !== "string" || entries[0].id.length === 0) {
      return {
        observed: 0,
        expected: 0,
        deficit: 0,
        extra: 0,
        boundary:
          entries.length > 1
            ? `Wayfinder found multiple plausible destinations for ${choice.destination.label} and will not guess which one to audit.`
            : `Wayfinder cannot identify the spellcasting entry for ${choice.destination.label}.`,
      };
    }
    entryIds.add(entries[0].id);
  }

  const observedSpells = actorItems.filter(
    (item) => item.type === "spell" && entryIds.has(spellLocationId(item as unknown as SharedActorItemLike) ?? "")
  );
  const expectedSlots = steps.flatMap((step): ExpectedSpellSlot[] => {
    const choice = step.spellChoice;
    if (!choice) {
      return [];
    }
    const entryId = Array.from(entryIds).find((candidate) =>
      findSpellcastingEntriesForChoiceInItems(actorItems, choice).some((entry) => entry.id === candidate)
    );
    return entryId ? Array.from({ length: choice.count }, () => ({ choice, entryId })) : [];
  });
  const matchedSpellByExpectedSlot = new Map<number, number>();

  const assignExpectedSlot = (expectedIndex: number, visitedSpells: Set<number>): boolean => {
    const expectedSlot = expectedSlots[expectedIndex];
    if (!expectedSlot) {
      return false;
    }
    for (let observedIndex = 0; observedIndex < observedSpells.length; observedIndex += 1) {
      if (visitedSpells.has(observedIndex)) {
        continue;
      }
      const observedSpell = observedSpells[observedIndex];
      if (!observedSpell || !spellMatchesAuditSlot(observedSpell, expectedSlot)) {
        continue;
      }
      visitedSpells.add(observedIndex);
      const previousExpectedIndex = matchedSpellByExpectedSlot.get(observedIndex);
      if (previousExpectedIndex === undefined || assignExpectedSlot(previousExpectedIndex, visitedSpells)) {
        matchedSpellByExpectedSlot.set(observedIndex, expectedIndex);
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let expectedIndex = 0; expectedIndex < expectedSlots.length; expectedIndex += 1) {
    if (assignExpectedSlot(expectedIndex, new Set())) {
      matched += 1;
    }
  }

  return {
    observed: observedSpells.length,
    expected: expectedSlots.length,
    deficit: expectedSlots.length - matched,
    extra: observedSpells.length - matched,
    boundary: null,
  };
}

function spellMatchesAuditSlot(item: ActorItemLike, expected: ExpectedSpellSlot): boolean {
  if (spellLocationId(item as unknown as SharedActorItemLike) !== expected.entryId) {
    return false;
  }
  const choice = expected.choice;
  const traits = Array.isArray((item.system as { traits?: { value?: unknown } } | undefined)?.traits?.value)
    ? ((item.system as { traits: { value: unknown[] } }).traits.value.filter(
        (value): value is string => typeof value === "string"
      ) as string[])
    : [];
  const isCantrip = traits.some((trait) => trait.trim().toLowerCase() === "cantrip");
  if (choice.cantrip !== isCantrip) {
    return false;
  }
  const rank = choice.cantrip
    ? 0
    : Number((item.system as { level?: { value?: unknown } } | undefined)?.level?.value ?? 0);
  if (rank < choice.minRank || rank > choice.maxRank) {
    return false;
  }

  const exactNames = [...choice.curriculumSpellNames, ...(choice.additionalAllowedSpellNames ?? [])];
  const exactUuids = new Set((choice.additionalAllowedSpellUuids ?? []).map((uuid) => uuid.trim().toLowerCase()));
  if (exactNames.length === 0 && exactUuids.size === 0) {
    return item.flags?.pf2e?.grantedBy === undefined;
  }
  const itemName = String(item.name ?? "");
  const sourceId = sourceIdOf(item)?.trim().toLowerCase() ?? "";
  return (
    exactNames.some((name) => name.localeCompare(itemName, undefined, { sensitivity: "accent" }) === 0) ||
    exactUuids.has(sourceId)
  );
}

function comparisonEntry(
  classSlug: string,
  classLabel: string,
  actorLevel: number,
  observed: number,
  expected: number,
  deficit: number,
  extra: number
): ExistingCharacterHistoryEntry {
  const attributionBoundary = "The sheet does not record which level each spell was learned at.";
  let value: string;
  let status: ExistingCharacterHistoryEntry["status"];
  if (deficit === 0 && extra === 0) {
    value = `${observed} spells, which is what a level ${actorLevel} character should have. ${attributionBoundary}`;
    status = "mapped";
  } else if (deficit > 0 && extra === 0) {
    value = `${deficit} spell${deficit === 1 ? "" : "s"} short. Found ${observed}, expected ${expected} by level ${actorLevel}. Add ${
      deficit === 1 ? "it" : "them"
    } on the sheet, or rebuild through Wayfinder. ${attributionBoundary}`;
    status = "review";
  } else if (extra > 0 && deficit === 0) {
    value = `${extra} spell${extra === 1 ? "" : "s"} more than expected. Found ${observed}, expected ${expected} by level ${actorLevel}. A feat or item probably granted ${
      extra === 1 ? "it" : "them"
    }, so have a look on the sheet. Do not delete anything on the strength of this count alone. ${attributionBoundary}`;
    status = "review";
  } else {
    value = `${deficit} expected spell${deficit === 1 ? " is" : "s are"} missing, and ${extra} other spell${extra === 1 ? " does" : "s do"} not fill those gaps. Found ${observed}, expected ${expected} by level ${actorLevel}. Check both groups on the sheet, and do not delete anything on the strength of this count alone. ${attributionBoundary}`;
    status = "review";
  }

  return {
    slotId: `spell-audit-${classSlug}-through-level-${actorLevel}`,
    level: actorLevel,
    category: "other",
    label: `${classLabel} spell audit`,
    value,
    status,
    sourceUuid: null,
  };
}

function boundaryEntry(
  classSlug: string,
  classLabel: string,
  actorLevel: number,
  boundary: string
): ExistingCharacterHistoryEntry {
  return {
    slotId: `spell-audit-${classSlug}-through-level-${actorLevel}`,
    level: actorLevel,
    category: "other",
    label: `${classLabel} spell audit`,
    value: `Review required: ${boundary}`,
    status: "review",
    sourceUuid: null,
  };
}

function className(classDocument: ActorItemLike | null, classSlug: string): string {
  const name = typeof classDocument?.name === "string" ? classDocument.name.trim() : "";
  return name || `${classSlug.slice(0, 1).toUpperCase()}${classSlug.slice(1)}`;
}
