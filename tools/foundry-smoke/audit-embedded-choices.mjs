#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SKILL_LABELS } from "../../scripts/constants.js";
import { hasUnsupportedEmbeddedChoiceSet } from "../../scripts/pack/embedded-choice-policy.js";
import { extractEntrySlug, numericOrNull, resolveFeatType } from "../../scripts/pack/entry.js";
import { parseCompendiumItemUuid, toCompendiumItemUuid } from "../../scripts/shared/compendium.js";
import { discoverGrantSelectionMeta } from "../../scripts/wayfinder/grant-choice/rule-discovery.js";
import { discoverSingletonChoiceSpecs } from "../../scripts/wayfinder/singleton-choice/rule-discovery.js";

const defaultPf2eRoot = "D:/Source/pf2e/packs/pf2e";
const defaultOutDir = ".tmp/embedded-choice-audit";
const featSlotKinds = ["ancestry-feat", "class-feat", "general-feat", "skill-feat"];
const featTypeBySlotKind = {
  "ancestry-feat": "ancestry",
  "class-feat": "class",
  "general-feat": "general",
  "skill-feat": "skill",
};
const packDirsByPackId = {
  "pf2e.feats-srd": "feats",
  "pf2e.classfeatures": "class-features",
  "pf2e.deities": "deities",
  "pf2e.spells-srd": "spells",
  "pf2e.equipment-srd": "equipment",
  "pf2e.actionspf2e": "actions",
  "pf2e.ancestries": "ancestries",
  "pf2e.heritages": "heritages",
  "pf2e.backgrounds": "backgrounds",
  "pf2e.classes": "classes",
};

function usage() {
  return `Usage: node tools/foundry-smoke/audit-embedded-choices.mjs [options]

Options:
  --pf2e-root <path>  PF2E pack root containing feats/. Defaults to PF2E_PACK_ROOT or ${defaultPf2eRoot}.
  --out-dir <path>    Directory for embedded-choice-audit.json/md. Defaults to ${defaultOutDir}.
  --label <name>      Report file stem. Defaults to embedded-choice-audit.
  --help             Show this help text.
`;
}

function parseArgs(argv) {
  const options = {
    help: false,
    pf2eRoot: process.env.PF2E_PACK_ROOT ?? defaultPf2eRoot,
    outDir: defaultOutDir,
    label: "embedded-choice-audit",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--pf2e-root" || arg === "--out-dir" || arg === "--label") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      const key = arg === "--pf2e-root" ? "pf2eRoot" : arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      options[key] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const featsDir = path.join(options.pf2eRoot, "feats");
  const classFeaturesDir = path.join(options.pf2eRoot, "class-features");
  if (!existsSync(featsDir)) {
    throw new Error(`PF2E feats pack directory was not found: ${featsDir}`);
  }
  if (!existsSync(classFeaturesDir)) {
    throw new Error(`PF2E class-features pack directory was not found: ${classFeaturesDir}`);
  }

  installMinimalPf2eConfig();

  const featEntries = readPackEntries(options.pf2eRoot, "pf2e.feats-srd");
  const classFeatureEntries = readPackEntries(options.pf2eRoot, "pf2e.classfeatures");
  const buckets = [
    ...featSlotKinds.map((slotKind) =>
      auditBucket({
        key: slotKind,
        title: slotKind,
        packId: "pf2e.feats-srd",
        entries: featEntries.filter((entry) => resolveFeatType(entry) === featTypeBySlotKind[slotKind]),
        step: makePickItemStep(slotKind),
        shownMeaning: "current direct feat picker policy",
      })
    ),
    auditBucket({
      key: "class-branch-options",
      title: "class-branch options (classfeatures pack, tag-filter branch policy)",
      packId: "pf2e.classfeatures",
      entries: classFeatureEntries,
      step: makeClassBranchStep({ predicateFiltered: false }),
      shownMeaning: "current tag-filter class-branch policy",
      alternateStep: makeClassBranchStep({ predicateFiltered: true }),
      alternateShownMeaning: "predicate-filter branch policy",
    }),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    pf2eRoot: options.pf2eRoot,
    buckets,
    totals: summarizeBuckets(buckets),
  };

  mkdirSync(options.outDir, { recursive: true });
  const jsonPath = path.join(options.outDir, `${options.label}.json`);
  const mdPath = path.join(options.outDir, `${options.label}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, toMarkdown(report));

  console.log(`Embedded ChoiceSet audit written: ${jsonPath}`);
  console.log(`Embedded ChoiceSet audit written: ${mdPath}`);
  for (const bucket of buckets) {
    const alternate = bucket.alternate
      ? `; predicate-filter shown ${bucket.alternate.shown}, hidden ${bucket.alternate.hidden}`
      : "";
    console.log(
      `${bucket.title}: ${bucket.choiceSetEntries} entries with ChoiceSets, shown ${bucket.shown}, hidden ${bucket.hidden}, uncovered shown ${bucket.shownWithUncoveredChoiceSets.length}${alternate}`
    );
  }
}

function installMinimalPf2eConfig() {
  globalThis.CONFIG = {
    PF2E: {
      skills: Object.fromEntries(Object.entries(SKILL_LABELS).map(([slug, label]) => [slug, { label }])),
      weaponGroups: {
        axe: "Axe",
        bow: "Bow",
        brawling: "Brawling",
        club: "Club",
        dart: "Dart",
        firearm: "Firearm",
        flail: "Flail",
        hammer: "Hammer",
        knife: "Knife",
        polearm: "Polearm",
        shield: "Shield",
        sling: "Sling",
        spear: "Spear",
        sword: "Sword",
      },
    },
  };
}

function readPackEntries(pf2eRoot, packId) {
  const dirName = packDirsByPackId[packId];
  if (!dirName) {
    throw new Error(`No local pack directory mapping for ${packId}`);
  }

  const packDir = path.join(pf2eRoot, dirName);
  if (!existsSync(packDir)) {
    return [];
  }

  return readdirSync(packDir)
    .flatMap((fileName) => listJsonFiles(path.join(packDir, fileName)))
    .map((filePath) => {
      const document = JSON.parse(readFileSync(filePath, "utf8"));
      return {
        ...document,
        _id: document._id ?? path.basename(filePath, ".json"),
        __fileName: path.relative(packDir, filePath).replaceAll(path.sep, "/"),
      };
    })
    .sort((left, right) => String(left.name ?? left._id).localeCompare(String(right.name ?? right._id)));
}

function listJsonFiles(filePath) {
  const statEntries = readdirSafe(filePath);
  if (statEntries) {
    return statEntries.flatMap((entry) => listJsonFiles(path.join(filePath, entry)));
  }

  const fileName = path.basename(filePath);
  return fileName.endsWith(".json") && fileName !== "_folders.json" ? [filePath] : [];
}

function readdirSafe(filePath) {
  try {
    return readdirSync(filePath);
  } catch {
    return null;
  }
}

function auditBucket(args) {
  const rows = args.entries
    .map((entry) => analyzeEntry(entry, args.packId, args.step))
    .filter((entry) => entry.choiceSetRuleIndexes.length > 0);
  const hiddenRows = rows.filter((entry) => entry.hidden);
  const shownRows = rows.filter((entry) => !entry.hidden);
  const bucket = {
    key: args.key,
    title: args.title,
    packId: args.packId,
    shownMeaning: args.shownMeaning,
    totalEntries: args.entries.length,
    choiceSetEntries: rows.length,
    shown: shownRows.length,
    hidden: hiddenRows.length,
    hiddenShapeCounts: countShapes(hiddenRows),
    hiddenEntries: hiddenRows.map(toReportRow),
    shownWithUncoveredChoiceSets: shownRows.filter((entry) => entry.uncovered.length > 0).map(toReportRow),
  };

  if (args.alternateStep) {
    const alternateRows = args.entries
      .map((entry) => analyzeEntry(entry, args.packId, args.alternateStep))
      .filter((entry) => entry.choiceSetRuleIndexes.length > 0);
    const alternateHidden = alternateRows.filter((entry) => entry.hidden);
    const alternateShown = alternateRows.filter((entry) => !entry.hidden);
    bucket.alternate = {
      shownMeaning: args.alternateShownMeaning,
      shown: alternateShown.length,
      hidden: alternateHidden.length,
      shownWithUncoveredChoiceSets: alternateShown.filter((entry) => entry.uncovered.length > 0).map(toReportRow),
    };
  }

  return bucket;
}

function analyzeEntry(entry, packId, step) {
  const ruleAnalyses = analyzeChoiceSetRules(entry, packId);
  return {
    packId,
    documentId: String(entry._id ?? ""),
    slug: extractEntrySlug(entry),
    name: String(entry.name ?? entry._id ?? "Unknown"),
    featType: resolveFeatType(entry),
    fileName: entry.__fileName,
    hidden: hasUnsupportedEmbeddedChoiceSet(entry, packId, step),
    choiceSetRuleIndexes: ruleAnalyses.map((rule) => rule.ruleIndex),
    covered: ruleAnalyses.filter((rule) => rule.coveredBy.length > 0),
    uncovered: ruleAnalyses.filter((rule) => rule.coveredBy.length === 0),
  };
}

function analyzeChoiceSetRules(entry, packId) {
  const rules = getChoiceSetRules(entry);
  if (rules.length === 0) {
    return [];
  }

  const sourceSelection = selectionFromEntry(entry, packId);
  const grantIndexes = sourceSelection
    ? new Set(
        discoverGrantSelectionMeta({
          sourceItemType: sourceSelection.itemType === "feat" ? "feat" : "classfeature",
          sourceDocument: entry,
          sourceSelection,
          extractSlug: extractEntrySlug,
        }).map((meta) => meta.selectorRuleIndex)
      )
    : new Set();
  const singletonIndexes = new Set(
    discoverSingletonChoiceSpecs({
      sourceItemType: "feat",
      sourceDocument: entry,
      sourceSlug: extractEntrySlug(entry) ?? String(entry._id ?? "entry"),
      localize: identity,
      includeTrainingChoices: false,
    }).map((spec) => spec.sourceRuleIndex)
  );
  const trainingIndexes = new Set(
    discoverSingletonChoiceSpecs({
      sourceItemType: "feat",
      sourceDocument: entry,
      sourceSlug: extractEntrySlug(entry) ?? String(entry._id ?? "entry"),
      localize: identity,
      includeTrainingChoices: true,
    })
      .filter((spec) => spec.optionDomain === "skill" || spec.optionDomain === "lore")
      .map((spec) => spec.sourceRuleIndex)
  );

  return rules.map(({ rule, ruleIndex }) => {
    const coveredBy = [
      ...(grantIndexes.has(ruleIndex) ? ["grant-choice"] : []),
      ...(singletonIndexes.has(ruleIndex) ? ["singleton-choice"] : []),
      ...(trainingIndexes.has(ruleIndex) ? ["skill-training"] : []),
    ];
    return {
      ruleIndex,
      flag: choiceKey(rule),
      coveredBy,
      shape: classifyChoiceShape(rule, entry, ruleIndex),
    };
  });
}

function getChoiceSetRules(entry) {
  const rules = Array.isArray(entry?.system?.rules) ? entry.system.rules : [];
  return rules
    .map((rule, ruleIndex) => ({ rule, ruleIndex }))
    .filter(({ rule }) => isRecord(rule) && rule.key === "ChoiceSet");
}

function selectionFromEntry(entry, packId) {
  const documentId = String(entry._id ?? "");
  if (!documentId) {
    return null;
  }

  return {
    slotId: "embedded-choice-audit",
    packId,
    documentId,
    uuid: toCompendiumItemUuid(packId, documentId),
    itemType: String(entry.type ?? ""),
    featType: resolveFeatType(entry),
    name: String(entry.name ?? documentId),
    level: numericOrNull(entry?.system?.level?.value),
  };
}

function classifyChoiceShape(rule, entry, ruleIndex) {
  if (hasSelectedItemOrEquipmentPredicate(rule)) {
    return "selected-item/equipment predicate";
  }

  if (hasSameItemDependency(entry, rule, ruleIndex)) {
    return "intra-item dependency graph";
  }

  if (typeof rule.choices === "string" || (isRecord(rule.choices) && typeof rule.choices.config === "string")) {
    return "config-string";
  }

  if (isFilterPredicateGrant(entry, rule)) {
    return "filter-predicate grant";
  }

  if (isStaticUuidChoice(rule)) {
    return "static-UUID outside allowlist";
  }

  if (isInlineOptionSingleton(rule)) {
    return "inline-options singleton";
  }

  return "other/unknown";
}

function isFilterPredicateGrant(entry, rule) {
  return isRecord(rule.choices) && Array.isArray(rule.choices.filter) && hasGrantForFlag(entry, choiceKey(rule));
}

function isStaticUuidChoice(rule) {
  if (!Array.isArray(rule.choices) || rule.choices.length === 0) {
    return false;
  }

  return rule.choices
    .filter(isRecord)
    .every((choice) => typeof choice.value === "string" && !!parseCompendiumItemUuid(choice.value));
}

function isInlineOptionSingleton(rule) {
  if (!Array.isArray(rule.choices) || rule.choices.length === 0) {
    return false;
  }

  return rule.choices.filter(isRecord).every((choice) => typeof choice.value === "string" && choice.value.length > 0);
}

function hasSelectedItemOrEquipmentPredicate(rule) {
  if (isRecord(rule.allowedDrops)) {
    return true;
  }

  const choices = rule.choices;
  if (!isRecord(choices) || Array.isArray(choices)) {
    return false;
  }

  if (choices.ownedItems === true || Array.isArray(choices.types)) {
    return true;
  }

  return JSON.stringify(choices).includes("item:group:") || JSON.stringify(choices).includes("item:damage:");
}

function hasSameItemDependency(entry, rule, ruleIndex) {
  const currentKey = choiceKey(rule);
  const currentRollOption = typeof rule.rollOption === "string" ? rule.rollOption : null;
  const dependencyKeys = getChoiceSetRules(entry)
    .filter((candidate) => candidate.ruleIndex !== ruleIndex)
    .flatMap((candidate) => [choiceKey(candidate.rule), candidate.rule.rollOption])
    .filter((value) => typeof value === "string" && value.length > 0);
  if (dependencyKeys.length === 0) {
    return false;
  }

  const serialized = JSON.stringify([rule.predicate, rule.choices]);
  return dependencyKeys.some((key) => {
    const escaped = escapeRegExp(key);
    return (
      new RegExp(`"${escaped}:`).test(serialized) ||
      serialized.includes(`rulesSelections.${key}`) ||
      (!!currentKey && currentKey !== key && serialized.includes(`${key}:${currentKey}`)) ||
      (!!currentRollOption && currentRollOption !== key && serialized.includes(`${key}:${currentRollOption}`))
    );
  });
}

function hasGrantForFlag(entry, flag) {
  if (!flag) {
    return false;
  }

  const rules = Array.isArray(entry?.system?.rules) ? entry.system.rules : [];
  return rules.some(
    (rule) =>
      isRecord(rule) &&
      rule.key === "GrantItem" &&
      typeof rule.uuid === "string" &&
      rule.uuid.includes(`rulesSelections.${flag}`)
  );
}

function choiceKey(rule) {
  for (const candidate of [rule.flag, rule.rollOption, rule.slug]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function makePickItemStep(slotKind) {
  return {
    id: `audit-${slotKind}`,
    level: 1,
    kind: "pick-item",
    slotKind,
    title: slotKind,
    description: "",
    required: true,
    slotId: `audit-${slotKind}`,
    filters: {
      itemType: "feat",
      featTypes: [featTypeBySlotKind[slotKind]],
      maxLevel: 20,
    },
  };
}

function makeClassBranchStep({ predicateFiltered }) {
  return {
    id: `audit-class-branch-${predicateFiltered ? "predicate" : "tag"}`,
    level: 1,
    kind: "class-branch",
    slotKind: "class-branch",
    title: "Class Branch",
    description: "",
    required: true,
    slotId: `audit-class-branch-${predicateFiltered ? "predicate" : "tag"}`,
    filters: {
      itemType: "feat",
      featTypes: ["classfeature"],
      maxLevel: 20,
      ...(predicateFiltered ? { predicate: ["item:tag:audit"] } : {}),
    },
    branch: {
      slotId: `audit-class-branch-${predicateFiltered ? "predicate" : "tag"}`,
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "audit",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.audit",
      selectorName: "Audit",
      selectorRuleIndex: 0,
      flag: "audit",
      optionTag: "audit",
      classSlug: null,
      dependsOn: "class",
    },
  };
}

function countShapes(rows) {
  const counts = {};
  for (const row of rows) {
    for (const rule of row.uncovered.length > 0 ? row.uncovered : row.covered) {
      counts[rule.shape] = (counts[rule.shape] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0])));
}

function toReportRow(row) {
  return {
    name: row.name,
    slug: row.slug,
    documentId: row.documentId,
    featType: row.featType,
    fileName: row.fileName,
    covered: row.covered,
    uncovered: row.uncovered,
  };
}

function summarizeBuckets(buckets) {
  return buckets.reduce(
    (totals, bucket) => ({
      choiceSetEntries: totals.choiceSetEntries + bucket.choiceSetEntries,
      shown: totals.shown + bucket.shown,
      hidden: totals.hidden + bucket.hidden,
      shownWithUncoveredChoiceSets:
        totals.shownWithUncoveredChoiceSets + bucket.shownWithUncoveredChoiceSets.length,
    }),
    { choiceSetEntries: 0, shown: 0, hidden: 0, shownWithUncoveredChoiceSets: 0 }
  );
}

function toMarkdown(report) {
  const lines = [
    "# Embedded ChoiceSet Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `PF2E root: \`${report.pf2eRoot}\``,
    "",
    "## Summary",
    "",
    "| Bucket | ChoiceSet entries | Shown | Hidden | Shown with uncovered ChoiceSets |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const bucket of report.buckets) {
    lines.push(
      `| ${bucket.title} | ${bucket.choiceSetEntries} | ${bucket.shown} | ${bucket.hidden} | ${bucket.shownWithUncoveredChoiceSets.length} |`
    );
    if (bucket.alternate) {
      lines.push(
        `| ${bucket.title} (${bucket.alternate.shownMeaning}) | ${bucket.choiceSetEntries} | ${bucket.alternate.shown} | ${bucket.alternate.hidden} | ${bucket.alternate.shownWithUncoveredChoiceSets.length} |`
      );
    }
  }

  lines.push("", "## Hidden Shape Counts", "");
  for (const bucket of report.buckets) {
    lines.push(`### ${bucket.title}`, "");
    const entries = Object.entries(bucket.hiddenShapeCounts);
    if (entries.length === 0) {
      lines.push("_No hidden embedded ChoiceSet entries._", "");
      continue;
    }
    lines.push("| Shape | Count |", "| --- | ---: |");
    for (const [shape, count] of entries) {
      lines.push(`| ${shape} | ${count} |`);
    }
    lines.push("");
  }

  lines.push("## Currently Shown With Uncovered ChoiceSets", "");
  for (const bucket of report.buckets) {
    appendRows(lines, bucket.title, bucket.shownWithUncoveredChoiceSets);
    if (bucket.alternate) {
      appendRows(lines, `${bucket.title} (${bucket.alternate.shownMeaning})`, bucket.alternate.shownWithUncoveredChoiceSets);
    }
  }

  return `${lines.join("\n")}\n`;
}

function appendRows(lines, title, rows) {
  lines.push(`### ${title}`, "");
  if (rows.length === 0) {
    lines.push("_None._", "");
    return;
  }

  lines.push("| Entry | Uncovered shapes | Covered lanes |", "| --- | --- | --- |");
  for (const row of rows) {
    const uncovered = row.uncovered.map((rule) => `#${rule.ruleIndex} ${rule.shape}`).join("<br>");
    const covered = row.covered.map((rule) => `#${rule.ruleIndex} ${rule.coveredBy.join("+")}`).join("<br>");
    lines.push(`| ${row.name} | ${uncovered || "-"} | ${covered || "-"} |`);
  }
  lines.push("");
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function identity(value) {
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
