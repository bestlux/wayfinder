#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACK_ROOT = "packs/pf2e";
const DISCOVERY_VERSION = 1;
export const PHYSICAL_GRANT_DISCOVERY_VERSION = DISCOVERY_VERSION;
const ROOT_PACKS = Object.freeze([
  ["classes", "class"],
  ["ancestries", "ancestry"],
  ["backgrounds", "background"],
  ["heritages", "heritage"],
  ["feats-srd", "feat"],
]);

/**
 * Discover the complete level-one source graph that can participate in an item
 * grant, then reduce it to physical equipment paths and unresolved dynamic
 * grant candidates. The observation list deliberately includes non-physical
 * GrantItem and ChoiceSet rules: a new rule in an existing document must alter
 * the reviewed snapshot even when pack counts do not.
 */
export async function discoverPhysicalGrantRoutes({
  pf2eRepo,
  packRoot = DEFAULT_PACK_ROOT,
} = {}) {
  if (typeof pf2eRepo !== "string" || pf2eRepo.length === 0) {
    throw new Error("PF2E grant discovery requires a pf2eRepo path.");
  }

  const corpus = await createCorpus(path.resolve(pf2eRepo), packRoot);
  const roots = await loadRoots(corpus);
  const featureSeeds = await loadLevelOneFeatureSeeds(corpus);
  const extractionCache = new Map();
  const reachable = new Set();
  const observations = new Map();
  const graph = new Map();
  const unresolvedReferences = new Set();
  const queue = [...roots, ...featureSeeds];

  while (queue.length > 0) {
    const document = queue.shift();
    if (!document || reachable.has(document.uuid)) continue;
    reachable.add(document.uuid);
    if (document.pack === "equipment-srd") continue;

    const extraction = await extractDocumentGrantMaterial(document, corpus, extractionCache);
    graph.set(document.uuid, extraction.edges);
    for (const observation of extraction.observations) observations.set(observation.key, observation);
    for (const reference of extraction.unresolvedReferences) unresolvedReferences.add(reference);
    for (const edge of extraction.edges) {
      if (!edge.targetUuid) continue;
      const target = await corpus.getByUuid(edge.targetUuid);
      if (target && target.pack !== "equipment-srd" && !reachable.has(target.uuid)) queue.push(target);
    }
  }

  const observedRoutes = buildRoutes({ graph, roots: [...roots, ...featureSeeds] });
  const observationList = [...observations.values()].sort(compareByKey);

  return {
    discoveryVersion: DISCOVERY_VERSION,
    source: {
      packRoot,
      pf2eVersion: corpus.manifest.version ?? "unknown",
    },
    roots: roots.map(({ family, name, uuid }) => ({ family, name, uuid })),
    featureSeeds: featureSeeds.map(({ family, name, uuid }) => ({ family, name, uuid })),
    reachableDocumentUuids: [...reachable].sort(),
    observations: observationList,
    observationKeys: observationList.map(({ key }) => key),
    observedRoutes,
    routeKeys: observedRoutes.map(({ routeKey }) => routeKey),
    unresolvedReferences: [...unresolvedReferences].sort(),
  };
}

/**
 * Compare discovery against the pinned registry snapshot. Arrays are exact
 * sets: both upstream additions and stale registry entries are findings.
 */
export function diffPhysicalGrantRoutes({ discovery, registry }) {
  assertRecord(discovery, "PF2E grant discovery");
  assertRecord(registry, "PF2E physical-grant registry");
  assertNoUnresolvedReferences(discovery);
  if (
    typeof registry.source?.pf2eVersion === "string" &&
    discovery.source?.pf2eVersion !== registry.source.pf2eVersion
  ) {
    throw new Error(
      `PF2E grant discovery version ${discovery.source?.pf2eVersion ?? "missing"} does not match ${registry.source.pf2eVersion}.`,
    );
  }
  if (
    typeof registry.source?.packRoot === "string" &&
    discovery.source?.packRoot !== registry.source.packRoot
  ) {
    throw new Error(
      `PF2E grant discovery pack root ${discovery.source?.packRoot ?? "missing"} does not match ${registry.source.packRoot}.`,
    );
  }
  const expected = readRegistryDiscovery(registry);
  if (expected.scannerVersion !== DISCOVERY_VERSION) {
    throw new Error(
      `PF2E grant registry scanner version ${expected.scannerVersion ?? "missing"} does not match ${DISCOVERY_VERSION}.`,
    );
  }

  const observedObservationKeys = requireStringSet(
    discovery.observationKeys,
    "discovery observationKeys",
  );
  const observedRouteKeys = requireStringSet(discovery.routeKeys, "discovery routeKeys");
  const expectedObservationKeys = requireStringSet(
    expected.observationKeys,
    "registry discovery observationKeys",
  );
  const expectedRouteKeys = requireStringSet(expected.routeKeys, "registry discovery routeKeys");

  return {
    unexpectedObservationKeys: setDifference(observedObservationKeys, expectedObservationKeys),
    missingObservationKeys: setDifference(expectedObservationKeys, observedObservationKeys),
    unexpectedRouteKeys: setDifference(observedRouteKeys, expectedRouteKeys),
    missingRouteKeys: setDifference(expectedRouteKeys, observedRouteKeys),
  };
}

export function createPhysicalGrantDiscoverySnapshot(discovery) {
  assertRecord(discovery, "PF2E grant discovery");
  assertNoUnresolvedReferences(discovery);
  const observationKeys = [...requireStringSet(discovery.observationKeys, "discovery observationKeys")].sort();
  const routeKeys = [...requireStringSet(discovery.routeKeys, "discovery routeKeys")].sort();
  return { observationKeys, routeKeys, scannerVersion: DISCOVERY_VERSION };
}

export function assertPhysicalGrantRouteDiff(findings) {
  assertRecord(findings, "PF2E grant discovery findings");
  const entries = [
    ["unexpected source observations", findings.unexpectedObservationKeys],
    ["missing source observations", findings.missingObservationKeys],
    ["unexpected physical routes", findings.unexpectedRouteKeys],
    ["missing physical routes", findings.missingRouteKeys],
  ];
  const failures = entries.filter(([, values]) => Array.isArray(values) && values.length > 0);
  if (failures.length === 0) return;

  const details = failures
    .map(([label, values]) => `${label}: ${values.slice(0, 5).join(", ")}${values.length > 5 ? ` (+${values.length - 5} more)` : ""}`)
    .join("; ");
  throw new Error(`PF2E physical-grant discovery differs from the reviewed registry: ${details}.`);
}

/**
 * Integration entry point for the coverage registry orchestrator.
 */
export async function scanPf2eGrantCoverage({
  pf2eRepo,
  registry,
  packRoot = registry?.source?.packRoot ?? DEFAULT_PACK_ROOT,
  failOnDiff = true,
} = {}) {
  const discovery = await discoverPhysicalGrantRoutes({ pf2eRepo, packRoot });
  const findings = registry ? diffPhysicalGrantRoutes({ discovery, registry }) : null;
  if (findings && failOnDiff) assertPhysicalGrantRouteDiff(findings);
  return { ...discovery, findings };
}

async function createCorpus(pf2eRepo, packRoot) {
  const manifest = JSON.parse(await readFile(path.join(pf2eRepo, "system.pf2e.json"), "utf8"));
  const sourceRoot = path.join(pf2eRepo, ...packRoot.split("/"));
  const packDirectories = new Map(
    (manifest.packs ?? [])
      .filter((pack) => pack?.type === "Item" && typeof pack?.name === "string")
      .map((pack) => [pack.name, path.join(sourceRoot, path.basename(pack.path))]),
  );
  const loadedPacks = new Map();
  const byUuid = new Map();
  const aliases = new Map();

  async function loadPack(pack) {
    if (loadedPacks.has(pack)) return loadedPacks.get(pack);
    const directory = packDirectories.get(pack);
    if (!directory) {
      loadedPacks.set(pack, []);
      return [];
    }
    const documents = [];
    for (const file of await listJsonFiles(directory)) {
      if (path.basename(file) === "_folders.json") continue;
      const source = JSON.parse(await readFile(file, "utf8"));
      if (Array.isArray(source) || typeof source?._id !== "string" || typeof source?.name !== "string") {
        throw new Error(`PF2E source ${file} is not a single named document.`);
      }
      const document = {
        ...source,
        pack,
        sourcePath: path.relative(pf2eRepo, file).replaceAll("\\", "/"),
        uuid: `Compendium.pf2e.${pack}.Item.${source._id}`,
      };
      if (byUuid.has(document.uuid)) throw new Error(`Duplicate PF2E source UUID ${document.uuid}.`);
      if (aliases.has(`${pack}:${source.name}`)) {
        throw new Error(`Duplicate PF2E source name ${source.name} in ${pack}.`);
      }
      documents.push(document);
      byUuid.set(document.uuid, document);
      aliases.set(`${pack}:${source._id}`, document.uuid);
      aliases.set(`${pack}:${source.name}`, document.uuid);
    }
    documents.sort((left, right) => left.uuid.localeCompare(right.uuid));
    loadedPacks.set(pack, documents);
    return documents;
  }

  async function resolveReference(reference) {
    const parsed = parseCompendiumReference(reference);
    if (!parsed) return null;
    await loadPack(parsed.pack);
    return aliases.get(`${parsed.pack}:${parsed.token}`) ?? null;
  }

  async function getByUuid(uuid) {
    const parsed = parseCompendiumReference(uuid);
    if (!parsed) return null;
    await loadPack(parsed.pack);
    const canonicalUuid = aliases.get(`${parsed.pack}:${parsed.token}`) ?? uuid;
    return byUuid.get(canonicalUuid) ?? null;
  }

  return { getByUuid, loadPack, manifest, resolveReference };
}

async function loadRoots(corpus) {
  const roots = [];
  for (const [pack, family] of ROOT_PACKS) {
    const documents = await corpus.loadPack(pack);
    for (const document of documents) {
      if (family === "feat" && !isLevelOneFeat(document)) continue;
      roots.push({ ...document, family });
    }
  }
  return roots.sort((left, right) => left.uuid.localeCompare(right.uuid));
}

async function loadLevelOneFeatureSeeds(corpus) {
  const seeds = [];
  for (const [pack, family] of [
    ["classfeatures", "class-feature"],
    ["ancestryfeatures", "ancestry-feature"],
  ]) {
    for (const document of await corpus.loadPack(pack)) {
      const level = Number(document.system?.level?.value);
      if (Number.isFinite(level) && level > 1) continue;
      seeds.push({ ...document, family });
    }
  }
  return seeds.sort((left, right) => left.uuid.localeCompare(right.uuid));
}

function isLevelOneFeat(document) {
  const level = Number(document.system?.level?.value);
  return document.type === "feat" && Number.isFinite(level) && level <= 1;
}

async function extractDocumentGrantMaterial(document, corpus, cache) {
  const cached = cache.get(document.uuid);
  if (cached) return cached;

  const observations = [];
  const edges = [];
  const unresolvedReferences = [];
  const items = document.system?.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    for (const [entryKey, entry] of Object.entries(items).sort(([left], [right]) => left.localeCompare(right))) {
      if (!entry || typeof entry !== "object" || !isLevelOneEmbeddedItem(entry)) continue;
      const material = {
        entryKey,
        level: entry.level ?? null,
        name: entry.name ?? null,
        uuid: entry.uuid ?? null,
      };
      const observation = createObservation("system.items", document.uuid, entryKey, material);
      observations.push(observation);
      if (typeof entry.uuid !== "string") continue;
      const targetUuid = await corpus.resolveReference(entry.uuid);
      if (!targetUuid) unresolvedReferences.push(`${document.uuid}|system.items|${entry.uuid}`);
      edges.push({
        edgeKey: createEdgeKey("system.items", document.uuid, observation.key, targetUuid ?? entry.uuid),
        kind: "system.items",
        observationKeys: [observation.key],
        sourceUuid: document.uuid,
        targetReference: entry.uuid,
        targetUuid,
      });
    }
  }

  const rules = Array.isArray(document.system?.rules) ? document.system.rules : [];
  const choiceRules = [];
  const grantRules = [];
  for (const [ruleIndex, rule] of rules.entries()) {
    if (!rule || !["ChoiceSet", "GrantItem"].includes(rule.key)) continue;
    const material = projectRuleMaterial(rule);
    const observation = createObservation(rule.key, document.uuid, String(ruleIndex), material);
    observations.push(observation);
    if (rule.key === "ChoiceSet") choiceRules.push({ observation, rule, ruleIndex });
    else grantRules.push({ observation, rule, ruleIndex });
  }

  for (const grant of grantRules) {
    const reference = grant.rule.uuid;
    if (typeof reference === "string" && isStaticCompendiumReference(reference)) {
      const targetUuid = await corpus.resolveReference(reference);
      if (!targetUuid) unresolvedReferences.push(`${document.uuid}|rules.${grant.ruleIndex}|${reference}`);
      edges.push({
        edgeKey: createEdgeKey("GrantItem", document.uuid, grant.observation.key, targetUuid ?? reference),
        kind: "GrantItem",
        observationKeys: [grant.observation.key],
        ruleIndex: grant.ruleIndex,
        sourceUuid: document.uuid,
        targetReference: reference,
        targetUuid,
      });
      continue;
    }

    const selectionFlag = extractSelectionFlag(reference);
    const choices = choiceRules.filter((choice) => selectionFlag && choice.rule.flag === selectionFlag);
    const staticTargets = [];
    for (const choice of choices) {
      for (const candidate of collectCompendiumReferences(choice.rule.choices)) {
        const targetUuid = await corpus.resolveReference(candidate);
        if (!targetUuid) {
          unresolvedReferences.push(`${document.uuid}|rules.${choice.ruleIndex}|${candidate}`);
          continue;
        }
        staticTargets.push({ choice, reference: candidate, targetUuid });
      }
    }

    for (const { choice, reference: targetReference, targetUuid } of dedupeByKey(
      staticTargets.map((target) => ({
        ...target,
        key: `${target.choice.observation.key}|${target.targetUuid}`,
      })),
      "key",
    )) {
      const observationKeys = [choice.observation.key, grant.observation.key].sort();
      edges.push({
        choiceRuleIndex: choice.ruleIndex,
        edgeKey: createEdgeKey("ChoiceSet+GrantItem", document.uuid, observationKeys.join("+"), targetUuid),
        kind: "ChoiceSet+GrantItem",
        observationKeys,
        ruleIndex: grant.ruleIndex,
        sourceUuid: document.uuid,
        targetReference,
        targetUuid,
      });
    }

    const hasUnresolvedChoiceValue = choices.some(({ rule }) =>
      collectChoiceValues(rule.choices).some((value) => !isStaticCompendiumReference(value)),
    );
    const hasUnboundedChoice =
      choices.length === 0 ||
      choices.some((choice) => !Array.isArray(choice.rule.choices) || choice.rule.allowedDrops) ||
      hasUnresolvedChoiceValue;
    if (hasUnboundedChoice) {
      const observationKeys = [grant.observation.key, ...choices.map(({ observation }) => observation.key)].sort();
      const dynamicSignature = `dynamic:${sha256(
        stableStringify({
          choices: choices.map(({ rule }) => projectRuleMaterial(rule)),
          grant: projectRuleMaterial(grant.rule),
          sourceUuid: document.uuid,
        }),
      )}`;
      edges.push({
        dynamicSignature,
        edgeKey: createEdgeKey(
          "ChoiceSet+GrantItem",
          document.uuid,
          observationKeys.join("+"),
          dynamicSignature,
        ),
        kind: choices.length > 0 ? "ChoiceSet+GrantItem" : "GrantItem",
        observationKeys,
        ruleIndex: grant.ruleIndex,
        sourceUuid: document.uuid,
        targetReference: typeof reference === "string" ? reference : null,
        targetUuid: null,
      });
    }
  }

  const extraction = {
    edges: dedupeByKey(edges, "edgeKey"),
    observations: dedupeByKey(observations, "key"),
    unresolvedReferences: [...new Set(unresolvedReferences)].sort(),
  };
  cache.set(document.uuid, extraction);
  return extraction;
}

function buildRoutes({ graph, roots }) {
  const routes = new Map();
  for (const root of roots) {
    visit({
      edgePath: [],
      graph,
      nodePath: [root.uuid],
      root,
      routes,
      visited: new Set([root.uuid]),
    });
  }
  return [...routes.values()].sort(compareByRouteKey);
}

function visit({ edgePath, graph, nodePath, root, routes, visited }) {
  for (const edge of graph.get(nodePath.at(-1)) ?? []) {
    const nextEdges = [...edgePath, edge];
    if (edge.dynamicSignature) {
      addRoute(routes, root, nodePath, nextEdges, {
        kind: "dynamic",
        signature: edge.dynamicSignature,
      });
      continue;
    }
    if (!edge.targetUuid) continue;
    const targetPack = parseCompendiumReference(edge.targetUuid)?.pack;
    const nextNodes = [...nodePath, edge.targetUuid];
    if (targetPack === "equipment-srd") {
      addRoute(routes, root, nextNodes, nextEdges, { kind: "equipment", uuid: edge.targetUuid });
      continue;
    }
    if (visited.has(edge.targetUuid)) continue;
    visit({
      edgePath: nextEdges,
      graph,
      nodePath: nextNodes,
      root,
      routes,
      visited: new Set([...visited, edge.targetUuid]),
    });
  }
}

function addRoute(routes, root, nodeUuids, edges, terminal) {
  const terminalKey = terminal.kind === "equipment" ? terminal.uuid : terminal.signature;
  const pathDigest = sha256(edges.map(({ edgeKey }) => edgeKey).join("\n")).slice(0, 20);
  const routeKey = ["physical-route-v1", root.family, root.uuid, terminal.kind, terminalKey, pathDigest].join("|");
  routes.set(routeKey, {
    edgeKeys: edges.map(({ edgeKey }) => edgeKey),
    nodeUuids,
    rootFamily: root.family,
    rootName: root.name,
    rootUuid: root.uuid,
    routeKey,
    terminal,
  });
}

function createObservation(kind, sourceUuid, position, material) {
  const materialJson = stableStringify(material);
  return {
    key: [`source-observation-v1`, sourceUuid, kind, position, sha256(materialJson).slice(0, 24)].join("|"),
    kind,
    material,
    position,
    sourceUuid,
  };
}

function createEdgeKey(kind, sourceUuid, observationIdentity, targetIdentity) {
  return [
    "grant-edge-v1",
    sourceUuid,
    kind,
    sha256(`${observationIdentity}\n${targetIdentity}`).slice(0, 24),
  ].join("|");
}

function projectRuleMaterial(rule) {
  return Object.fromEntries(
    Object.entries(rule).filter(([key]) => !["label", "prompt"].includes(key)),
  );
}

function isLevelOneEmbeddedItem(entry) {
  const level = Number(entry.level);
  return !Number.isFinite(level) || level <= 1;
}

function isStaticCompendiumReference(value) {
  if (typeof value !== "string") return false;
  if (value.startsWith("@UUID[")) return parseCompendiumReference(value) !== null;
  return !value.includes("{") && parseCompendiumReference(value) !== null;
}

function parseCompendiumReference(value) {
  if (typeof value !== "string") return null;
  const match = /^(?:@UUID\[)?Compendium\.pf2e\.([^.]+)\.Item\.([^\]]+?)(?:\](?:\{.*\})?)?$/u.exec(value);
  return match ? { pack: match[1], token: match[2] } : null;
}

function extractSelectionFlag(value) {
  if (typeof value !== "string") return null;
  return /rulesSelections\.([A-Za-z0-9_-]+)/u.exec(value)?.[1] ?? null;
}

function collectCompendiumReferences(value, output = []) {
  if (typeof value === "string") {
    if (isStaticCompendiumReference(value)) output.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectCompendiumReferences(entry, output);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectCompendiumReferences(entry, output);
  }
  return [...new Set(output)].sort();
}

function collectChoiceValues(choices) {
  if (!Array.isArray(choices)) return [];
  return choices
    .flatMap((choice) => {
      if (typeof choice === "string") return [choice];
      return typeof choice?.value === "string" ? [choice.value] : [];
    })
    .sort();
}

function readRegistryDiscovery(registry) {
  const discovery = registry.discovery ?? registry.scanBoundary?.discovery;
  assertRecord(discovery, "PF2E physical-grant registry discovery snapshot");
  return discovery;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireStringSet(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${label} must be an array of nonempty strings.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicate entries.`);
  return new Set(value);
}

function assertNoUnresolvedReferences(discovery) {
  if (!Array.isArray(discovery.unresolvedReferences)) {
    throw new Error("discovery unresolvedReferences must be an array.");
  }
  if (discovery.unresolvedReferences.length > 0) {
    throw new Error(
      `PF2E grant discovery contains unresolved static references: ${discovery.unresolvedReferences.slice(0, 5).join(", ")}.`,
    );
  }
}

function setDifference(left, right) {
  return [...left].filter((entry) => !right.has(entry)).sort();
}

function dedupeByKey(values, key) {
  return [...new Map(values.map((value) => [value[key], value])).values()].sort((left, right) =>
    left[key].localeCompare(right[key]),
  );
}

function compareByKey(left, right) {
  return left.key.localeCompare(right.key);
}

function compareByRouteKey(left, right) {
  return left.routeKey.localeCompare(right.routeKey);
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

async function listJsonFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await listJsonFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) output.push(entryPath);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = options.registryPath
    ? JSON.parse(await readFile(options.registryPath, "utf8"))
    : undefined;
  const result = await scanPf2eGrantCoverage({
    failOnDiff: options.failOnDiff,
    pf2eRepo: options.pf2eRepo,
    registry,
  });
  console.log(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = { failOnDiff: true, pf2eRepo: null, registryPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-fail") options.failOnDiff = false;
    else if (["--pf2e-repo", "--registry"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--pf2e-repo") options.pf2eRepo = path.resolve(value);
      else options.registryPath = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.pf2eRepo) {
    throw new Error("Usage: node tools/pf2e-grant-coverage/scan.mjs --pf2e-repo <path> [--registry <path>] [--no-fail]");
  }
  return options;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
