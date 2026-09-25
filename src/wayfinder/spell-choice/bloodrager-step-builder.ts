import { documentIsRisingBloodMagic, RISING_BLOOD_MAGIC_UUID } from "../../shared/bloodrager-spellcasting.js";
import type { DraftState, PendingStep, SpellChoiceMeta } from "../../types.js";
import { classArchetypeProfileForDocument } from "../class-archetype/registry.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { ReadExistingSpellChoiceSelections, SpellChoiceSchoolDocument } from "./types.js";

const BLOODRAGER_DEDICATION_UUID = "Compendium.pf2e.feats-srd.Item.EcyPTxSwtdqrOtxY";
const TRADITION_SLOT_ID = "class-choice-bloodrager-dedication-skill-level-2";

interface BuildBloodragerSpellChoiceStepsParams {
  draft: DraftState;
  targetLevel: number;
  effectiveClassFeatureDocuments: SpellChoiceSchoolDocument[];
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export function buildBloodragerSpellChoiceSteps(params: BuildBloodragerSpellChoiceStepsParams): PendingStep[] {
  if (
    params.targetLevel < 2 ||
    !params.effectiveClassFeatureDocuments.some(
      (document) => classArchetypeProfileForDocument(document)?.value === "bloodrager"
    )
  ) {
    return [];
  }

  const tradition = bloodragerTradition(params);
  if (!tradition) return [];

  const steps: PendingStep[] = [];
  const destination: SpellChoiceMeta["destination"] = {
    type: "spontaneous",
    key: `bloodrager-${tradition}-repertoire`,
    entryReuse: "key-only",
    label: `Bloodrager ${tradition} repertoire`,
    entryName: "Bloodrager Repertoire",
    tradition,
    ability: "cha",
    prepared: "spontaneous",
  };
  const assignedSpellUuids = new Set<string>();
  for (const requiresAttack of [true, false]) {
    appendPendingSpellChoiceStep(
      steps,
      makeSpellChoiceStep({
        slotId: `spell-choice-bloodrager-${tradition}-${requiresAttack ? "attack-" : ""}cantrip-level-2`,
        level: 2,
        title: requiresAttack ? "Bloodrager attack cantrip" : "Bloodrager second cantrip",
        description: requiresAttack
          ? `Choose a ${tradition} cantrip that requires a spell attack roll for your Bloodrager repertoire.`
          : `Choose a different ${tradition} cantrip for your Bloodrager repertoire. It can also be an attack cantrip.`,
        source: {
          sourcePackId: "pf2e.feats-srd",
          sourceDocumentId: "EcyPTxSwtdqrOtxY",
          sourceUuid: BLOODRAGER_DEDICATION_UUID,
          sourceName: "Bloodrager Dedication",
        },
        classSlug: "barbarian",
        dependsOn: "class-branch",
        requiresCurriculum: false,
        count: 1,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        ...(requiresAttack ? { requiredTraits: ["attack"] } : {}),
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination,
      }),
      params.draft,
      (choice) => {
        // Unstamped spells in an existing repertoire can satisfy these two
        // steps only once. Ask for both so the second step can find the other.
        const existing = params
          .readExistingSpellChoiceSelections({ ...choice, count: 2 })
          .filter((selection) => !assignedSpellUuids.has(selection.uuid.toLowerCase()))
          .slice(0, choice.count);
        const drafted = params.draft.spellChoices[choice.slotId] ?? [];
        for (const selection of drafted.length > 0 ? drafted : existing) {
          assignedSpellUuids.add(selection.uuid.toLowerCase());
        }
        return existing;
      }
    );
  }
  if (params.targetLevel >= 4 && params.effectiveClassFeatureDocuments.some(documentIsRisingBloodMagic)) {
    appendPendingSpellChoiceStep(
      steps,
      makeSpellChoiceStep({
        slotId: `spell-choice-bloodrager-${tradition}-rank-1-level-4`,
        level: 4,
        title: "Rising Blood Magic spell",
        description: `Choose a common 1st-rank ${tradition} spell for your Bloodrager repertoire.`,
        source: {
          sourcePackId: "pf2e.feats-srd",
          sourceDocumentId: "QRqs9NIWeh0ONRSP",
          sourceUuid: RISING_BLOOD_MAGIC_UUID,
          sourceName: "Rising Blood Magic",
        },
        classSlug: "barbarian",
        dependsOn: "class-branch",
        requiresCurriculum: false,
        count: 1,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination,
      }),
      params.draft,
      params.readExistingSpellChoiceSelections
    );
  }
  return steps;
}

function bloodragerTradition(params: BuildBloodragerSpellChoiceStepsParams): "arcane" | "divine" | null {
  if (Object.hasOwn(params.draft.classChoices, TRADITION_SLOT_ID)) {
    return traditionForSkill(params.draft.classChoices[TRADITION_SLOT_ID]);
  }
  for (const document of params.effectiveClassFeatureDocuments) {
    if (
      document.system?.slug !== "bloodrager-dedication" &&
      ![document.sourceId, document.flags?.core?.sourceId, document._stats?.compendiumSource].includes(
        BLOODRAGER_DEDICATION_UUID
      )
    ) {
      continue;
    }
    const flags = document.flags as
      | { pf2e?: { rulesSelections?: Record<string, unknown> }; system?: { rulesSelections?: Record<string, unknown> } }
      | undefined;
    const selections = flags?.pf2e?.rulesSelections;
    if (selections && Object.hasOwn(selections, "skill")) return traditionForSkill(selections.skill);
    const systemSelections = flags?.system?.rulesSelections;
    if (systemSelections && Object.hasOwn(systemSelections, "skill")) return traditionForSkill(systemSelections.skill);
  }
  return null;
}

function traditionForSkill(skill: unknown): "arcane" | "divine" | null {
  return skill === "arcana" ? "arcane" : skill === "religion" ? "divine" : null;
}
