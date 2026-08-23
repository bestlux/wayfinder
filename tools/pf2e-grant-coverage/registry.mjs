#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { PHYSICAL_GRANT_DISCOVERY_VERSION, scanPf2eGrantCoverage } from "./scan.mjs";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
  PHYSICAL_GRANT_ROUTE_REGISTRY,
  PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS,
} from "../../scripts/wayfinder/domain/physical-grant-route-registry.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const PHYSICAL_GRANT_REGISTRY_SCHEMA_VERSION = 1;
export const PHYSICAL_GRANT_REGISTRY_ID = "WF-080-25";
export const DEFAULT_PHYSICAL_GRANT_REGISTRY_PATH = path.join(
  repoRoot,
  "docs",
  "coverage",
  "pf2e-8.4.1-level1-physical-grants.json",
);
export const DEFAULT_PHYSICAL_GRANT_REPORT_PATH = path.join(
  repoRoot,
  "docs",
  "coverage",
  "pf2e-8.4.1-level1-physical-grants.md",
);

const CLASSIFICATIONS = Object.freeze([
  "supported-native",
  "supported-wayfinder-acquisition",
  "unsupported-handoff",
]);
const CLASSIFICATION_SET = new Set(CLASSIFICATIONS);
const SOURCE_POLICIES = new Set(["mixed", "remaster-core", "remaster-optional"]);
const TRIGGER_CHANNELS = new Set(["branchSelections", "selections"]);
const LINK_LOCATIONS = new Set(["description", "rules", "system.items"]);
const ITEM_PACKS = Object.freeze([
  "ancestries",
  "ancestryfeatures",
  "backgrounds",
  "classes",
  "classfeatures",
  "equipment-srd",
  "feats-srd",
  "heritages",
]);
const LEVEL_ONE_FEAT_CATEGORIES = Object.freeze(["ancestry", "bonus", "class", "general", "skill"]);
const UUIDS = CLASS_GRANT_PROFILE_UUIDS;
const RUNTIME_ROUTES_BY_ID = new Map(
  PHYSICAL_GRANT_ROUTE_REGISTRY.map((route) => [route.routeId, route]),
);

export async function readPhysicalGrantRegistry(registryPath = DEFAULT_PHYSICAL_GRANT_REGISTRY_PATH) {
  const source = await readFile(registryPath, "utf8");
  let registry;
  try {
    registry = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Physical-grant registry is not valid JSON: ${detail}`, { cause: error });
  }
  assertPhysicalGrantRegistry(registry);
  return registry;
}

export function assertPhysicalGrantRegistry(registry) {
  assertRecord(registry, "Physical-grant registry");
  if (registry.schemaVersion !== PHYSICAL_GRANT_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Physical-grant registry schemaVersion must be ${PHYSICAL_GRANT_REGISTRY_SCHEMA_VERSION}.`,
    );
  }
  if (registry.registryId !== PHYSICAL_GRANT_REGISTRY_ID) {
    throw new Error(`Physical-grant registryId must be ${PHYSICAL_GRANT_REGISTRY_ID}.`);
  }

  assertSourcePin(registry.source);
  assertDiscoverySnapshot(registry.discovery);
  assertRecord(registry.scanBoundary, "Physical-grant scanBoundary");
  assertNonnegativeIntegerRecord(
    registry.scanBoundary.expectedDocumentCounts,
    "Physical-grant expectedDocumentCounts",
  );
  assertNonnegativeIntegerRecord(
    registry.scanBoundary.expectedLevelOneFeatCounts,
    "Physical-grant expectedLevelOneFeatCounts",
  );
  assertExactKeys(registry.scanBoundary.expectedDocumentCounts, ITEM_PACKS, "Physical-grant expectedDocumentCounts");
  assertExactKeys(
    registry.scanBoundary.expectedLevelOneFeatCounts,
    LEVEL_ONE_FEAT_CATEGORIES,
    "Physical-grant expectedLevelOneFeatCounts",
  );
  assertStringArray(registry.scanBoundary.exclusions, "Physical-grant scanBoundary exclusions", {
    nonempty: true,
  });

  if (!Array.isArray(registry.routes) || registry.routes.length === 0) {
    throw new Error("Physical-grant registry routes must be a nonempty array.");
  }
  const routeIds = new Set();
  const profileIds = new Set();
  const classificationCounts = new Map(CLASSIFICATIONS.map((classification) => [classification, 0]));
  for (const route of registry.routes) {
    assertPhysicalGrantRoute(route, { profileIds, routeIds });
    classificationCounts.set(route.classification, classificationCounts.get(route.classification) + 1);
  }
  const omittedClassifications = CLASSIFICATIONS.filter(
    (classification) => classificationCounts.get(classification) === 0,
  );
  if (omittedClassifications.length > 0) {
    throw new Error(
      `Physical-grant registry must contain all three dispositions; missing: ${omittedClassifications.join(", ")}.`,
    );
  }
  assertRuntimeCoverageParity(registry.routes);

  if (!Array.isArray(registry.unclassifiedAdditions) || registry.unclassifiedAdditions.length !== 0) {
    throw new Error("Physical-grant registry unclassifiedAdditions must be an empty array.");
  }
  return registry;
}

function assertSourcePin(source) {
  assertRecord(source, "Physical-grant source pin");
  if (typeof source.pf2eVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(source.pf2eVersion)) {
    throw new Error("Physical-grant source pf2eVersion must be an exact semantic version.");
  }
  if (source.pf2eVersion !== PHYSICAL_GRANT_COVERAGE_PF2E_VERSION) {
    throw new Error(
      `Physical-grant source pf2eVersion must match runtime coverage ${PHYSICAL_GRANT_COVERAGE_PF2E_VERSION}.`,
    );
  }
  if (typeof source.commit !== "string" || !/^[0-9a-f]{40}$/u.test(source.commit)) {
    throw new Error("Physical-grant source commit must be a full lowercase Git SHA.");
  }
  if (source.packRoot !== "packs/pf2e") {
    throw new Error('Physical-grant source packRoot must be the pinned path "packs/pf2e".');
  }
}

function assertDiscoverySnapshot(discovery) {
  assertRecord(discovery, "Physical-grant discovery snapshot");
  if (discovery.scannerVersion !== PHYSICAL_GRANT_DISCOVERY_VERSION) {
    throw new Error(
      `Physical-grant discovery scannerVersion must be ${PHYSICAL_GRANT_DISCOVERY_VERSION}.`,
    );
  }
  assertCanonicalStringSet(discovery.observationKeys, "Physical-grant discovery observationKeys");
  assertCanonicalStringSet(discovery.routeKeys, "Physical-grant discovery routeKeys");
  const runtimeRouteKeys = Object.keys(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS).sort();
  if (stableJson(discovery.routeKeys) !== stableJson(runtimeRouteKeys)) {
    throw new Error("Physical-grant discovery routeKeys differ from runtime scanner dispositions.");
  }
}

function assertPhysicalGrantRoute(route, { profileIds, routeIds }) {
  assertRecord(route, "Physical-grant route");
  if (
    Object.hasOwn(route, "triggerVariants") ||
    Object.hasOwn(route, "terminals") ||
    Object.hasOwn(route.blocker ?? {}, "code")
  ) {
    throw new Error(
      "Physical-grant routes must use activationVariants, terminalSourceUuids, and blocker.reasonCode.",
    );
  }
  if (typeof route.routeId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(route.routeId)) {
    throw new Error("Every physical-grant route needs a stable kebab-case routeId.");
  }
  if (routeIds.has(route.routeId)) {
    throw new Error(`Duplicate physical-grant routeId: ${route.routeId}.`);
  }
  routeIds.add(route.routeId);
  if (typeof route.label !== "string" || route.label.trim().length === 0) {
    throw new Error(`Physical-grant route ${route.routeId} needs a nonempty label.`);
  }
  if (!CLASSIFICATION_SET.has(route.classification)) {
    throw new Error(`Physical-grant route ${route.routeId} has an invalid classification.`);
  }
  if (!SOURCE_POLICIES.has(route.sourcePolicy)) {
    throw new Error(`Physical-grant route ${route.routeId} has an invalid sourcePolicy.`);
  }
  assertUuidArray(route.nodes, `Physical-grant route ${route.routeId} nodes`, { nonempty: true });
  assertUuidArray(
    route.terminalSourceUuids,
    `Physical-grant route ${route.routeId} terminalSourceUuids`,
  );
  assertTerminalSelector(route);
  assertStringArray(route.draftSlots, `Physical-grant route ${route.routeId} draftSlots`);
  assertActivationVariants(route.activationVariants, route.routeId);
  assertLinks(route.links, route.routeId);
  assertRuleChecks(route.ruleChecks, route.routeId);
  assertSemanticChecks(route.semanticChecks, route.routeId);
  for (const link of route.links) {
    if (!route.nodes.includes(link.from) || !route.nodes.includes(link.to)) {
      throw new Error(`Physical-grant route ${route.routeId} link endpoints must be declared nodes.`);
    }
  }
  for (const check of [...route.ruleChecks, ...route.semanticChecks]) {
    if (!route.nodes.includes(check.source)) {
      throw new Error(`Physical-grant route ${route.routeId} evidence source must be a declared node.`);
    }
  }

  if (route.classification === "unsupported-handoff") {
    if (route.profileId !== undefined || route.materializer !== undefined) {
      throw new Error(`Unsupported physical-grant route ${route.routeId} cannot claim runtime support.`);
    }
    if (route.blocker === undefined) {
      throw new Error(
        `Unsupported physical-grant route ${route.routeId} needs an explicit pre-review blocker.`,
      );
    }
    assertRecord(route.blocker, `Physical-grant route ${route.routeId} blocker`);
    if (
      route.blocker.preReview !== true ||
      typeof route.blocker.reasonCode !== "string" ||
      route.blocker.reasonCode.length === 0 ||
      typeof route.blocker.detail !== "string" ||
      route.blocker.detail.length === 0
    ) {
      throw new Error(
        `Unsupported physical-grant route ${route.routeId} needs an explicit pre-review blocker.`,
      );
    }
    if (
      route.blocker.reasonCode === "prose-only-no-terminal" &&
      route.semanticChecks.length === 0
    ) {
      throw new Error(`Prose-only physical-grant route ${route.routeId} needs a semantic canary.`);
    }
    return;
  }

  if (route.blocker !== undefined) {
    throw new Error(`Supported physical-grant route ${route.routeId} cannot carry a blocker.`);
  }
  if (typeof route.profileId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(route.profileId)) {
    throw new Error(`Supported physical-grant route ${route.routeId} needs a stable profileId.`);
  }
  if (profileIds.has(route.profileId)) {
    throw new Error(`Duplicate physical-grant profileId: ${route.profileId}.`);
  }
  profileIds.add(route.profileId);
  const expectedMaterializer =
    route.classification === "supported-native" ? "pf2e-native" : "wayfinder-acquisition";
  if (route.materializer !== expectedMaterializer) {
    throw new Error(
      `Physical-grant route ${route.routeId} must use the ${expectedMaterializer} materializer.`,
    );
  }
  const runtimeRoute = RUNTIME_ROUTES_BY_ID.get(route.routeId);
  if (!runtimeRoute || runtimeRoute.classification === "unsupported-handoff") {
    throw new Error(`Physical-grant route ${route.routeId} claims an unreviewed supported profile.`);
  }
  const requiredSourceUuids = [
    runtimeRoute.grant.originSourceUuid,
    runtimeRoute.grant.granterSourceUuid,
    runtimeRoute.grant.expectedSourceUuid,
    ...runtimeRoute.grant.nativeGrantChainSourceUuids,
  ].filter(Boolean);
  if (requiredSourceUuids.some((uuid) => !route.nodes.includes(uuid))) {
    throw new Error(
      `Physical-grant route ${route.routeId} omits a runtime grant source from its evidence path.`,
    );
  }
}

function assertRuntimeCoverageParity(routes) {
  if (routes.length !== PHYSICAL_GRANT_ROUTE_REGISTRY.length) {
    throw new Error("Physical-grant route count differs from the runtime registry.");
  }
  const registryRoutes = new Map(routes.map((route) => [route.routeId, route]));
  for (const runtimeRoute of PHYSICAL_GRANT_ROUTE_REGISTRY) {
    const route = registryRoutes.get(runtimeRoute.routeId);
    const sharedMismatch =
      !route ||
      route.label !== runtimeRoute.label ||
      route.classification !== runtimeRoute.classification ||
      route.sourcePolicy !== runtimeRoute.sourcePolicy ||
      stableJson(route.activationVariants) !== stableJson(runtimeRoute.activationVariants) ||
      stableJson(route.terminalSourceUuids) !== stableJson(runtimeRoute.terminalSourceUuids);
    if (sharedMismatch) {
      throw new Error(`Physical-grant route ${runtimeRoute.routeId} differs from runtime coverage.`);
    }
    if (runtimeRoute.classification === "unsupported-handoff") {
      if (
        route.profileId !== undefined ||
        route.materializer !== undefined ||
        route.blocker?.preReview !== runtimeRoute.blocker.preReview ||
        route.blocker?.reasonCode !== runtimeRoute.blocker.reasonCode ||
        route.blocker?.detail !== runtimeRoute.blocker.detail
      ) {
        throw new Error(`Physical-grant route ${runtimeRoute.routeId} differs from runtime coverage.`);
      }
      continue;
    }
    if (
      route.profileId !== runtimeRoute.profileId ||
      route.materializer !== runtimeRoute.materializer ||
      route.blocker !== undefined
    ) {
      throw new Error(`Physical-grant route ${runtimeRoute.routeId} differs from runtime coverage.`);
    }
  }
}

function assertActivationVariants(value, routeId) {
  if (!Array.isArray(value)) {
    throw new Error(`Physical-grant route ${routeId} activationVariants must be an array.`);
  }
  for (const variant of value) {
    if (!Array.isArray(variant) || variant.length === 0) {
      throw new Error(`Physical-grant route ${routeId} has an empty trigger variant.`);
    }
    for (const fact of variant) {
      assertRecord(fact, `Physical-grant route ${routeId} trigger fact`);
      if (fact.channel !== undefined && !TRIGGER_CHANNELS.has(fact.channel)) {
        throw new Error(`Physical-grant route ${routeId} has an invalid trigger channel.`);
      }
      if (
        typeof fact.sourceUuid !== "string" &&
        typeof fact.slotId !== "string" &&
        typeof fact.slotPrefix !== "string"
      ) {
        throw new Error(
          `Physical-grant route ${routeId} trigger needs a sourceUuid, slotId, or slotPrefix.`,
        );
      }
      if (fact.slotId !== undefined && typeof fact.slotId !== "string") {
        throw new Error(`Physical-grant route ${routeId} trigger slotId must be a string.`);
      }
      if (fact.slotPrefix !== undefined && typeof fact.slotPrefix !== "string") {
        throw new Error(`Physical-grant route ${routeId} trigger slotPrefix must be a string.`);
      }
      if (fact.sourceUuid !== undefined) {
        assertUuid(fact.sourceUuid, `Physical-grant route ${routeId} trigger sourceUuid`);
      }
      if (fact.value !== undefined && typeof fact.value !== "string") {
        throw new Error(`Physical-grant route ${routeId} trigger value must be a string.`);
      }
    }
  }
}

function assertTerminalSelector(route) {
  if (route.terminalSelector === undefined) {
    if (
      route.classification !== "unsupported-handoff" &&
      route.terminalSourceUuids.length === 0
    ) {
      throw new Error(`Supported physical-grant route ${route.routeId} needs a reviewed terminal.`);
    }
    return;
  }
  if (
    route.classification !== "supported-wayfinder-acquisition" ||
    route.profileId !== "giant-instinct-titan-mauler" ||
    route.terminalSelector?.kind !== "reviewed-catalogue-choice" ||
    route.terminalSelector?.itemType !== "weapon" ||
    route.terminalSourceUuids.length !== 0
  ) {
    throw new Error(
      "Only the giant-instinct-titan-mauler profile may use the reviewed weapon catalogue terminal selector.",
    );
  }
}

function assertLinks(value, routeId) {
  if (!Array.isArray(value)) throw new Error(`Physical-grant route ${routeId} links must be an array.`);
  for (const link of value) {
    assertRecord(link, `Physical-grant route ${routeId} link`);
    assertUuid(link.from, `Physical-grant route ${routeId} link source`);
    assertUuid(link.to, `Physical-grant route ${routeId} link target`);
    if (!LINK_LOCATIONS.has(link.location)) {
      throw new Error(`Physical-grant route ${routeId} has an invalid link location.`);
    }
  }
}

function assertRuleChecks(value, routeId) {
  if (!Array.isArray(value)) {
    throw new Error(`Physical-grant route ${routeId} ruleChecks must be an array.`);
  }
  for (const check of value) {
    assertRecord(check, `Physical-grant route ${routeId} rule check`);
    assertUuid(check.source, `Physical-grant route ${routeId} rule source`);
    if (typeof check.key !== "string" || check.key.length === 0) {
      throw new Error(`Physical-grant route ${routeId} has an invalid rule check key.`);
    }
  }
}

function assertSemanticChecks(value, routeId) {
  if (!Array.isArray(value)) {
    throw new Error(`Physical-grant route ${routeId} semanticChecks must be an array.`);
  }
  for (const check of value) {
    assertRecord(check, `Physical-grant route ${routeId} semantic check`);
    assertUuid(check.source, `Physical-grant route ${routeId} semantic source`);
    if (typeof check.contains !== "string" || check.contains.length === 0) {
      throw new Error(`Physical-grant route ${routeId} has an invalid semantic canary.`);
    }
  }
}

export async function readPhysicalGrantGitState(pf2eRepo) {
  const resolvedRepo = path.resolve(pf2eRepo);
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: resolvedRepo, encoding: "utf8" }),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: resolvedRepo,
      encoding: "utf8",
    }),
  ]);
  return {
    commit: commit.trim(),
    dirtyEntries: status
      .split(/\r?\n/gu)
      .map((entry) => entry.trimEnd())
      .filter(Boolean),
  };
}

export async function resolvePhysicalGrantSourceRepo({ environment = process.env } = {}) {
  if (typeof environment.PF2E_REPO === "string" && environment.PF2E_REPO.length > 0) {
    const configured = path.resolve(environment.PF2E_REPO);
    await assertPf2eManifestExists(configured, "PF2E_REPO");
    return configured;
  }

  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const commonDirectory = path.resolve(stdout.trim());
  const checkoutRoot = path.basename(commonDirectory) === ".git" ? path.dirname(commonDirectory) : repoRoot;
  const candidates = [
    path.resolve(checkoutRoot, "..", "pf2e"),
    path.resolve(checkoutRoot, "..", "..", "pf2e"),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(path.join(candidate, "system.pf2e.json"));
      return candidate;
    } catch {
      // Try the next conventional sibling location.
    }
  }
  throw new Error(
    `Physical-grant source verification is required. Set PF2E_REPO or pass --pf2e-repo <path>; no PF2E checkout was found at ${candidates.join(" or ")}.`,
  );
}

async function assertPf2eManifestExists(pf2eRepo, sourceLabel) {
  try {
    await access(path.join(pf2eRepo, "system.pf2e.json"));
  } catch (error) {
    throw new Error(`${sourceLabel} does not point to a PF2E source checkout: ${pf2eRepo}.`, {
      cause: error,
    });
  }
}

export async function verifyPhysicalGrantRegistryAgainstPf2e({
  registry,
  pf2eRepo,
  readGitState = readPhysicalGrantGitState,
  scanCoverage = scanPf2eGrantCoverage,
  verifySourceEvidence = verifyPhysicalGrantSourceEvidence,
} = {}) {
  assertPhysicalGrantRegistry(registry);
  if (typeof pf2eRepo !== "string" || pf2eRepo.length === 0) {
    throw new Error("Live physical-grant verification requires a --pf2e-repo path.");
  }
  const resolvedRepo = path.resolve(pf2eRepo);
  const gitState = await readGitState(resolvedRepo);
  if (gitState.commit !== registry.source.commit) {
    throw new Error(
      `PF2E source commit ${gitState.commit || "missing"} does not match the registry pin ${registry.source.commit}.`,
    );
  }
  if (!Array.isArray(gitState.dirtyEntries)) {
    throw new Error("PF2E Git state did not provide dirtyEntries.");
  }
  if (gitState.dirtyEntries.length > 0) {
    throw new Error(
      `PF2E source checkout is dirty, so it cannot prove commit ${registry.source.commit}: ${gitState.dirtyEntries.slice(0, 5).join(", ")}.`,
    );
  }
  const scan = await scanCoverage({
    failOnDiff: true,
    packRoot: registry.source.packRoot,
    pf2eRepo: resolvedRepo,
    registry,
  });
  await verifySourceEvidence({ pf2eRepo: resolvedRepo, registry, scan });
  return scan;
}

export async function verifyPhysicalGrantSourceEvidence({ pf2eRepo, registry, scan }) {
  const corpus = await loadPhysicalGrantCorpus(pf2eRepo, registry.source.packRoot);
  assertPhysicalGrantScanBoundary(corpus, registry.scanBoundary);
  for (const route of registry.routes) {
    for (const uuid of [...route.nodes, ...route.terminalSourceUuids]) {
      requireDocument(corpus.byUuid, uuid, `Physical-grant route ${route.routeId}`);
    }
    for (const link of route.links) assertDocumentLink(corpus, route.routeId, link);
    for (const check of route.ruleChecks) assertRuleCheck(corpus, route.routeId, check);
    for (const check of route.semanticChecks) assertSemanticCheck(corpus, route.routeId, check);
  }
  assertReviewedDynamicRelationships(registry, corpus);
  assertSupportedDiscoveryBindings(registry, scan, corpus);
  assertUnsupportedDiscoveryBindings(registry, scan);
}

async function loadPhysicalGrantCorpus(pf2eRepo, packRoot) {
  const manifest = JSON.parse(await readFile(path.join(pf2eRepo, "system.pf2e.json"), "utf8"));
  const packDirectories = new Map(
    (manifest.packs ?? [])
      .filter((entry) => entry?.type === "Item" && typeof entry?.name === "string")
      .map((entry) => [entry.name, path.basename(entry.path)]),
  );
  const sourceRoot = path.join(pf2eRepo, ...packRoot.split("/"));
  const byUuid = new Map();
  const counts = {};
  const documents = [];
  for (const pack of ITEM_PACKS) {
    const directory = packDirectories.get(pack);
    if (!directory) throw new Error(`PF2E manifest does not declare the ${pack} Item pack.`);
    let count = 0;
    for (const file of await listJsonFiles(path.join(sourceRoot, directory))) {
      if (path.basename(file) === "_folders.json") continue;
      const document = JSON.parse(await readFile(file, "utf8"));
      if (Array.isArray(document) || typeof document?._id !== "string" || typeof document?.name !== "string") {
        throw new Error(`PF2E source ${file} is not a single named document.`);
      }
      const uuid = `Compendium.pf2e.${pack}.Item.${document._id}`;
      if (byUuid.has(uuid)) throw new Error(`PF2E source contains duplicate UUID ${uuid}.`);
      const normalized = { ...document, pack, uuid };
      byUuid.set(uuid, normalized);
      documents.push(normalized);
      count += 1;
    }
    counts[pack] = count;
  }
  return { byUuid, counts, documents };
}

async function listJsonFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listJsonFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
  }
  return files.sort();
}

function assertPhysicalGrantScanBoundary(corpus, boundary) {
  for (const pack of ITEM_PACKS) {
    if (corpus.counts[pack] !== boundary.expectedDocumentCounts[pack]) {
      throw new Error(
        `PF2E ${pack} source count ${corpus.counts[pack] ?? "missing"} does not match ${boundary.expectedDocumentCounts[pack]}.`,
      );
    }
  }
  const feats = corpus.documents.filter(
    (document) => document.pack === "feats-srd" && Number(document.system?.level?.value) <= 1,
  );
  for (const category of LEVEL_ONE_FEAT_CATEGORIES) {
    const actual = feats.filter((document) => document.system?.category === category).length;
    if (actual !== boundary.expectedLevelOneFeatCounts[category]) {
      throw new Error(
        `PF2E level-1 ${category} feat count ${actual} does not match ${boundary.expectedLevelOneFeatCounts[category]}.`,
      );
    }
  }
}

function assertDocumentLink(corpus, routeId, link) {
  const source = requireDocument(corpus.byUuid, link.from, `Physical-grant route ${routeId} link`);
  const target = requireDocument(corpus.byUuid, link.to, `Physical-grant route ${routeId} link`);
  const material =
    link.location === "system.items"
      ? source.system?.items
      : link.location === "description"
        ? source.system?.description
        : source.system?.rules;
  const candidates = collectStrings(material);
  if (
    !candidates.some(
      (candidate) =>
        candidate === target._id ||
        candidate === target.name ||
        candidate === target.uuid ||
        candidate.includes(target.uuid),
    )
  ) {
    throw new Error(
      `Physical-grant route ${routeId} expected ${link.location} link ${link.from} -> ${link.to}.`,
    );
  }
}

function assertRuleCheck(corpus, routeId, check) {
  const source = requireDocument(corpus.byUuid, check.source, `Physical-grant route ${routeId} rule check`);
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  const matched = rules.some((rule) => {
    if (rule?.key !== check.key) return false;
    if (check.flag !== undefined && rule.flag !== check.flag) return false;
    if (check.itemType !== undefined && rule.itemType !== check.itemType) return false;
    if (check.uuid !== undefined && rule.uuid !== check.uuid) return false;
    if (check.filterContains !== undefined && !collectStrings(rule.choices?.filter).includes(check.filterContains)) {
      return false;
    }
    if (check.choiceValue !== undefined && !collectStrings(rule.choices).includes(check.choiceValue)) return false;
    return true;
  });
  if (!matched) {
    throw new Error(`Physical-grant route ${routeId} expected rule ${check.key} on ${check.source}.`);
  }
}

function assertSemanticCheck(corpus, routeId, check) {
  const source = requireDocument(corpus.byUuid, check.source, `Physical-grant route ${routeId} semantic check`);
  const description = collectStrings(source.system?.description).join(" ").toLocaleLowerCase();
  if (!description.includes(check.contains.toLocaleLowerCase())) {
    throw new Error(`Physical-grant route ${routeId} expected prose canary on ${check.source}.`);
  }
}

function assertReviewedDynamicRelationships(registry, corpus) {
  const routes = new Map(registry.routes.map((route) => [route.routeId, route]));
  const investigator = routes.get("investigator-alchemical-sciences-formula-book");
  assertDynamicChoiceRelationship(corpus, {
    choiceUuid: investigator.nodes[1],
    filterToken: "item:tag:investigator-methodology",
    flag: "methodology",
    routeId: investigator.routeId,
    selectedTag: "investigator-methodology",
    selectedUuid: investigator.nodes[2],
  });
  const titan = routes.get("giant-instinct-titan-mauler");
  assertDynamicChoiceRelationship(corpus, {
    choiceUuid: titan.nodes[1],
    filterToken: "item:tag:barbarian-instinct",
    flag: "instinct",
    routeId: titan.routeId,
    selectedTag: "barbarian-instinct",
    selectedUuid: titan.nodes[2],
  });

  const ancientGiant = routes.get("ancient-elf-giant-instinct-weapon");
  const ancientAlchemy = routes.get("ancient-elf-alchemist-formula-book");
  for (const [route, filterToken, selectedTag] of [
    [ancientGiant, "item:trait:multiclass", "multiclass"],
    [ancientAlchemy, "item:trait:multiclass", "multiclass"],
  ]) {
    assertDynamicChoiceRelationship(corpus, {
      choiceUuid: route.nodes[0],
      filterToken,
      flag: "ancientElf",
      routeId: route.routeId,
      selectedTag,
      selectedUuid: route.nodes[1],
    });
  }
  assertDynamicChoiceRelationship(corpus, {
    choiceUuid: ancientGiant.nodes[1],
    filterToken: "item:tag:barbarian-instinct",
    flag: "instinct",
    routeId: ancientGiant.routeId,
    selectedTag: "barbarian-instinct",
    selectedUuid: ancientGiant.nodes[2],
  });
}

function assertDynamicChoiceRelationship(
  corpus,
  { choiceUuid, filterToken, flag, routeId, selectedTag, selectedUuid },
) {
  const choiceDocument = requireDocument(corpus.byUuid, choiceUuid, `Physical-grant route ${routeId}`);
  const selectedDocument = requireDocument(corpus.byUuid, selectedUuid, `Physical-grant route ${routeId}`);
  const rules = Array.isArray(choiceDocument.system?.rules) ? choiceDocument.system.rules : [];
  const choices = rules.filter(
    (rule) =>
      rule?.key === "ChoiceSet" &&
      rule.flag === flag &&
      collectStrings(rule.choices?.filter).includes(filterToken),
  );
  const grants = rules.filter(
    (rule) =>
      rule?.key === "GrantItem" && rule.uuid === `{item|flags.system.rulesSelections.${flag}}`,
  );
  const selectedTraits = collectStrings(selectedDocument.system?.traits);
  if (choices.length !== 1 || grants.length !== 1 || !selectedTraits.includes(selectedTag)) {
    throw new Error(`Physical-grant route ${routeId} dynamic source relationship changed.`);
  }
}

function assertSupportedDiscoveryBindings(registry, scan, corpus) {
  if (!Array.isArray(scan?.observedRoutes) || !Array.isArray(scan?.reachableDocumentUuids)) {
    throw new Error("PF2E scanner result is missing observedRoutes or reachableDocumentUuids.");
  }
  const routes = new Map(registry.routes.map((route) => [route.routeId, route]));
  const reachable = new Set(scan.reachableDocumentUuids);
  const supportedRoutes = registry.routes.filter(
    (route) => route.classification !== "unsupported-handoff",
  );
  for (const route of supportedRoutes) {
    for (const uuid of route.nodes.filter(
      (entry) => !route.terminalSourceUuids.includes(entry),
    )) {
      if (!reachable.has(uuid)) {
        throw new Error(
          `Supported physical-grant profile ${route.profileId} source ${uuid} is not scanner-reachable.`,
        );
      }
    }
  }

  for (const profileId of ["alchemist-formula-book", "dwarf-clan-dagger", "sarangay-head-gem"]) {
    const route = routes.get(profileId);
    requireObservedRoute(scan.observedRoutes, {
      label: profileId,
      nodes: route.nodes,
      terminalKind: "equipment",
      terminalUuid: route.terminalSourceUuids[0],
    });
  }
  requireObservedRoute(scan.observedRoutes, {
    label: "investigator methodology",
    nodes: [UUIDS.investigatorClass, UUIDS.methodologyFeature],
    terminalKind: "dynamic",
  });
  requireObservedRoute(scan.observedRoutes, {
    label: "investigator formula book",
    nodes: [UUIDS.alchemicalSciences, UUIDS.formulaBookItem],
    terminalKind: "equipment",
    terminalUuid: UUIDS.formulaBookItem,
  });
  requireObservedRoute(scan.observedRoutes, {
    label: "Titan Mauler instinct",
    nodes: [UUIDS.barbarianClass, UUIDS.instinctFeature],
    terminalKind: "dynamic",
  });
  const giantInstinct = requireDocument(
    corpus.byUuid,
    UUIDS.giantInstinct,
    "Giant Instinct Titan Mauler semantic canary",
  );
  const normalized = collectStrings(giantInstinct.system?.description)
    .join(" ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
  for (const canary of ["price of 9 gp or less", "one size larger", "no value if sold"]) {
    if (!normalized.includes(canary)) {
      throw new Error(`Giant Instinct Titan Mauler semantic canary changed: ${canary}.`);
    }
  }
}

export function assertUnsupportedDiscoveryBindings(registry, scan, { expectedClaimCount = 46 } = {}) {
  if (!Array.isArray(scan?.observedRoutes)) {
    throw new Error("PF2E scanner result is missing observedRoutes.");
  }
  const claimedRouteKeys = new Map();
  const claim = (observed, routeId) => {
    const key = observed.routeKey ?? stableJson(observed);
    const existing = claimedRouteKeys.get(key);
    if (existing && existing !== routeId) {
      throw new Error(`PF2E discovery route ${key} is claimed by both ${existing} and ${routeId}.`);
    }
    claimedRouteKeys.set(key, routeId);
  };
  for (const route of registry.routes.filter((entry) => entry.classification === "unsupported-handoff")) {
    if (route.blocker.reasonCode === "prose-only-no-terminal") continue;
    const sources = route.nodes.filter((uuid) => !route.terminalSourceUuids.includes(uuid));
    if (route.routeId === "ancient-elf-giant-instinct-weapon") {
      const matches = scan.observedRoutes.filter(
        (observed) =>
          observed.rootUuid === sources[0] &&
          observed.terminal?.kind === "dynamic" &&
          orderedSubsequence(sources.slice(0, 1), observed.nodeUuids),
      );
      if (matches.length === 0) {
        throw new Error(
          "Unsupported physical-grant route ancient-elf-giant-instinct-weapon lost its Ancient Elf dynamic source relationship.",
        );
      }
      continue;
    }
    if (route.terminalSourceUuids.length > 0) {
      for (const terminalUuid of route.terminalSourceUuids) {
        const matches = scan.observedRoutes.filter(
          (observed) =>
            observed.rootUuid === sources[0] &&
            observed.terminal?.kind === "equipment" &&
            observed.terminal.uuid === terminalUuid &&
            orderedSubsequence(sources, observed.nodeUuids),
        );
        if (matches.length === 0) {
          throw new Error(
            `Unsupported physical-grant route ${route.routeId} has no discovered source relationship to ${terminalUuid}.`,
          );
        }
        for (const observed of matches) claim(observed, route.routeId);
      }
      continue;
    }
    const matches = scan.observedRoutes.filter(
      (observed) =>
        observed.rootUuid === sources[0] &&
        observed.terminal?.kind === "dynamic" &&
        orderedSubsequence(sources, observed.nodeUuids),
    );
    if (matches.length === 0) {
      throw new Error(
        `Unsupported physical-grant route ${route.routeId} has no discovered dynamic source relationship.`,
      );
    }
    for (const observed of matches) claim(observed, route.routeId);
  }
  if (claimedRouteKeys.size !== expectedClaimCount) {
    throw new Error(
      `Unsupported physical-grant discovery claim count ${claimedRouteKeys.size} does not match ${expectedClaimCount}.`,
    );
  }
}

function orderedSubsequence(expected, actual) {
  let cursor = 0;
  for (const value of actual) {
    if (value === expected[cursor]) cursor += 1;
  }
  return cursor === expected.length;
}

function requireObservedRoute(observedRoutes, { label, nodes, terminalKind, terminalUuid }) {
  const matches = observedRoutes.filter(
    (route) =>
      stableJson(route.nodeUuids) === stableJson(nodes) &&
      route.terminal?.kind === terminalKind &&
      (terminalUuid === undefined || route.terminal?.uuid === terminalUuid),
  );
  if (matches.length !== 1) {
    throw new Error(`PF2E discovery needs exactly one reviewed ${label} route; found ${matches.length}.`);
  }
}

function requireDocument(byUuid, uuid, label) {
  const document = byUuid.get(uuid);
  if (!document) throw new Error(`${label} references missing PF2E source ${uuid}.`);
  return document;
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const entry of value) collectStrings(entry, output);
  else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, output);
  }
  return output;
}

export function renderPhysicalGrantReport(registry) {
  assertPhysicalGrantRegistry(registry);
  const routes = [...registry.routes].sort((left, right) =>
    left.routeId < right.routeId ? -1 : left.routeId > right.routeId ? 1 : 0,
  );
  const counts = new Map(CLASSIFICATIONS.map((classification) => [classification, 0]));
  for (const route of routes) counts.set(route.classification, counts.get(route.classification) + 1);

  const lines = [
    "<!-- Generated by tools/pf2e-grant-coverage/registry.mjs. Do not edit. -->",
    "",
    `# PF2E ${registry.source.pf2eVersion} level-1 physical-grant coverage`,
    "",
    `Registry \`${registry.registryId}\`, schema ${registry.schemaVersion}, pins PF2E \`${registry.source.pf2eVersion}\` at \`${registry.source.commit}\` under \`${registry.source.packRoot}\`.`,
    "",
    "This registry is a source-pack compatibility gate. Supported routes still require separate live Foundry qualification; every other reviewed physical-grant route hands off before review.",
    "",
    "## Coverage summary",
    "",
    "| Classification | Routes |",
    "| --- | ---: |",
    ...CLASSIFICATIONS.map(
      (classification) => `| \`${classification}\` | ${counts.get(classification)} |`,
    ),
    "",
    "## Reviewed routes",
    "",
    "| Route | Source path | Physical endpoint | Classification | Runtime disposition | Source policy |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const route of routes) {
    const sourcePath = route.nodes.map(formatUuid).join(" &rarr; ");
    const terminals =
      route.terminalSourceUuids.length > 0
        ? route.terminalSourceUuids.map(formatUuid).join("<br>")
        : "Dynamic or prose-only";
    const disposition =
      route.classification === "unsupported-handoff"
        ? `\`${escapeTable(route.blocker.reasonCode)}\`: ${escapeTable(route.blocker.detail)}`
        : `\`${escapeTable(route.profileId)}\` via \`${escapeTable(route.materializer)}\``;
    const sourcePolicy = route.sourcePolicy ? `\`${escapeTable(route.sourcePolicy)}\`` : "Not specified";
    lines.push(
      `| **${escapeTable(route.label)}**<br><code>${escapeTable(route.routeId)}</code> | ${sourcePath} | ${terminals} | \`${route.classification}\` | ${disposition} | ${sourcePolicy} |`,
    );
  }

  lines.push(
    "",
    "## Discovery snapshot",
    "",
    `Scanner version ${registry.discovery.scannerVersion} records ${registry.discovery.observationKeys.length} source observations and ${registry.discovery.routeKeys.length} reviewed grant-discovery route keys. Live verification compares both sets bidirectionally, so additions and stale registry entries both fail.`,
  );
  if (Array.isArray(registry.scanBoundary.exclusions) && registry.scanBoundary.exclusions.length > 0) {
    lines.push("", "Declared exclusions:", "", ...registry.scanBoundary.exclusions.map((entry) => `- ${entry}`));
  }
  lines.push(
    "",
    "`unclassifiedAdditions` is empty. A source change must be explicitly classified before this gate can pass.",
    "",
  );
  return lines.join("\n");
}

export async function generatePhysicalGrantCoverage({
  registryPath = DEFAULT_PHYSICAL_GRANT_REGISTRY_PATH,
  pf2eRepo,
  requireSource = false,
  resolveSourceRepo = resolvePhysicalGrantSourceRepo,
} = {}) {
  const registry = await readPhysicalGrantRegistry(registryPath);
  const resolvedPf2eRepo = pf2eRepo || (requireSource ? await resolveSourceRepo() : "");
  if (requireSource && !resolvedPf2eRepo) {
    throw new Error(
      "Physical-grant source verification is required. Set PF2E_REPO or pass --pf2e-repo <path>.",
    );
  }
  const scan = resolvedPf2eRepo
    ? await verifyPhysicalGrantRegistryAgainstPf2e({ registry, pf2eRepo: resolvedPf2eRepo })
    : null;
  return { registry, report: renderPhysicalGrantReport(registry), scan };
}

export function assertPhysicalGrantReportCurrent(actual, expected) {
  if (normalizeLineEndings(actual) !== normalizeLineEndings(expected)) {
    throw new Error(
      "Generated physical-grant coverage report is stale. Run npm run generate:physical-grants and commit the result.",
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const { registry, report } = await generatePhysicalGrantCoverage(options);
  if (options.check) {
    const existing = await readFile(options.reportPath, "utf8").catch(() => "");
    assertPhysicalGrantReportCurrent(existing, report);
    const liveSuffix = options.pf2eRepo || options.requireSource ? " and live PF2E source" : "";
    console.log(
      `Physical-grant registry/report${liveSuffix} are current for PF2E ${registry.source.pf2eVersion}.`,
    );
    return;
  }
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, report, "utf8");
  console.log(`Generated ${path.relative(repoRoot, options.reportPath)}.`);
}

function parseArgs(argv) {
  const options = {
    check: false,
    help: false,
    pf2eRepo: "",
    registryPath: DEFAULT_PHYSICAL_GRANT_REGISTRY_PATH,
    reportPath: DEFAULT_PHYSICAL_GRANT_REPORT_PATH,
    requireSource: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--require-source") options.requireSource = true;
    else if (["--out", "--pf2e-repo", "--registry"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--out") options.reportPath = path.resolve(value);
      if (arg === "--pf2e-repo") options.pf2eRepo = path.resolve(value);
      if (arg === "--registry") options.registryPath = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return `Usage: node tools/pf2e-grant-coverage/registry.mjs [options]\n\nOptions:\n  --check               Fail if the generated Markdown report is stale.\n  --require-source      Require live PF2E verification; resolve PF2E_REPO or a conventional sibling.\n  --pf2e-repo <path>    Verify the exact clean Git pin and bidirectional scanner snapshot.\n  --registry <path>     Read a different registry JSON file.\n  --out <path>          Write or check a different Markdown report.\n  --help                Show this help.\n`;
}

function assertCanonicalStringSet(value, label) {
  assertStringArray(value, label, { nonempty: true });
  const canonical = [...new Set(value)].sort();
  if (canonical.length !== value.length) throw new Error(`${label} must not contain duplicates.`);
  if (canonical.some((entry, index) => entry !== value[index])) {
    throw new Error(`${label} must be sorted lexicographically.`);
  }
}

function assertUuidArray(value, label, options = {}) {
  if (!Array.isArray(value) || (options.nonempty && value.length === 0)) {
    throw new Error(`${label} must be ${options.nonempty ? "a nonempty" : "an"} array.`);
  }
  for (const uuid of value) assertUuid(uuid, label);
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates.`);
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !/^Compendium\.pf2e\.[^.]+\.Item\.[A-Za-z0-9]{16}$/u.test(value)) {
    throw new Error(`${label} contains a noncanonical PF2E item UUID.`);
  }
}

function assertStringArray(value, label, options = {}) {
  if (
    !Array.isArray(value) ||
    (options.nonempty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new Error(`${label} must be an array of nonempty strings.`);
  }
}

function assertNonnegativeIntegerRecord(value, label) {
  assertRecord(value, label);
  if (
    Object.keys(value).length === 0 ||
    Object.values(value).some((entry) => !Number.isInteger(entry) || entry < 0)
  ) {
    throw new Error(`${label} must map names to nonnegative integers.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`${label} keys must be exactly: ${expected.join(", ")}.`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function formatUuid(uuid) {
  const match = /^Compendium\.pf2e\.([^.]+)\.Item\.([A-Za-z0-9]{16})$/u.exec(uuid);
  return match ? `<code>${escapeTable(match[1])}:${escapeTable(match[2])}</code>` : `<code>${escapeTable(uuid)}</code>`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/gu, "\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
