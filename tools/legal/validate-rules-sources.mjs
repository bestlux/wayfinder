#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const REQUIRED_LEGAL_FILES = [
  "LEGAL.md",
  "LICENSE.md",
  "licenses/ORC-NOTICE.md",
  "licenses/OPEN-GAME-LICENSE-1.0A.md",
  "licenses/THIRD-PARTY-NOTICES.md",
  "licenses/rules-sources.json",
];

const ALLOWED_LICENSES = new Set(["ORC", "OGL-1.0a"]);
const NOTICE_FILE_BY_LICENSE = new Map([
  ["ORC", "licenses/ORC-NOTICE.md"],
  ["OGL-1.0a", "licenses/OPEN-GAME-LICENSE-1.0A.md"],
]);
const EXPECTED_DOWNSTREAM_ATTRIBUTION = "Wayfinder Game Mechanics © 2026 iomancer.";
const EXPECTED_LEDGER_IDENTITY_SHA256 = "8354b8017f4f4e09e3681c385c024617a33fa2d9e986c4b7fb8a21c295492893";
const EXPECTED_WORKS = new Map([
  ["player-core", ["Pathfinder Player Core", "ORC"]],
  ["gm-core", ["Pathfinder GM Core", "ORC"]],
  ["player-core-2", ["Pathfinder Player Core 2", "ORC"]],
  ["war-of-immortals", ["Pathfinder War of Immortals", "ORC"]],
  ["rage-of-elements", ["Pathfinder Rage of Elements", "ORC"]],
  ["guns-gears-remastered", ["Pathfinder Guns & Gears Remastered", "ORC"]],
  ["divine-mysteries", ["Pathfinder Lost Omens Divine Mysteries", "ORC"]],
  ["impossible-magic", ["Pathfinder Impossible Magic", "ORC"]],
  ["dark-archive-remastered", ["Pathfinder Dark Archive (Remastered)", "ORC"]],
  ["core-rulebook", ["Pathfinder Core Rulebook (Second Edition)", "OGL-1.0a"]],
  ["gamemastery-guide", ["Pathfinder Gamemastery Guide", "OGL-1.0a"]],
  ["secrets-of-magic", ["Secrets of Magic", "OGL-1.0a"]],
  ["dark-archive", ["Pathfinder Dark Archive", "OGL-1.0a"]],
  ["lost-omens-character-guide", ["Pathfinder Lost Omens Character Guide (Second Edition)", "OGL-1.0a"]],
  ["lost-omens-ancestry-guide", ["Pathfinder Lost Omens Ancestry Guide (Second Edition)", "OGL-1.0a"]],
  ["book-of-the-dead", ["Pathfinder Book of the Dead", "OGL-1.0a"]],
  ["adventure-path-151", ["Pathfinder Adventure Path #151: The Show Must Go On", "OGL-1.0a"]],
]);
const EXPECTED_CAPABILITY_IDS = new Set([
  "core-character-progression",
  "core-build-and-language-allocation",
  "free-archetype-variant",
  "archetype-dedication-legality",
  "character-wealth",
  "player-core-casters-and-feats",
  "player-core-2-casters",
  "animist-spellcasting",
  "kineticist-gate-element-context",
  "divine-mysteries-class-archetypes",
  "spellshot-class-archetype",
  "necromancer-dirge",
  "gradual-ability-boosts",
  "legacy-voluntary-flaws",
  "clan-dagger-manual-grant",
  "feat-innate-arcane-cantrip-grants",
  "magus-spellcasting",
  "summoner-spellcasting",
  "psychic-spellcasting",
  "pf2e-runtime-schema-adapter",
  "public-rule-parser-fixtures",
  "repeatable-and-heightened-selection-policy",
]);
const EXPECTED_ASSET_IDS = new Set([
  "wayfinder-entry-icon",
  "wayfinder-css-frame",
  "legacy-release-listing-media",
  "wayfinder-project-name",
  "wayfinder-ui-trade-dress",
]);
const EXPECTED_RELEASE_BLOCKER_IDS = new Set([
  "verify-complete-ogl-section-15-chain",
  "verify-guns-gears-remastered-notice",
  "verify-impossible-magic-notice",
  "verify-dark-archive-remastered-notice",
  "resolve-mixed-caster-provenance",
  "resolve-orc-ogl-product-scope",
  "resolve-rage-of-elements-metadata-conflict",
  "complete-hardcoded-rules-and-fixture-audit",
  "clear-wayfinder-project-name",
  "review-wayfinder-ui-trade-dress",
]);
const APPROVED_EVIDENCE_HOSTS = new Set([
  "2e.aonprd.com",
  "github.com",
  "ised-isde.canada.ca",
  "paizo.com",
  "store.paizo.com",
  "tsdr.uspto.gov",
  "www.paizo.com",
]);
const REQUIRED_OGL_NOTICE_PARTS = [
  "The complete inherited Section 15 chain has not yet been verified",
  "Pathfinder Core Rulebook (Second Edition) © 2019, Paizo Inc.; Designers:",
];
const RELEASE_BLOCKING_NOTICE_PARTS = new Map([
  ["LEGAL.md", ["The current compliance ledger is intentionally **release blocked**"]],
  ["licenses/ORC-NOTICE.md", ["therefore blocks publication pending a product-wide licensing disposition"]],
  [
    "licenses/OPEN-GAME-LICENSE-1.0A.md",
    ["The complete inherited Section 15 chain has not yet been verified", "blocks publication"],
  ],
  ["licenses/THIRD-PARTY-NOTICES.md", ["remain under separate trademark and trade-dress review"]],
]);
const WORK_STATUSES = new Set(["verified", "notice-page-needed", "provenance-review"]);
const CAPABILITY_STATUSES = new Set(["resolved", "provenance-review", "counsel-review"]);
const ASSET_STATUSES = new Set([
  "resolved",
  "replace-before-release",
  "review-recommended",
  "counsel-review",
]);
const CUP_NOTICE_PARTS = [
  "uses trademarks and/or copyrights owned by Paizo Inc.",
  "used under Paizo's Community Use Policy (paizo.com/licenses/communityuse)",
  "expressly prohibited from charging you to use or access this content",
  "is not published, endorsed, or specifically approved by Paizo",
  "For more information about Paizo Inc. and Paizo products, visit paizo.com",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function uniqueStrings(values) {
  return Array.isArray(values) && values.every(isNonEmptyString) && new Set(values).size === values.length;
}

function sortedStrings(values) {
  return Array.isArray(values) ? [...values].sort() : [];
}

export function reviewedLedgerIdentitySha256(ledger) {
  const identity = {
    traceabilityStatus: ledger?.traceabilityStatus,
    downstreamAttribution: ledger?.downstreamAttribution,
    works: (Array.isArray(ledger?.works) ? ledger.works : [])
      .map((work) => ({
        key: work?.key,
        title: work?.title,
        license: work?.license,
        noticeFile: work?.noticeFile,
        status: work?.status,
        attributionEvidence: sortedStrings(work?.attributionEvidence),
      }))
      .sort((left, right) => String(left.key).localeCompare(String(right.key))),
    capabilities: (Array.isArray(ledger?.capabilities) ? ledger.capabilities : [])
      .map((capability) => ({
        capabilityId: capability?.capabilityId,
        shipped: capability?.shipped,
        surfaceKind: capability?.surfaceKind,
        codeRefs: sortedStrings(capability?.codeRefs),
        sourceWorks: sortedStrings(capability?.sourceWorks),
        licenses: sortedStrings(capability?.licenses),
        status: capability?.status,
        provenanceEvidence: sortedStrings(capability?.provenanceEvidence),
      }))
      .sort((left, right) => String(left.capabilityId).localeCompare(String(right.capabilityId))),
    assets: (Array.isArray(ledger?.assets) ? ledger.assets : [])
      .map((asset) => ({
        assetId: asset?.assetId,
        shipped: asset?.shipped,
        paths: sortedStrings(asset?.paths),
        basis: asset?.basis,
        evidence: sortedStrings(asset?.evidence),
        status: asset?.status,
      }))
      .sort((left, right) => String(left.assetId).localeCompare(String(right.assetId))),
    releaseBlockers: (Array.isArray(ledger?.releaseBlockers) ? ledger.releaseBlockers : [])
      .map((blocker) => ({
        id: blocker?.id,
        status: blocker?.status,
        summary: blocker?.summary,
        resolution: blocker?.resolution,
        resolvedAt: blocker?.resolvedAt ?? null,
        resolutionEvidence: sortedStrings(blocker?.resolutionEvidence),
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function hasLocalAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("file:");
}

function isApprovedEvidenceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && APPROVED_EVIDENCE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function resolveRepositoryPath(rootDir, relativePath) {
  if (!isNonEmptyString(relativePath) || hasLocalAbsolutePath(relativePath)) return null;
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;

  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, normalized);
  const fromRoot = path.relative(root, resolved);
  return fromRoot && !fromRoot.startsWith("..") && !path.isAbsolute(fromRoot) ? resolved : null;
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function addUniqueKeyErrors(errors, values, label, keyOf) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    const key = keyOf(value);
    if (!isNonEmptyString(key)) {
      errors.push(`${label}[${index}] is missing its stable identifier.`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`${label} contains duplicate identifier ${key}.`);
    }
    seen.add(key);
  }
}

function addExactInventoryErrors(errors, actualKeys, expectedKeys, label) {
  for (const expectedKey of expectedKeys) {
    if (!actualKeys.has(expectedKey)) errors.push(`rules-sources.json is missing expected ${label} ${expectedKey}.`);
  }
  for (const actualKey of actualKeys) {
    if (!expectedKeys.has(actualKey)) errors.push(`rules-sources.json contains unreviewed ${label} ${actualKey}.`);
  }
}

async function readRequiredText(rootDir, relativePath, errors) {
  const absolutePath = resolveRepositoryPath(rootDir, relativePath);
  if (!absolutePath) {
    errors.push(`Legal file path must stay inside the repository: ${relativePath}.`);
    return "";
  }
  if (!(await pathExists(absolutePath))) {
    errors.push(`Missing required legal file: ${relativePath}.`);
    return "";
  }
  return readFile(absolutePath, "utf8");
}

export async function validateRulesSourceLedger(ledger, { rootDir = defaultRepoRoot, release = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!isRecord(ledger)) {
    return { errors: ["rules-sources.json must contain an object."], warnings, blockerIds: [] };
  }
  if (ledger.schemaVersion !== 1) errors.push("rules-sources.json schemaVersion must be 1.");
  if (!isNonEmptyString(ledger.project)) errors.push("rules-sources.json project must be a non-empty string.");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(ledger.lastVerified ?? "")) {
    errors.push("rules-sources.json lastVerified must be an ISO calendar date.");
  }
  if (ledger.downstreamAttribution !== EXPECTED_DOWNSTREAM_ATTRIBUTION) {
    errors.push(`rules-sources.json downstreamAttribution must be exactly "${EXPECTED_DOWNSTREAM_ATTRIBUTION}".`);
  }
  if (ledger.traceabilityStatus !== "partial-audit-release-blocked" && ledger.traceabilityStatus !== "complete") {
    errors.push("rules-sources.json traceabilityStatus must be partial-audit-release-blocked or complete.");
  }
  const ledgerIdentitySha256 = reviewedLedgerIdentitySha256(ledger);
  if (ledgerIdentitySha256 !== EXPECTED_LEDGER_IDENTITY_SHA256) {
    errors.push(
      `rules-sources.json reviewed inventory identity changed (expected ${EXPECTED_LEDGER_IDENTITY_SHA256}, observed ${ledgerIdentitySha256}).`
    );
  }

  const works = Array.isArray(ledger.works) ? ledger.works : [];
  const capabilities = Array.isArray(ledger.capabilities) ? ledger.capabilities : [];
  const assets = Array.isArray(ledger.assets) ? ledger.assets : [];
  const blockers = Array.isArray(ledger.releaseBlockers) ? ledger.releaseBlockers : [];
  if (!Array.isArray(ledger.works)) errors.push("rules-sources.json works must be an array.");
  if (!Array.isArray(ledger.capabilities)) errors.push("rules-sources.json capabilities must be an array.");
  if (!Array.isArray(ledger.assets)) errors.push("rules-sources.json assets must be an array.");
  if (!Array.isArray(ledger.releaseBlockers)) errors.push("rules-sources.json releaseBlockers must be an array.");
  if (works.length === 0) errors.push("rules-sources.json works inventory must not be empty.");
  if (capabilities.length === 0) errors.push("rules-sources.json capabilities inventory must not be empty.");
  if (assets.length === 0) errors.push("rules-sources.json assets inventory must not be empty.");
  if (ledger.traceabilityStatus === "partial-audit-release-blocked" && blockers.length === 0) {
    errors.push("A partial-audit-release-blocked ledger must identify at least one release blocker.");
  }

  addUniqueKeyErrors(errors, works, "works", (entry) => entry?.key);
  addUniqueKeyErrors(errors, capabilities, "capabilities", (entry) => entry?.capabilityId);
  addUniqueKeyErrors(errors, assets, "assets", (entry) => entry?.assetId);
  addUniqueKeyErrors(errors, blockers, "releaseBlockers", (entry) => entry?.id);

  const workKeys = new Set(works.map((entry) => entry?.key).filter(isNonEmptyString));
  const capabilityIds = new Set(capabilities.map((entry) => entry?.capabilityId).filter(isNonEmptyString));
  const assetIds = new Set(assets.map((entry) => entry?.assetId).filter(isNonEmptyString));
  const releaseBlockerIds = new Set(blockers.map((entry) => entry?.id).filter(isNonEmptyString));
  addExactInventoryErrors(errors, workKeys, new Set(EXPECTED_WORKS.keys()), "work inventory entry");
  addExactInventoryErrors(errors, capabilityIds, EXPECTED_CAPABILITY_IDS, "capability inventory entry");
  addExactInventoryErrors(errors, assetIds, EXPECTED_ASSET_IDS, "asset inventory entry");
  addExactInventoryErrors(errors, releaseBlockerIds, EXPECTED_RELEASE_BLOCKER_IDS, "release blocker entry");

  const licenseByWorkKey = new Map(works.map((entry) => [entry?.key, entry?.license]));
  const noticeCache = new Map();
  for (const work of works) {
    const label = `work ${work?.key ?? "<unknown>"}`;
    const expectedWork = EXPECTED_WORKS.get(work?.key);
    if (expectedWork) {
      const [expectedTitle, expectedLicense] = expectedWork;
      if (work.title !== expectedTitle) errors.push(`${label} title must be exactly "${expectedTitle}".`);
      if (work.license !== expectedLicense) errors.push(`${label} license must be exactly ${expectedLicense}.`);
      const expectedNoticeFile = NOTICE_FILE_BY_LICENSE.get(expectedLicense);
      if (work.noticeFile !== expectedNoticeFile) errors.push(`${label} noticeFile must be exactly ${expectedNoticeFile}.`);
    }
    if (!isNonEmptyString(work?.title)) errors.push(`${label} must have a title.`);
    if (!ALLOWED_LICENSES.has(work?.license)) errors.push(`${label} has unsupported license ${work?.license}.`);
    if (!WORK_STATUSES.has(work?.status)) errors.push(`${label} has unsupported status ${work?.status}.`);
    if (!isNonEmptyString(work?.noticeFile)) {
      errors.push(`${label} must identify its notice file.`);
    } else {
      const expectedNoticeFile = NOTICE_FILE_BY_LICENSE.get(work?.license);
      if (expectedNoticeFile && work.noticeFile !== expectedNoticeFile) {
        errors.push(`${label} must use ${expectedNoticeFile} for ${work.license} material.`);
      }
      let noticeText = noticeCache.get(work.noticeFile);
      if (noticeText === undefined) {
        noticeText = await readRequiredText(rootDir, work.noticeFile, errors);
        noticeCache.set(work.noticeFile, noticeText);
      }
      if (isNonEmptyString(work.title) && noticeText && !normalizedText(noticeText).includes(normalizedText(work.title))) {
        errors.push(`${label} title is absent from ${work.noticeFile}.`);
      }
    }
    if (!uniqueStrings(work?.attributionEvidence)) {
      errors.push(`${label} attributionEvidence must be a non-empty, unique string array.`);
    } else {
      for (const evidence of work.attributionEvidence) {
        if (hasLocalAbsolutePath(evidence)) {
          errors.push(`${label} attributionEvidence contains a workstation-local path: ${evidence}.`);
        }
        if (/^https:\/\//u.test(evidence) && !isApprovedEvidenceUrl(evidence)) {
          errors.push(`${label} attributionEvidence uses an unreviewed evidence host: ${evidence}.`);
        } else if (!/^https:\/\//u.test(evidence)) {
          const evidencePath = evidence.split(":", 1)[0];
          const resolvedEvidencePath = resolveRepositoryPath(rootDir, evidencePath);
          if (!resolvedEvidencePath || !(await pathExists(resolvedEvidencePath))) {
            errors.push(`${label} attributionEvidence path does not exist: ${evidence}.`);
          }
        }
      }
    }
  }

  for (const capability of capabilities) {
    const label = `capability ${capability?.capabilityId ?? "<unknown>"}`;
    if (typeof capability?.shipped !== "boolean") errors.push(`${label} shipped must be boolean.`);
    if (!isNonEmptyString(capability?.surfaceKind)) errors.push(`${label} must have a surfaceKind.`);
    if (!isNonEmptyString(capability?.behavior)) errors.push(`${label} must describe its behavior.`);
    if (!CAPABILITY_STATUSES.has(capability?.status)) errors.push(`${label} has unsupported status ${capability?.status}.`);
    if (!uniqueStrings(capability?.codeRefs)) {
      errors.push(`${label} codeRefs must be a non-empty, unique string array.`);
    } else {
      for (const codeRef of capability.codeRefs) {
        const resolvedCodeRef = resolveRepositoryPath(rootDir, codeRef);
        if (!resolvedCodeRef || !(await pathExists(resolvedCodeRef))) {
          errors.push(`${label} codeRef does not resolve inside the repository: ${codeRef}.`);
        }
      }
    }
    if (!uniqueStrings(capability?.sourceWorks) && capability?.sourceWorks?.length !== 0) {
      errors.push(`${label} sourceWorks must be a unique string array.`);
    }
    for (const workKey of capability?.sourceWorks ?? []) {
      if (!workKeys.has(workKey)) errors.push(`${label} references unknown work ${workKey}.`);
    }
    if (!uniqueStrings(capability?.licenses) && capability?.licenses?.length !== 0) {
      errors.push(`${label} licenses must be a unique string array.`);
    }
    for (const license of capability?.licenses ?? []) {
      if (!ALLOWED_LICENSES.has(license)) errors.push(`${label} has unsupported license ${license}.`);
    }
    const expectedLicenses = new Set(
      (capability?.sourceWorks ?? []).map((workKey) => licenseByWorkKey.get(workKey)).filter(isNonEmptyString)
    );
    const actualLicenses = new Set(capability?.licenses ?? []);
    if (
      expectedLicenses.size !== actualLicenses.size ||
      [...expectedLicenses].some((license) => !actualLicenses.has(license))
    ) {
      errors.push(`${label} licenses must exactly match the licenses of its referenced source works.`);
    }
    if (!uniqueStrings(capability?.provenanceEvidence)) {
      errors.push(`${label} provenanceEvidence must be a non-empty, unique string array.`);
    } else {
      for (const evidence of capability.provenanceEvidence) {
        if (hasLocalAbsolutePath(evidence)) {
          errors.push(`${label} provenanceEvidence contains a workstation-local path: ${evidence}.`);
        }
        if (/^https:\/\//u.test(evidence) && !isApprovedEvidenceUrl(evidence)) {
          errors.push(`${label} provenanceEvidence uses an unreviewed evidence host: ${evidence}.`);
        }
        if (/^(?:assets|docs|licenses|scripts|src|styles|templates|tests|tools)\//u.test(evidence)) {
          const evidencePath = evidence.split(":", 1)[0];
          const resolvedEvidencePath = resolveRepositoryPath(rootDir, evidencePath);
          if (!resolvedEvidencePath || !(await pathExists(resolvedEvidencePath))) {
            errors.push(`${label} provenanceEvidence path does not exist: ${evidence}.`);
          }
        }
      }
    }
    if (capability?.surfaceKind !== "runtime-interface") {
      if ((capability?.sourceWorks?.length ?? 0) === 0) errors.push(`${label} must identify at least one source work.`);
      if ((capability?.licenses?.length ?? 0) === 0) errors.push(`${label} must identify at least one license.`);
    }
  }

  for (const asset of assets) {
    const label = `asset ${asset?.assetId ?? "<unknown>"}`;
    if (typeof asset?.shipped !== "boolean") errors.push(`${label} shipped must be boolean.`);
    if (!isNonEmptyString(asset?.basis)) errors.push(`${label} must identify its rights basis.`);
    if (!ASSET_STATUSES.has(asset?.status)) errors.push(`${label} has unsupported status ${asset?.status}.`);
    if (!uniqueStrings(asset?.paths)) {
      errors.push(`${label} paths must be a non-empty, unique string array.`);
    } else {
      for (const assetPath of asset.paths) {
        const resolvedAssetPath = resolveRepositoryPath(rootDir, assetPath);
        if (!resolvedAssetPath || !(await pathExists(resolvedAssetPath))) {
          errors.push(`${label} path does not resolve inside the repository: ${assetPath}.`);
        }
      }
    }
    if (asset?.evidence !== undefined || asset?.assetId === "wayfinder-project-name") {
      if (!uniqueStrings(asset?.evidence)) {
        errors.push(`${label} evidence must be a non-empty, unique string array.`);
      } else {
        for (const evidence of asset.evidence) {
          if (!isApprovedEvidenceUrl(evidence)) {
            errors.push(`${label} evidence uses an unreviewed evidence host: ${evidence}.`);
          }
        }
      }
    }
  }

  const blockerIds = [];
  for (const blocker of blockers) {
    const label = `release blocker ${blocker?.id ?? "<unknown>"}`;
    if (!isNonEmptyString(blocker?.summary) || !isNonEmptyString(blocker?.resolution)) {
      errors.push(`release blocker ${blocker?.id ?? "<unknown>"} must have a summary and resolution.`);
    }
    if (blocker?.status !== "open" && blocker?.status !== "resolved") {
      errors.push(`${label} status must be open or resolved.`);
    }
    if (blocker?.status === "resolved") {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(blocker?.resolvedAt ?? "")) {
        errors.push(`${label} must record an ISO resolution date.`);
      }
      if (!uniqueStrings(blocker?.resolutionEvidence)) {
        errors.push(`${label} must retain non-empty, unique resolution evidence.`);
      } else {
        for (const evidence of blocker.resolutionEvidence) {
          if (/^https:\/\//u.test(evidence)) {
            if (!isApprovedEvidenceUrl(evidence)) {
              errors.push(`${label} resolutionEvidence uses an unreviewed evidence host: ${evidence}.`);
            }
          } else {
            const evidencePath = evidence.split(":", 1)[0];
            const resolvedEvidencePath = resolveRepositoryPath(rootDir, evidencePath);
            if (!resolvedEvidencePath || !(await pathExists(resolvedEvidencePath))) {
              errors.push(`${label} resolutionEvidence path does not exist: ${evidence}.`);
            }
          }
        }
      }
    } else if (blocker?.resolvedAt !== undefined || blocker?.resolutionEvidence !== undefined) {
      errors.push(`${label} must not claim resolution details while it is open.`);
    }
    if (blocker?.status === "open" && isNonEmptyString(blocker?.id)) blockerIds.push(blocker.id);
  }
  if (release && blockerIds.length > 0) {
    errors.push(`Release legal qualification is blocked by: ${blockerIds.join(", ")}.`);
  } else if (blockerIds.length > 0) {
    warnings.push(`Release remains blocked by ${blockerIds.length} recorded legal issue(s).`);
  }
  if (ledger.traceabilityStatus === "complete" && blockerIds.length > 0) {
    errors.push("rules-sources.json cannot claim complete traceability while release blockers remain.");
  }
  if (release) {
    if (ledger.traceabilityStatus !== "complete") {
      errors.push("Release legal qualification requires traceabilityStatus complete.");
    }
    const unresolvedWorks = works.filter((entry) => entry?.status !== "verified").map((entry) => entry?.key);
    const unresolvedCapabilities = capabilities
      .filter((entry) => entry?.status !== "resolved")
      .map((entry) => entry?.capabilityId);
    const unresolvedAssets = assets.filter((entry) => entry?.status !== "resolved").map((entry) => entry?.assetId);
    if (unresolvedWorks.length > 0) {
      errors.push(`Release legal qualification has unresolved works: ${unresolvedWorks.join(", ")}.`);
    }
    if (unresolvedCapabilities.length > 0) {
      errors.push(`Release legal qualification has unresolved capabilities: ${unresolvedCapabilities.join(", ")}.`);
    }
    if (unresolvedAssets.length > 0) {
      errors.push(`Release legal qualification has unresolved assets: ${unresolvedAssets.join(", ")}.`);
    }
  }

  return { errors, warnings, blockerIds };
}

export async function inspectLegalReadiness({ rootDir = defaultRepoRoot, release = false, ledger } = {}) {
  const errors = [];
  const warnings = [];
  const legalTexts = new Map();
  for (const relativePath of REQUIRED_LEGAL_FILES) {
    legalTexts.set(relativePath, await readRequiredText(rootDir, relativePath, errors));
  }

  let parsedLedger = ledger;
  if (parsedLedger === undefined) {
    try {
      parsedLedger = JSON.parse(legalTexts.get("licenses/rules-sources.json") || "");
    } catch (error) {
      errors.push(`licenses/rules-sources.json is not valid JSON: ${error instanceof Error ? error.message : error}.`);
      parsedLedger = {};
    }
  }

  const ledgerResult = await validateRulesSourceLedger(parsedLedger, { rootDir, release });
  errors.push(...ledgerResult.errors);
  warnings.push(...ledgerResult.warnings);

  const legalText = normalizedText(legalTexts.get("LEGAL.md") ?? "");
  for (const phrase of CUP_NOTICE_PARTS) {
    if (!legalText.includes(phrase)) errors.push(`LEGAL.md is missing Community Use notice text: ${phrase}.`);
  }

  for (const relativePath of ["licenses/ORC-NOTICE.md", "licenses/OPEN-GAME-LICENSE-1.0A.md"]) {
    if (!normalizedText(legalTexts.get(relativePath) ?? "").includes(EXPECTED_DOWNSTREAM_ATTRIBUTION)) {
      errors.push(`${relativePath} is missing the exact downstream attribution.`);
    }
  }

  if (release) {
    for (const [relativePath, noticeParts] of RELEASE_BLOCKING_NOTICE_PARTS) {
      const noticeText = normalizedText(legalTexts.get(relativePath) ?? "");
      for (const noticePart of noticeParts) {
        if (noticeText.includes(normalizedText(noticePart))) {
          errors.push(`${relativePath} still contains unresolved publication-blocking notice text: ${noticePart}`);
        }
      }
    }
  }

  const oglNoticeText = normalizedText(legalTexts.get("licenses/OPEN-GAME-LICENSE-1.0A.md") ?? "");
  for (const noticePart of REQUIRED_OGL_NOTICE_PARTS) {
    if (!oglNoticeText.includes(normalizedText(noticePart))) {
      errors.push(`licenses/OPEN-GAME-LICENSE-1.0A.md is missing inherited Section 15 text: ${noticePart}`);
    }
  }

  for (const relativePath of [
    "licenses/ORC-NOTICE.md",
    "licenses/OPEN-GAME-LICENSE-1.0A.md",
    "licenses/THIRD-PARTY-NOTICES.md",
  ]) {
    if (/\b(?:TBD|TODO|FIXME|UNKNOWN)\b/u.test(legalTexts.get(relativePath) ?? "")) {
      errors.push(`${relativePath} contains a release-notice placeholder.`);
    }
  }

  try {
    const manifest = JSON.parse(await readFile(path.join(rootDir, "module.json"), "utf8"));
    if (manifest.license !== "LEGAL.md") errors.push("module.json license must point to LEGAL.md.");
    const manifestDescription = normalizedText(String(manifest.description ?? ""));
    for (const phrase of CUP_NOTICE_PARTS) {
      if (!manifestDescription.includes(phrase)) {
        errors.push(`module.json description is missing Community Use notice text: ${phrase}.`);
      }
    }
  } catch (error) {
    errors.push(`module.json could not be validated: ${error instanceof Error ? error.message : error}.`);
  }

  try {
    const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
    if (!String(packageJson.scripts?.check ?? "").includes("check:legal")) {
      errors.push("package.json check must include check:legal.");
    }
  } catch (error) {
    errors.push(`package.json could not be validated: ${error instanceof Error ? error.message : error}.`);
  }

  return {
    errors,
    warnings,
    blockerIds: ledgerResult.blockerIds,
    counts: {
      works: Array.isArray(parsedLedger?.works) ? parsedLedger.works.length : 0,
      capabilities: Array.isArray(parsedLedger?.capabilities) ? parsedLedger.capabilities.length : 0,
      assets: Array.isArray(parsedLedger?.assets) ? parsedLedger.assets.length : 0,
    },
  };
}

export async function assertLegalReadiness(options = {}) {
  const result = await inspectLegalReadiness(options);
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("\n"));
  }
  return result;
}

function usage() {
  return "Usage: node tools/legal/validate-rules-sources.mjs [--release]";
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage());
    return;
  }
  const unknown = args.filter((arg) => arg !== "--release");
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(", ")}.\n${usage()}`);

  const result = await assertLegalReadiness({ release: args.includes("--release") });
  for (const warning of result.warnings) console.warn(`Legal readiness warning: ${warning}`);
  console.log(
    `Legal source ledger valid: ${result.counts.works} works, ${result.counts.capabilities} capabilities, ${result.counts.assets} assets.`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
