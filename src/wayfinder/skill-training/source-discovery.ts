import { SKILL_LABELS } from "../../constants.js";
import type {
  SelectionRef,
  SkillTrainingChoiceMeta,
  SkillTrainingLoreChoiceMeta,
  SkillTrainingMeta,
  SkillTrainingPersistenceMeta,
} from "../../types.js";
import {
  getConfiguredSkills,
  getSkillAbility,
  resolveSkillLabel,
  type SkillConfigMap,
} from "../class-choice/skill-config.js";
import { formatSlug } from "../formatting.js";
import { discoverSingletonChoiceSpecs } from "../singleton-choice/rule-discovery.js";

type TrainingSourceItemType = "ancestry" | "heritage" | "background" | "feat";

interface TrainingSourceDocumentLike {
  name?: unknown;
  system?: {
    slug?: unknown;
    description?: {
      value?: unknown;
    };
    trainedSkills?: {
      value?: unknown;
      lore?: unknown;
    };
    rules?: unknown;
  };
}

export interface SkillTrainingSourceContext {
  sourceItemType: TrainingSourceItemType;
  sourceSelection: SelectionRef | null;
  sourceDocument: unknown | null;
}

interface DerivedTrainingMeta {
  fixedLores: string[];
  choiceRules: SkillTrainingChoiceMeta[];
  loreChoices: SkillTrainingLoreChoiceMeta[];
}

export function discoverSourceSkillTrainingMeta(args: {
  sources: SkillTrainingSourceContext[];
  localize: (value: string) => string;
}): Pick<SkillTrainingMeta, "fixedSkills" | "fixedLores" | "choiceRules" | "loreChoices"> {
  const configuredSkills = getConfiguredSkills();
  const fixedSkills: string[] = [];
  const fixedLores: string[] = [];
  const choiceRules: SkillTrainingChoiceMeta[] = [];
  const loreChoices: SkillTrainingLoreChoiceMeta[] = [];

  for (const source of args.sources) {
    const document = source.sourceDocument as TrainingSourceDocumentLike | null;
    if (!document) {
      continue;
    }

    const sourceName =
      toNonEmptyString(document.name) ?? source.sourceSelection?.name ?? formatSlug(source.sourceItemType);
    const sourceSlug = toNonEmptyString(document.system?.slug) ?? source.sourceSelection?.documentId ?? sourceName;

    fixedSkills.push(...extractFixedTrainedSkills(document));
    fixedSkills.push(...extractFixedRuleGrantedSkills(document));
    fixedLores.push(...extractFixedLores(document));

    if (source.sourceItemType !== "feat") {
      for (const spec of discoverSingletonChoiceSpecs({
        sourceItemType: source.sourceItemType,
        sourceDocument: document,
        sourceSlug,
        localize: args.localize,
      })) {
        const persistence = selectionPersistence(source, spec.sourceRuleIndex);
        if (spec.optionDomain === "skill") {
          choiceRules.push({
            key: `${source.sourceItemType}:${sourceSlug}:${spec.flag}`,
            flag: spec.flag,
            prompt: spec.prompt ?? `Choose the skill ${sourceName} grants.`,
            sourceLabel: sourceName,
            options: spec.options.map((option) => ({ slug: option.value, label: option.label })),
            persistence,
          });
          continue;
        }

        if (looksLikeLoreOptions(spec.options.map((option) => option.label))) {
          loreChoices.push({
            key: `${source.sourceItemType}:${sourceSlug}:${spec.flag}`,
            flag: spec.flag,
            prompt: spec.prompt ?? `Choose the Lore skill ${sourceName} grants.`,
            sourceLabel: sourceName,
            placeholder: normalizeLorePlaceholder(spec.options[0]?.label ?? "Custom Lore"),
            suggestions: dedupeLabels(spec.options.map((option) => normalizeLoreLabel(option.label))),
            allowCustom: false,
            persistence,
          });
        }
      }
    }

    const derived = discoverDescriptionTrainingMeta({
      source,
      sourceName,
      sourceSlug,
      localize: args.localize,
      configuredSkills,
    });
    fixedLores.push(...derived.fixedLores);
    choiceRules.push(...derived.choiceRules);
    loreChoices.push(...derived.loreChoices);
  }

  const flexibleLoreSuggestions = new Set(
    loreChoices.flatMap((choice) =>
      choice.suggestions.map((suggestion) => normalizeLoreLabel(suggestion).toLowerCase())
    )
  );

  return {
    fixedSkills: dedupeSlugs(fixedSkills),
    fixedLores: dedupeLabels(fixedLores).filter((label) => !flexibleLoreSuggestions.has(label.toLowerCase())),
    choiceRules: dedupeByKey(choiceRules),
    loreChoices: dedupeByKey(loreChoices),
  };
}

function extractFixedTrainedSkills(document: TrainingSourceDocumentLike): string[] {
  const entries = Array.isArray(document.system?.trainedSkills?.value) ? document.system.trainedSkills.value : [];
  return entries
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry in SKILL_LABELS);
}

function extractFixedLores(document: TrainingSourceDocumentLike): string[] {
  const entries = Array.isArray(document.system?.trainedSkills?.lore) ? document.system.trainedSkills.lore : [];
  return entries
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => normalizeLoreLabel(entry));
}

function selectionPersistence(
  source: SkillTrainingSourceContext,
  sourceRuleIndex: number
): SkillTrainingPersistenceMeta | null {
  if (!source.sourceSelection) {
    return null;
  }

  return {
    sourceItemType: source.sourceItemType,
    sourcePackId: source.sourceSelection.packId,
    sourceDocumentId: source.sourceSelection.documentId,
    sourceUuid: source.sourceSelection.uuid,
    sourceRuleIndex,
  };
}

function discoverDescriptionTrainingMeta(args: {
  source: SkillTrainingSourceContext;
  sourceName: string;
  sourceSlug: string;
  localize: (value: string) => string;
  configuredSkills: SkillConfigMap;
}): DerivedTrainingMeta {
  const descriptionText = normalizeDescriptionText(
    (args.source.sourceDocument as TrainingSourceDocumentLike | null)?.system?.description?.value
  );
  if (!descriptionText) {
    return {
      fixedLores: [],
      choiceRules: [],
      loreChoices: [],
    };
  }

  const choiceRules: SkillTrainingChoiceMeta[] = [];
  const loreChoices: SkillTrainingLoreChoiceMeta[] = [];
  const additionalLoreGrants = discoverAdditionalLoreGrantMeta({
    descriptionText,
    sourceItemType: args.source.sourceItemType,
    sourceSlug: args.sourceSlug,
    sourceLabel: args.sourceName,
  });
  const fixedLores = [...additionalLoreGrants.fixedLores];
  loreChoices.push(...additionalLoreGrants.loreChoices);
  const hasConditionalFallbackSkillChoice =
    /\bif you would automatically become trained in one of those skills\b/i.test(descriptionText);

  choiceRules.push(
    ...discoverDedicationSkillChoices({
      descriptionText,
      sourceItemType: args.source.sourceItemType,
      sourceSlug: args.sourceSlug,
      sourceLabel: args.sourceName,
      localize: args.localize,
      configuredSkills: args.configuredSkills,
    })
  );

  const loreSkillAndOtherSkillMatch =
    /\bone lore skill and one other intelligence- or wisdom-based skill of your choice\b/i.exec(descriptionText);
  if (loreSkillAndOtherSkillMatch) {
    loreChoices.push(
      createLoreChoice({
        key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-lore-1`,
        sourceLabel: args.sourceName,
        prompt: "Choose a Lore skill",
        placeholder: "Custom Lore",
        suggestions: [],
        allowCustom: true,
      })
    );
    choiceRules.push(
      createSkillChoice({
        key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-skill-1`,
        sourceLabel: args.sourceName,
        prompt: "Choose an Intelligence- or Wisdom-based skill",
        options: buildFilteredSkillOptions(args.localize, args.configuredSkills, ["int", "wis"]),
      })
    );
  }

  if (choiceRules.length === 0) {
    const genericSkillMatches = Array.from(
      descriptionText.matchAll(
        /\b(?:(one|two)\s+)?(?:other\s+)?((?:intelligence|wisdom|charisma|dexterity|strength|constitution)(?:-\s*or\s*(?:intelligence|wisdom|charisma|dexterity|strength|constitution))?)-based skill(?:s)? of your choice\b/gi
      )
    );
    for (const [index, match] of genericSkillMatches.entries()) {
      const count = numberFromWord(match[1]);
      const abilities = match[2]
        ? Array.from(
            new Set(
              match[2]
                .split(/-\s*or\s*/i)
                .map((entry) => abilityWordToKey(entry))
                .filter((entry): entry is string => typeof entry === "string")
            )
          )
        : [];
      const prompt =
        abilities.length > 0
          ? `Choose ${count === 1 ? "an" : count} ${formatAbilityList(abilities)}-based skill${count === 1 ? "" : "s"}`
          : "Choose a skill";
      for (let choiceIndex = 0; choiceIndex < count; choiceIndex += 1) {
        choiceRules.push(
          createSkillChoice({
            key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-skill-${index + 1}-${choiceIndex + 1}`,
            sourceLabel: args.sourceName,
            prompt,
            options: buildFilteredSkillOptions(args.localize, args.configuredSkills, abilities),
          })
        );
      }
    }
  }

  if (
    choiceRules.length === 0 &&
    !hasConditionalFallbackSkillChoice &&
    /\b(?:one|a)\s+(?:other\s+)?skill of your choice\b/i.test(descriptionText)
  ) {
    choiceRules.push(
      createSkillChoice({
        key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-skill-1`,
        sourceLabel: args.sourceName,
        prompt: "Choose a skill",
        options: buildFilteredSkillOptions(args.localize, args.configuredSkills, []),
      })
    );
  }

  const fixedLoreOrCustomMatch =
    /\b([A-Za-z][A-Za-z' -]+ Lore) skill or a Lore skill (?:associated with|related to|specializing in)\s+([^.;]+)/i.exec(
      descriptionText
    );
  if (fixedLoreOrCustomMatch) {
    loreChoices.push(
      createLoreChoice({
        key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-lore-or-1`,
        sourceLabel: args.sourceName,
        prompt: "Choose a Lore skill",
        placeholder: normalizeLorePlaceholder(topicToLoreLabel(fixedLoreOrCustomMatch[2])),
        suggestions: [normalizeLoreLabel(fixedLoreOrCustomMatch[1])],
        allowCustom: true,
      })
    );
  }

  const fixedLoreAlternatives = Array.from(
    descriptionText.matchAll(/\b([A-Za-z][A-Za-z' -]+ Lore)\b\s+or\s+\b([A-Za-z][A-Za-z' -]+ Lore)\b/gi)
  );
  for (const [index, match] of fixedLoreAlternatives.entries()) {
    loreChoices.push(
      createLoreChoice({
        key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-lore-choice-${index + 1}`,
        sourceLabel: args.sourceName,
        prompt: "Choose a Lore skill",
        placeholder: normalizeLorePlaceholder(match[1] ?? "Custom Lore"),
        suggestions: [normalizeLoreLabel(match[1] ?? ""), normalizeLoreLabel(match[2] ?? "")],
        allowCustom: false,
      })
    );
  }

  const countedLoreMatches = Array.from(descriptionText.matchAll(/\b(one|two)\s+lore skills? of your choice\b/gi));
  for (const [index, match] of countedLoreMatches.entries()) {
    const count = numberFromWord(match[1]);
    for (let loreIndex = 0; loreIndex < count; loreIndex += 1) {
      loreChoices.push(
        createLoreChoice({
          key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-lore-${index + 1}-${loreIndex + 1}`,
          sourceLabel: args.sourceName,
          prompt: `Choose Lore skill ${loreIndex + 1}`,
          placeholder: "Custom Lore",
          suggestions: [],
          allowCustom: true,
        })
      );
    }
  }

  if (loreChoices.length === 0) {
    const contextualLoreMatch = /\ba lore skill (?:associated with|related to|specializing in)\s+([^.;]+)/i.exec(
      descriptionText
    );
    if (contextualLoreMatch) {
      loreChoices.push(
        createLoreChoice({
          key: `${args.source.sourceItemType}:${args.sourceSlug}:derived-lore-1`,
          sourceLabel: args.sourceName,
          prompt: "Choose a Lore skill",
          placeholder: topicToLoreLabel(contextualLoreMatch[1]),
          suggestions: [],
          allowCustom: true,
        })
      );
    }
  }

  return {
    fixedLores: dedupeLabels(fixedLores),
    choiceRules: dedupeByKey(choiceRules),
    loreChoices: dedupeByKey(loreChoices),
  };
}

function createSkillChoice(args: {
  key: string;
  sourceLabel: string;
  prompt: string;
  options: Array<{ slug: string; label: string }>;
  fallbackPrompt?: string;
  fallbackOptions?: Array<{ slug: string; label: string }>;
}): SkillTrainingChoiceMeta {
  return {
    key: args.key,
    flag: args.key,
    prompt: args.prompt,
    sourceLabel: args.sourceLabel,
    options: args.options,
    ...(args.fallbackPrompt ? { fallbackPrompt: args.fallbackPrompt } : {}),
    ...(args.fallbackOptions && args.fallbackOptions.length > 0 ? { fallbackOptions: args.fallbackOptions } : {}),
    persistence: null,
  };
}

function createLoreChoice(args: {
  key: string;
  flag?: string;
  sourceLabel: string;
  prompt: string;
  placeholder: string;
  suggestions: string[];
  allowCustom: boolean;
}): SkillTrainingLoreChoiceMeta {
  return {
    key: args.key,
    flag: args.flag ?? args.key,
    sourceLabel: args.sourceLabel,
    prompt: args.prompt,
    placeholder: normalizeLorePlaceholder(args.placeholder),
    suggestions: dedupeLabels(args.suggestions),
    allowCustom: args.allowCustom,
    persistence: null,
  };
}

function buildFilteredSkillOptions(
  localize: (value: string) => string,
  configuredSkills: SkillConfigMap,
  allowedAbilities: string[]
): Array<{ slug: string; label: string }> {
  const skillEntries =
    Object.keys(configuredSkills).length > 0 ? Object.keys(configuredSkills) : Object.keys(SKILL_LABELS);
  return skillEntries
    .filter(
      (slug) =>
        allowedAbilities.length === 0 || allowedAbilities.includes(getSkillAbility(slug, configuredSkills) ?? "")
    )
    .map((slug) => ({
      slug,
      label: resolveSkillLabel(slug, configuredSkills[slug]?.label, localize, configuredSkills),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function discoverDedicationSkillChoices(args: {
  descriptionText: string;
  sourceItemType: TrainingSourceItemType;
  sourceSlug: string;
  sourceLabel: string;
  localize: (value: string) => string;
  configuredSkills: SkillConfigMap;
}): SkillTrainingChoiceMeta[] {
  const allSkillOptions = buildFilteredSkillOptions(args.localize, args.configuredSkills, []);

  const choiceBetweenSpecificSkills = Array.from(
    args.descriptionText.matchAll(
      /\btrained in (?:your choice of )?([A-Za-z][A-Za-z' -]+?) or ([A-Za-z][A-Za-z' -]+?)(?: plus one skill of your choice)?; if you (?:are|were) already trained in both(?: of these skills| [A-Za-z][A-Za-z' -]+ and [A-Za-z][A-Za-z' -]+)?[,]? you (?:instead )?become trained in (?:an? )?(?:additional |another )?skill of your choice\b/gi
    )
  );
  if (choiceBetweenSpecificSkills.length > 0) {
    const rules = choiceBetweenSpecificSkills.flatMap((match, index) => {
      const firstSkill = skillSlugFromLabel(match[1], args.configuredSkills, args.localize);
      const secondSkill = skillSlugFromLabel(match[2], args.configuredSkills, args.localize);
      if (!firstSkill || !secondSkill) {
        return [];
      }

      const preferredOptions = dedupeSkillOptions(
        [firstSkill, secondSkill].map((slug) => ({
          slug,
          label: resolveSkillOptionLabel(slug, args.configuredSkills, args.localize),
        }))
      );

      const results = [
        createSkillChoice({
          key: `${args.sourceItemType}:${args.sourceSlug}:dedication-skill-${index + 1}`,
          sourceLabel: args.sourceLabel,
          prompt: `Choose ${preferredOptions[0]?.label ?? "a skill"} or ${preferredOptions[1]?.label ?? "a skill"}`,
          options: preferredOptions,
          fallbackPrompt: "Choose a skill",
          fallbackOptions: allSkillOptions,
        }),
      ];

      if (/\bplus one skill of your choice\b/i.test(match[0] ?? "")) {
        results.push(
          createSkillChoice({
            key: `${args.sourceItemType}:${args.sourceSlug}:dedication-bonus-skill-${index + 1}`,
            sourceLabel: args.sourceLabel,
            prompt: "Choose a skill",
            options: allSkillOptions,
          })
        );
      }

      return results;
    });

    if (rules.length > 0) {
      return rules;
    }
  }

  const fixedSkillFallbackMatch =
    /\btrained in ([A-Za-z][A-Za-z' -]+?); if you (?:were|are) already trained in [^.;]+?, you instead become trained in (?:an? )?(?:additional |another )?skill of your choice\b/i.exec(
      args.descriptionText
    );
  if (fixedSkillFallbackMatch) {
    const skillSlug = skillSlugFromLabel(fixedSkillFallbackMatch[1], args.configuredSkills, args.localize);
    if (skillSlug) {
      return [
        createSkillChoice({
          key: `${args.sourceItemType}:${args.sourceSlug}:dedication-skill-1`,
          sourceLabel: args.sourceLabel,
          prompt: `Choose ${resolveSkillOptionLabel(skillSlug, args.configuredSkills, args.localize)}`,
          options: [
            {
              slug: skillSlug,
              label: resolveSkillOptionLabel(skillSlug, args.configuredSkills, args.localize),
            },
          ],
          fallbackPrompt: "Choose a skill",
          fallbackOptions: allSkillOptions,
        }),
      ];
    }
  }

  return [];
}

function resolveSkillOptionLabel(
  slug: string,
  configuredSkills: SkillConfigMap,
  localize: (value: string) => string
): string {
  return resolveSkillLabel(slug, configuredSkills[slug]?.label, localize, configuredSkills);
}

function skillSlugFromLabel(
  label: string,
  configuredSkills: SkillConfigMap,
  localize: (value: string) => string
): string | null {
  const normalizedLabel = normalizeSkillLabel(label);
  const skillEntries =
    Object.keys(configuredSkills).length > 0 ? Object.keys(configuredSkills) : Object.keys(SKILL_LABELS);

  for (const slug of skillEntries) {
    const resolved = normalizeSkillLabel(resolveSkillOptionLabel(slug, configuredSkills, localize));
    if (resolved === normalizedLabel) {
      return slug;
    }
  }

  return null;
}

function normalizeSkillLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function dedupeSkillOptions(options: Array<{ slug: string; label: string }>): Array<{ slug: string; label: string }> {
  const seen = new Set<string>();
  const result: Array<{ slug: string; label: string }> = [];
  for (const option of options) {
    if (seen.has(option.slug)) {
      continue;
    }

    seen.add(option.slug);
    result.push(option);
  }

  return result;
}

function looksLikeLoreOptions(labels: string[]): boolean {
  return labels.length > 0 && labels.every((label) => /\blore\b/i.test(label));
}

function normalizeDescriptionText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }

  return value
    .replace(
      /@UUID\[[^\]]*\.Item\.([^|\]]+)(?:\|[^\]]+)?\](?:\{([^}]+)\})?/gi,
      (_match, fallbackLabel: string, explicitLabel: string | undefined) => explicitLabel ?? fallbackLabel
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromWord(value: string | undefined): number {
  switch ((value ?? "").trim().toLowerCase()) {
    case "two":
      return 2;
    default:
      return 1;
  }
}

function abilityWordToKey(value: string): string | null {
  switch (value.trim().toLowerCase()) {
    case "strength":
      return "str";
    case "dexterity":
      return "dex";
    case "constitution":
      return "con";
    case "intelligence":
      return "int";
    case "wisdom":
      return "wis";
    case "charisma":
      return "cha";
    default:
      return null;
  }
}

function formatAbilityList(abilities: string[]): string {
  const labels = abilities.map((ability) => formatSlug(ability));
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  if (labels.length === 2) {
    return `${labels[0]} or ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1) ?? ""}`;
}

function topicToLoreLabel(topic: string): string {
  const normalizedTopic = topic
    .replace(/\b(?:your|the|one|local|type of)\b/gi, " ")
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedTopic) {
    return "Custom Lore";
  }

  return normalizeLorePlaceholder(`${normalizedTopic} Lore`);
}

function normalizeLorePlaceholder(value: string): string {
  const normalized = normalizeLoreLabel(value);
  return normalized.length > 0 ? normalized : "Custom Lore";
}

function normalizeLoreLabel(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^(?:and|or|either)\s+/i, "")
    .replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return "";
  }

  return /\blore\b$/i.test(trimmed) ? trimmed : `${trimmed} Lore`;
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function discoverAdditionalLoreGrantMeta(args: {
  descriptionText: string;
  sourceItemType: TrainingSourceItemType;
  sourceSlug: string;
  sourceLabel: string;
}): Pick<DerivedTrainingMeta, "fixedLores" | "loreChoices"> {
  const fixedLores: string[] = [];
  const loreChoices: SkillTrainingLoreChoiceMeta[] = [];
  const matches = Array.from(
    args.descriptionText.matchAll(
      /\badditional lore\b(?:\s+(?:general|skill)\s+feat|\s+feat)?(?:\s+and\s+[^.;]+?)?\s+(for|in)\s+([^.;]+)/gi
    )
  );

  for (const [index, match] of matches.entries()) {
    const relation = (match[1] ?? "").toLowerCase();
    const clause = (match[2] ?? "").trim();
    const normalizedClause = clause.replace(/\s+/g, " ");
    const loreLabels = Array.from(
      new Set(
        Array.from(normalizedClause.matchAll(/\b([A-Za-z][A-Za-z' -]*? Lore)\b/gi))
          .map((labelMatch) => normalizeLoreLabel(labelMatch[1] ?? ""))
          .filter((label) => label.length > 0)
      )
    );

    if (relation === "in") {
      fixedLores.push(...loreLabels);
      continue;
    }

    const explicitSubcategoryMatch =
      /\b(?:a\s+special\s+)?lore skill subcategory\s*[—:-]\s*([A-Za-z][A-Za-z' -]+ Lore)\b/i.exec(normalizedClause);
    if (explicitSubcategoryMatch) {
      fixedLores.push(normalizeLoreLabel(explicitSubcategoryMatch[1] ?? ""));
      continue;
    }

    if (/\bthe chosen lore\b/i.test(normalizedClause)) {
      loreChoices.push(
        createLoreChoice({
          key: `${args.sourceItemType}:${args.sourceSlug}:additional-lore-${index + 1}`,
          sourceLabel: args.sourceLabel,
          prompt: "Choose a Lore skill",
          placeholder: "Custom Lore",
          suggestions: [],
          allowCustom: true,
        })
      );
      continue;
    }

    if (/\blore subcategory\b/i.test(normalizedClause)) {
      loreChoices.push(
        createLoreChoice({
          key: `${args.sourceItemType}:${args.sourceSlug}:additional-lore-${index + 1}`,
          sourceLabel: args.sourceLabel,
          prompt: "Choose a Lore skill",
          placeholder: additionalLorePlaceholder(normalizedClause, loreLabels),
          suggestions: loreLabels,
          allowCustom: true,
        })
      );
      continue;
    }

    const normalizedAlternatives = normalizedClause
      .replace(/\beither\s+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const fixedAlternativePattern = loreLabels.map((label) => escapeRegExp(label)).join("\\s+or\\s+");
    const isPureAlternativeChoice =
      loreLabels.length > 1 &&
      fixedAlternativePattern.length > 0 &&
      new RegExp(`^${fixedAlternativePattern}$`, "i").test(normalizedAlternatives);

    if (isPureAlternativeChoice) {
      continue;
    }

    if (/\bor\b/i.test(normalizedClause) && loreLabels.length > 0) {
      loreChoices.push(
        createLoreChoice({
          key: `${args.sourceItemType}:${args.sourceSlug}:additional-lore-${index + 1}`,
          sourceLabel: args.sourceLabel,
          prompt: "Choose a Lore skill",
          placeholder: additionalLorePlaceholder(normalizedClause, loreLabels),
          suggestions: loreLabels.slice(0, 1),
          allowCustom: true,
        })
      );
      continue;
    }

    if (/\band\b/i.test(normalizedClause) && loreLabels.length > 1) {
      fixedLores.push(...loreLabels);
      continue;
    }

    if (loreLabels.length > 0) {
      fixedLores.push(...loreLabels);
    }
  }

  return {
    fixedLores: dedupeLabels(fixedLores),
    loreChoices: dedupeByKey(loreChoices),
  };
}

function additionalLorePlaceholder(clause: string, loreLabels: string[]): string {
  const exampleMatch = /\(such as ([A-Za-z][A-Za-z' -]+ Lore)\)/i.exec(clause);
  if (exampleMatch) {
    return normalizeLorePlaceholder(exampleMatch[1] ?? "Custom Lore");
  }

  if (loreLabels.length === 1) {
    return normalizeLorePlaceholder(loreLabels[0]);
  }

  const topicMatch = /\b(?:of|tied to|related to)\s+([^.;]+)/i.exec(clause);
  if (topicMatch) {
    return topicToLoreLabel(topicMatch[1]);
  }

  return "Custom Lore";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFixedRuleGrantedSkills(document: TrainingSourceDocumentLike): string[] {
  const rules = Array.isArray(document.system?.rules) ? document.system.rules : [];
  return rules
    .filter((rule): rule is Record<string, unknown> => !!rule && typeof rule === "object")
    .flatMap((rule) => {
      if (rule.key !== "ActiveEffectLike") {
        return [];
      }

      const path = toNonEmptyString(rule.path);
      const match = path ? /^system\.skills\.([a-z][a-z0-9-]*)\.rank$/i.exec(path) : null;
      const rank = Number(rule.value ?? 0);
      if (!match || !Number.isFinite(rank) || rank < 1) {
        return [];
      }

      const skillSlug = match[1].toLowerCase();
      return skillSlug in SKILL_LABELS ? [skillSlug] : [];
    });
}

function dedupeSlugs(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

function dedupeLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function dedupeByKey<T extends { key: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value.key)) {
      continue;
    }

    seen.add(value.key);
    result.push(value);
  }

  return result;
}
