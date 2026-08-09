import { spellLocationId } from "../../actor-updater/spellcasting-entry-support.js";
import { listActorItems } from "../../build-state.js";
import { createEmptyDraft } from "../../draft-service.js";
import type { ActorItemLike as SharedActorItemLike } from "../../shared/actor-model.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { findSpellcastingEntryForChoice } from "../../shared/spellcasting.js";
import type { ExistingCharacterHistoryEntry, PendingStep, SpellChoiceMeta } from "../../types.js";
import { parseWitchPatronLessonSpellAccess } from "../spell-choice/metadata-parsing.js";
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

  const classFeatures = items.filter(isClassFeatureDocument) as SpellChoiceSchoolDocument[];
  const resolution = resolveRequiredClassChoices(classSlug, classFeatures);
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

  const expected = countableSteps.reduce((total, step) => total + (step.spellChoice?.count ?? 0), 0);
  const observed = countObservedSpells(actor, countableSteps);
  return [comparisonEntry(classSlug, className(classDocument, classSlug), actorLevel, observed, expected)];
}

function resolveRequiredClassChoices(
  classSlug: string,
  classFeatures: SpellChoiceSchoolDocument[]
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

function countObservedSpells(actor: unknown, steps: PendingStep[]): number {
  const entryIds = new Set<string>();
  const choicesByDestination = new Map<string, SpellChoiceMeta>();
  for (const step of steps) {
    const choice = step.spellChoice;
    if (choice && !choicesByDestination.has(choice.destination.key)) {
      choicesByDestination.set(choice.destination.key, choice);
    }
  }

  for (const choice of choicesByDestination.values()) {
    const entry = findSpellcastingEntryForChoice(actor, choice);
    if (typeof entry?.id === "string" && entry.id.length > 0) {
      entryIds.add(entry.id);
    }
  }

  return (listActorItems(actor) as ActorItemLike[]).filter(
    (item) => item.type === "spell" && entryIds.has(spellLocationId(item as unknown as SharedActorItemLike) ?? "")
  ).length;
}

function comparisonEntry(
  classSlug: string,
  classLabel: string,
  actorLevel: number,
  observed: number,
  expected: number
): ExistingCharacterHistoryEntry {
  const attributionBoundary = "Actor spell data does not identify which level each spell was learned.";
  const difference = observed - expected;
  let value: string;
  let status: ExistingCharacterHistoryEntry["status"];
  if (difference === 0) {
    value = `${observed} spells found, matches expectations through level ${actorLevel}. ${attributionBoundary}`;
    status = "mapped";
  } else if (difference < 0) {
    const deficit = Math.abs(difference);
    value = `${deficit} fewer spell${deficit === 1 ? "" : "s"} than expected (${observed} found; ${expected} expected through level ${actorLevel}) — add ${
      deficit === 1 ? "it" : "them"
    } on the sheet, or rebuild through Wayfinder. ${attributionBoundary}`;
    status = "review";
  } else {
    value = `${difference} more spell${difference === 1 ? "" : "s"} than expected (${observed} found; ${expected} expected through level ${actorLevel}), probably feat- or item-granted — review ${
      difference === 1 ? "it" : "them"
    } on the sheet; do not delete anything based on this audit. ${attributionBoundary}`;
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
