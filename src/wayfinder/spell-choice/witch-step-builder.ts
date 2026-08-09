import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import type { PendingStep } from "../../types.js";
import { parseWitchPatronLessonSpellAccess } from "./metadata-parsing.js";
import { preparedSpellChoiceDestination } from "./prepared-step-builder.js";
import { fallbackSourceRef, findClassFeatureSource, sourceRefFromDocument } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { SpellTradition } from "./tradition-utils.js";
import type {
  ReadExistingSpellChoiceSelections,
  SpellChoiceClassDocument,
  SpellChoiceSchoolDocument,
} from "./types.js";

interface BuildWitchSpellChoiceStepsParams {
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  currentLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  patronDocument: SpellChoiceSchoolDocument | null;
  targetLevel: number;
  tradition: SpellTradition;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export function buildWitchSpellChoiceSteps(params: BuildWitchSpellChoiceStepsParams): PendingStep[] {
  const source = findClassFeatureSource(params.effectiveClassDocument, "Witch Spellcasting");
  const destination = {
    ...preparedSpellChoiceDestination({
      classSlug: "witch",
      tradition: params.tradition,
      ability: "int",
    }),
    type: "spellbook" as const,
    label: "Witch familiar spells",
  };
  const steps: PendingStep[] = [];
  const addStep = (step: PendingStep): void =>
    appendPendingSpellChoiceStep(steps, step, params.draft, params.readExistingSpellChoiceSelections);

  addStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-witch-cantrips-level-1",
      level: 1,
      title: "Witch familiar cantrips",
      description: `Choose the 10 ${params.tradition} cantrips your familiar begins knowing.`,
      source,
      classSlug: "witch",
      dependsOn: "class",
      count: 10,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination,
    })
  );

  addStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-witch-rank-1-level-1",
      level: 1,
      title: "Witch familiar spells",
      description: `Choose the five 1st-rank ${params.tradition} spells your familiar begins knowing.`,
      source,
      classSlug: "witch",
      dependsOn: "class",
      count: 5,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination,
    })
  );

  const patronLesson = parseWitchPatronLessonSpellAccess(params.patronDocument);
  if (patronLesson.uuids.length > 0) {
    const patronName = String(params.patronDocument?.name ?? "Patron");
    const patronSource = sourceRefFromDocument(params.patronDocument) ?? fallbackSourceRef(patronName);
    addStep(
      makeSpellChoiceStep({
        slotId: "spell-choice-witch-patron-lesson-level-1",
        level: 1,
        title: "Patron initial-lesson spell",
        description: "Add the additional 1st-rank spell your familiar learns from your patron's initial lesson.",
        source: patronSource,
        classSlug: "witch",
        dependsOn: "class-branch",
        count: 1,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: patronLesson.names,
        additionalAllowedSpellNames: patronLesson.names,
        additionalAllowedSpellUuids: patronLesson.uuids,
        restrictToCommon: false,
        destination,
      })
    );
  }

  for (let level = Math.max(2, params.currentLevel + 1); level <= params.targetLevel; level += 1) {
    addStep(
      makeSpellChoiceStep({
        slotId: `spell-choice-witch-familiar-level-${level}`,
        level,
        title: `Level ${level} witch familiar spells`,
        description: `Add the two ${params.tradition} spells your familiar learns at level ${level}. They can be any spell rank you can currently cast.`,
        source,
        classSlug: "witch",
        dependsOn: "class",
        count: 2,
        minRank: 1,
        maxRank: wizardMaxSpellRank(level),
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        reuseExistingEntryOnly: true,
        destination,
      })
    );
  }

  return steps;
}
