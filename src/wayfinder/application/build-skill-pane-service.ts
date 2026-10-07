import { SKILL_LABELS } from "../../constants.js";
import { resolveSingletonChoiceSkillGrant } from "../../shared/singleton-choice-skill-grants.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { sourceIdOf } from "../../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import { classArchetypeInitialTrainingProjection } from "../class-archetype/training-policy.js";
import { compileSkillProgression, type SkillProgression, type SkillSourceGrant } from "../domain/skill-progression.js";
import { buildAdditionalTrainingSkillsBySlotId, projectDraftSkillRanks } from "../domain/skill-rank-projection.js";
import { canonicalizeSkillSourceGrants, projectStaticSkillSourceGrants } from "../domain/static-skill-source-grants.js";
import { formatSlug } from "../formatting.js";
import { buildSkillIncreasePane, buildSkillTrainingPane } from "../panes/skill-pane.js";
import { discoverSingletonChoiceSpecs } from "../singleton-choice/rule-discovery.js";
import type { SkillIncreaseStepPane, SkillTrainingStepPane } from "../view-models.js";
import {
  listActiveSingletonSkillSources,
  listPlannedStaticSkillSources,
  projectedSkillSourceRollOptions,
  resolveClassArchetypeSkillProjectionProfile,
} from "./planned-static-skill-source-service.js";

type SkillPane = SkillIncreaseStepPane | SkillTrainingStepPane;
type SkillDocumentType = "ancestry" | "heritage" | "background" | "class";
type SkillListEntry = {
  slug: string;
  label: string;
  keyAbility: string | null;
};
type LooseSkillDocument = {
  uuid?: unknown;
  system?: {
    slug?: unknown;
    rules?: unknown;
    trainedSkills?: {
      value?: unknown[];
    } | null;
  } | null;
};

interface BuildSkillPaneDependencies {
  actorDocuments?: Iterable<unknown>;
  baseSkillRanks: Record<string, number>;
  steps?: readonly PendingStep[];
  skillProgression?: SkillProgression;
  resolveDocument: (itemType: SkillDocumentType) => Promise<unknown | null>;
  resolveSelectionDocument?: (selection: SelectionRef) => Promise<unknown | null>;
  configSkills: Record<string, unknown> | null;
  localize: (value: string) => string;
  isTrainingStepComplete: (step: PendingStep) => boolean;
}

interface ProjectSkillRanksDependencies {
  actorDocuments?: Iterable<unknown>;
  baseSkillRanks: Record<string, number>;
  steps?: readonly PendingStep[];
  validSkillSlugs?: ReadonlySet<string>;
  mode?: "editing" | "recovery";
  resolveDocument: (itemType: SkillDocumentType) => Promise<unknown | null>;
  resolveSelectionDocument?: (selection: SelectionRef) => Promise<unknown | null>;
  localize: (value: string) => string;
}

export async function buildSkillPane(
  step: PendingStep,
  draft: DraftState,
  deps: BuildSkillPaneDependencies
): Promise<SkillPane | null> {
  if (step.kind !== "skill-training" && step.kind !== "skill-increase") {
    return null;
  }

  const progression =
    deps.skillProgression ??
    (await compileSkillPaneProgression(draft, {
      actorDocuments: deps.actorDocuments,
      baseSkillRanks: deps.baseSkillRanks,
      steps: deps.steps ?? [step],
      validSkillSlugs: validSkillSlugs(deps.baseSkillRanks, deps.configSkills),
      resolveDocument: deps.resolveDocument,
      resolveSelectionDocument: deps.resolveSelectionDocument,
      localize: deps.localize,
    }));
  const projectedRanks = { ...(progression.stepsBySlotId[step.slotId]?.ranksBefore ?? progression.finalRanks) };
  const skillEntries = buildSkillList(projectedRanks, {
    configSkills: deps.configSkills,
    localize: deps.localize,
  });

  if (step.kind === "skill-training") {
    return buildSkillTrainingPane(step, draft, projectedRanks, skillEntries, {
      isTrainingStepComplete: () => progression.stepsBySlotId[step.slotId]?.progress.complete === true,
    });
  }

  return buildSkillIncreasePane(step, draft, projectedRanks, skillEntries);
}

export async function projectSkillRanks(
  draft: DraftState,
  upToSlotId: string,
  deps: ProjectSkillRanksDependencies
): Promise<Record<string, number>> {
  if (!deps.steps) {
    const projected = projectDraftSkillRanks({
      baseSkillRanks: deps.baseSkillRanks,
      draft,
      beforeSlotId: upToSlotId,
      additionalTrainingSkillsBySlotId: buildAdditionalTrainingSkillsBySlotId(draft, []),
    });
    const documents = await Promise.all([
      deps.resolveDocument("ancestry"),
      deps.resolveDocument("heritage"),
      deps.resolveDocument("background"),
      deps.resolveDocument("class"),
    ]);
    const profile = resolveClassArchetypeSkillProjectionProfile(draft, [], deps.actorDocuments ?? []);
    documents[3] = classArchetypeInitialTrainingProjection(documents[3], profile);
    for (const slug of documents.flatMap(extractFixedTrainedSkills)) {
      projected[slug] = Math.max(projected[slug] ?? 0, 1);
    }
    return projected;
  }
  const progression = await compileSkillPaneProgression(draft, deps);
  return { ...(progression.stepsBySlotId[upToSlotId]?.ranksBefore ?? progression.finalRanks) };
}

export async function compileSkillPaneProgression(
  draft: DraftState,
  deps: ProjectSkillRanksDependencies
): Promise<SkillProgression> {
  const [ancestryDocument, heritageDocument, backgroundDocument, classDocument] = await Promise.all([
    deps.resolveDocument("ancestry"),
    deps.resolveDocument("heritage"),
    deps.resolveDocument("background"),
    deps.resolveDocument("class"),
  ]);
  const actorDocuments = Array.from(deps.actorDocuments ?? []);
  const profile = resolveClassArchetypeSkillProjectionProfile(draft, deps.steps ?? [], actorDocuments);

  const sourceDocuments: Array<{ itemType: SkillDocumentType; document: unknown | null }> = [
    { itemType: "background", document: backgroundDocument },
    { itemType: "ancestry", document: ancestryDocument },
    { itemType: "heritage", document: heritageDocument },
    { itemType: "class", document: classArchetypeInitialTrainingProjection(classDocument, profile) },
  ];
  const plannedStaticSources = listPlannedStaticSkillSources(draft, deps.steps ?? []);
  const additionalStaticSources = Array.from(
    new Map(
      [
        ...plannedStaticSources.map(({ selection }) => selection),
        ...listActiveSingletonSkillSources(draft, deps.steps ?? []),
      ]
        .filter((selection) => !isSkillDocumentType(selection.itemType))
        .map((selection) => [selection.uuid, selection])
    ).values()
  );
  if (additionalStaticSources.length > 0 && !deps.resolveSelectionDocument) {
    throw new Error("Active non-foundation skill sources require an exact document resolver.");
  }
  const additionalStaticDocuments = await Promise.all(
    additionalStaticSources.map(async (selection) => {
      const activeReplacement =
        Object.values(draft.selections).some(
          (entry) => entry.uuid === selection.uuid && (deps.steps ?? []).some((step) => step.slotId === entry.slotId)
        ) || plannedStaticSources.some((entry) => entry.selection.uuid === selection.uuid);
      const retained = activeReplacement
        ? null
        : actorDocuments.find((document) => sourceIdOf(document) === selection.uuid);
      const document = retained ?? (await deps.resolveSelectionDocument?.(selection));
      if (!document) {
        throw new Error(`${selection.name} cannot project skills because its exact source document is unavailable.`);
      }
      return { selection, document };
    })
  );
  const activeSlotIds = new Set((deps.steps ?? []).map((step) => step.slotId));
  const activeFoundationSourceIds = new Map<SkillDocumentType, string>(
    Object.values(draft.selections)
      .filter(
        (selection): selection is typeof selection & { itemType: SkillDocumentType } =>
          activeSlotIds.has(selection.slotId) && isSkillDocumentType(selection.itemType)
      )
      .map((selection) => [selection.itemType, selection.uuid])
  );
  const acceptedSkillSlugs = deps.validSkillSlugs ?? validSkillSlugs(deps.baseSkillRanks, null);
  const activeRollOptions = projectedSkillSourceRollOptions({
    draft,
    steps: deps.steps ?? [],
    actorDocuments,
    skillRanks: deps.baseSkillRanks,
    sources: [
      ...sourceDocuments.flatMap(({ itemType, document }) => {
        const uuid = resolveFoundationSourceId(activeFoundationSourceIds, itemType, document);
        return uuid
          ? [
              {
                document,
                selection: {
                  slotId: `${itemType}-level-1`,
                  uuid,
                  itemType,
                  packId: "",
                  documentId: "",
                  featType: null,
                  name: itemType,
                  level: 1,
                },
              },
            ]
          : [];
      }),
      ...additionalStaticDocuments,
    ],
  });
  const sourceGrants = canonicalizeSkillSourceGrants<SkillSourceGrant>([
    ...sourceDocuments.flatMap(({ itemType, document }) => {
      const sourceId = resolveFoundationSourceId(activeFoundationSourceIds, itemType, document);
      return sourceId
        ? projectStaticSkillSourceGrants({ document, sourceId, validSkillSlugs: acceptedSkillSlugs, activeRollOptions })
        : [];
    }),
    ...extractDraftedSingletonSkillChoices(
      draft,
      [
        { sourceItemType: "ancestry", document: ancestryDocument },
        { sourceItemType: "heritage", document: heritageDocument },
        { sourceItemType: "background", document: backgroundDocument },
      ],
      deps.localize,
      activeFoundationSourceIds
    ),
    ...additionalStaticDocuments.flatMap(({ selection, document }) =>
      document
        ? projectStaticSkillSourceGrants({
            document,
            sourceId: selection.uuid,
            validSkillSlugs: acceptedSkillSlugs,
            activeRollOptions,
          })
        : []
    ),
    ...(deps.steps ?? []).flatMap((step): SkillSourceGrant[] => {
      if (step.kind !== "singleton-choice") return [];
      const choice = draft.singletonChoices[step.slotId];
      if (!step.singletonChoice.options.some((option) => option.value === choice)) return [];
      const source = additionalStaticDocuments.find(
        ({ selection }) => selection.uuid === step.singletonChoice.sourceUuid
      );
      const grant = resolveSingletonChoiceSkillGrant({
        rules: (source?.document as LooseSkillDocument | undefined)?.system?.rules,
        flag: step.singletonChoice.flag,
        selection: choice,
      });
      return grant && acceptedSkillSlugs.has(grant.skillSlug)
        ? [{ slug: grant.skillSlug, rank: grant.rank, sourceId: step.singletonChoice.sourceUuid }]
        : [];
    }),
  ]);

  return compileSkillProgression({
    baselineRanks: deps.baseSkillRanks,
    draft,
    steps: deps.steps ?? [],
    sourceGrants,
    validSkillSlugs: acceptedSkillSlugs,
    mode: deps.mode ?? "editing",
  });
}

function resolveFoundationSourceId(
  activeFoundationSourceIds: ReadonlyMap<SkillDocumentType, string>,
  itemType: SkillDocumentType,
  document: unknown | null
): string | null {
  const selectedSourceId = activeFoundationSourceIds.get(itemType);
  if (selectedSourceId) return selectedSourceId;
  const embeddedSourceId = sourceIdOf(document);
  if (embeddedSourceId) return embeddedSourceId;
  const documentUuid = (document as LooseSkillDocument | null)?.uuid;
  return typeof documentUuid === "string" && documentUuid.startsWith("Compendium.") ? documentUuid : null;
}

function isSkillDocumentType(itemType: string): itemType is SkillDocumentType {
  return itemType === "ancestry" || itemType === "heritage" || itemType === "background" || itemType === "class";
}

function validSkillSlugs(
  baseSkillRanks: Readonly<Record<string, number>>,
  configSkills: Record<string, unknown> | null
): ReadonlySet<string> {
  return new Set([...Object.keys(SKILL_LABELS), ...Object.keys(baseSkillRanks), ...Object.keys(configSkills ?? {})]);
}

function extractFixedTrainedSkills(document: unknown): string[] {
  const typedDocument = document as LooseSkillDocument | null;
  const skills = Array.isArray(typedDocument?.system?.trainedSkills?.value)
    ? typedDocument.system.trainedSkills.value
    : [];
  return skills
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map((entry) => entry.trim().toLowerCase());
}

function extractDraftedSingletonSkillChoices(
  draft: DraftState,
  sources: Array<{
    sourceItemType: "ancestry" | "heritage" | "background";
    document: unknown | null;
  }>,
  localize: (value: string) => string,
  activeFoundationSourceIds: ReadonlyMap<SkillDocumentType, string>
): SkillSourceGrant[] {
  return sources.flatMap(({ sourceItemType, document }) => {
    const sourceSlug = extractDocumentSlug(document);
    const sourceRules = (document as LooseSkillDocument | null)?.system?.rules;
    if (!document || !sourceSlug) {
      return [];
    }

    const sourceUuid =
      activeFoundationSourceIds.get(sourceItemType) ??
      sourceIdOf(document) ??
      (typeof (document as LooseSkillDocument).uuid === "string"
        ? ((document as LooseSkillDocument).uuid as string)
        : undefined);
    return discoverSingletonChoiceSpecs({
      sourceItemType,
      sourceDocument: document,
      sourceSlug,
      localize,
      includeTrainingChoices: true,
    }).flatMap((choice): SkillSourceGrant[] => {
      const selection = draft.singletonChoices[choice.slotId] ?? null;
      if (!selection || !choice.options.some((option) => option.value === selection)) {
        return [];
      }

      const grant = resolveSingletonChoiceSkillGrant({
        rules: sourceRules,
        flag: choice.flag,
        selection,
      });
      return grant
        ? [{ slug: grant.skillSlug, rank: grant.rank, ...(sourceUuid ? { sourceId: sourceUuid } : {}) }]
        : [];
    });
  });
}

function buildSkillList(
  actorSkillRanks: Record<string, number>,
  deps: Pick<BuildSkillPaneDependencies, "configSkills" | "localize">
): SkillListEntry[] {
  const result: SkillListEntry[] = [];
  const seen = new Set<string>();

  if (deps.configSkills && typeof deps.configSkills === "object") {
    for (const slug of Object.keys(deps.configSkills)) {
      const sourceLabel = resolveConfigSkillLabel(deps.configSkills[slug]);
      const label = skillLabel(slug, sourceLabel, deps.localize);
      result.push({
        slug,
        label,
        keyAbility: resolveConfigSkillAbility(deps.configSkills[slug]),
      });
      seen.add(slug);
    }
  } else {
    for (const [slug, label] of Object.entries(SKILL_LABELS)) {
      result.push({
        slug,
        label: skillLabel(slug, label, deps.localize),
        keyAbility: null,
      });
      seen.add(slug);
    }
  }

  for (const slug of Object.keys(actorSkillRanks)) {
    if (!seen.has(slug)) {
      result.push({
        slug,
        label: skillLabel(slug, undefined, deps.localize),
        keyAbility: null,
      });
    }
  }

  return result.sort((left, right) => left.label.localeCompare(right.label));
}

function resolveConfigSkillLabel(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }

  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const label = (entry as { label?: unknown }).label;
  return typeof label === "string" ? label : undefined;
}

function resolveConfigSkillAbility(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const attribute = (entry as { attribute?: unknown }).attribute;
  if (typeof attribute !== "string") {
    return null;
  }

  const normalized = attribute.trim();
  return normalized.length > 0 ? normalized.toUpperCase() : null;
}

function skillLabel(slug: string, sourceLabel: string | undefined, localize: (value: string) => string): string {
  const localized = typeof sourceLabel === "string" && sourceLabel.length > 0 ? localize(sourceLabel) : "";
  if (localized && localized !== sourceLabel) {
    return localized;
  }

  const fallback = SKILL_LABELS[slug];
  if (fallback) {
    return localize(fallback);
  }

  return formatSlug(slug);
}
