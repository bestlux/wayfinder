import { createHash } from "node:crypto";

const RAW_FOCUSED_CASES = [
  {
    id: "higher-level-start-boundary",
    label: "Approved higher-level start versus imported level-7 progression denial",
    actorCount: 2,
    targetLevel: 5,
    existingImportLevel: 7,
  },
  {
    id: "level-5-permanent-recipe",
    label: "Standard level-5 permanent-item recipe",
    actorCount: 0,
    targetLevel: 5,
  },
  {
    id: "foreign-economic-handoffs",
    label: "Foreign item and currency zero-write handoffs",
    actorCount: 2,
    targetLevel: 1,
  },
  {
    id: "material-drift-zero-write",
    label: "Material policy, price, and baseline drift before writes",
    actorCount: 1,
    targetLevel: 1,
  },
  {
    id: "abp-and-spell-trust",
    label: "PF2E ABP world/actor override and distinct spell attestation trust",
    actorCount: 1,
    targetLevel: 5,
    abpMode: "ABPRulesAsWritten",
  },
  {
    id: "planned-grant-routes",
    label: "Formula Book, Titan Mauler, and dynamic-family grant routes",
    actorCount: 2,
    targetLevel: 1,
    routes: [
      "alchemist-formula-book",
      "giant-instinct-titan-mauler",
      "investigator-alchemical-sciences-formula-book",
      "ancient-elf-alchemist-formula-book",
    ],
  },
  {
    id: "draft-replacement-semantics",
    label: "Production picker exact draft deletion and replacement persistence",
    actorCount: 1,
    targetLevel: 1,
  },
];

const RAW_OVERLAY_ROWS = [
  row(
    1,
    "level-1-owner-purchase",
    [ref("acquisition", "equipment-l1-owner-common-purchase-retry")],
    ["roles", "policy", "identities", "quantities", "currency", "failures", "manifests"],
  ),
  row(
    2,
    "small-caster-pack-containers",
    [ref("wave4", "adventurers-pack-retry")],
    ["roles", "policy", "identities", "quantities", "containers", "currency", "failures", "manifests"],
  ),
  row(3, "level-1-retain-all-durability", [ref("acquisition", "equipment-l1-owner-retain-all")], [
    "roles",
    "policy",
    "identities",
    "currency",
    "manifests",
  ]),
  row(4, "level-5-permanent-recipe", [ref("focused", "level-5-permanent-recipe")], [
    "roles",
    "policy",
    "identities",
    "quantities",
    "currency",
  ]),
  row(5, "level-5-lump-sum-boundary", [ref("wave3", "level-5-lump-sum")], [
    "roles",
    "policy",
    "identities",
    "currency",
  ]),
  row(6, "higher-level-start-boundary", [ref("focused", "higher-level-start-boundary")], [
    "roles",
    "policy",
    "identities",
  ]),
  row(7, "custom-amount-and-exception", [
    ref("wave3", "level-5-custom-lump-sum"),
    ref("wave3", "configured-item-exception"),
  ], ["roles", "policy", "identities", "currency"]),
  row(8, "supplemental-source-isolation", [ref("wave4", "supplemental-source-isolation")], ["roles", "policy"]),
  row(9, "foreign-economic-handoffs", [ref("focused", "foreign-economic-handoffs")], [
    "roles",
    "identities",
    "currency",
  ]),
  row(10, "material-drift-zero-write", [ref("focused", "material-drift-zero-write")], [
    "policy",
    "identities",
    "failures",
  ]),
  row(11, "failure-retry-boundaries", [
    ref("acquisition", "equipment-l1-owner-common-purchase-retry"),
    ref("acquisition", "equipment-l1-owner-common-purchase-currency-before-retry"),
    ref("acquisition", "equipment-l1-owner-common-purchase-currency-after-retry"),
    ref("acquisition", "equipment-l1-owner-common-purchase-final-before-retry"),
    ref("acquisition", "equipment-l1-owner-common-purchase-final-after-ack"),
  ], ["roles", "policy", "identities", "quantities", "currency", "failures", "manifests"]),
  row(12, "abp-world-and-actor-override", [ref("focused", "abp-and-spell-trust")], ["roles", "policy"]),
  row(13, "spell-attestation-distinct-trust", [ref("focused", "abp-and-spell-trust")], ["roles", "policy"]),
  row(14, "planned-physical-grant-routes", [
    ref("focused", "planned-grant-routes"),
    ref("matrix", "alchemist-l1-l5-apply-rerun"),
    ref("acquisition", "equipment-l1-owner-dwarf-clan-dagger-native-retry"),
    ref("acquisition", "equipment-l1-owner-sarangay-head-gem-native-retry"),
  ], ["roles", "policy", "identities", "quantities", "currency", "manifests"]),
  row(15, "localized-keyboard-fixed-width", [ref("experience", "en"), ref("experience", "cn")], ["roles"]),
];

export const wf51FocusedCases = freezeDefinitions(RAW_FOCUSED_CASES);
export const wf51ReleaseOverlayRows = freezeDefinitions(RAW_OVERLAY_ROWS);

export function validateWf51FocusedCaseDefinition(value) {
  const failures = validateDefinition(value, "WF-080-51 focused case");
  if (!Number.isInteger(value?.actorCount) || value.actorCount < 0 || value.actorCount > 3) {
    failures.push(`${value?.id ?? "<unknown>"}: actorCount must be zero through three.`);
  }
  if (!Number.isInteger(value?.targetLevel) || value.targetLevel < 1 || value.targetLevel > 20) {
    failures.push(`${value?.id ?? "<unknown>"}: targetLevel must be one through twenty.`);
  }
  return failures;
}

export function validateWf51OverlayRowDefinition(value) {
  const failures = validateDefinition(value, "WF-080-51 overlay row");
  if (!Number.isInteger(value?.number) || value.number < 1 || value.number > 15) {
    failures.push(`${value?.id ?? "<unknown>"}: row number must be one through fifteen.`);
  }
  if (!Array.isArray(value?.evidenceRefs) || value.evidenceRefs.length === 0) {
    failures.push(`${value?.id ?? "<unknown>"}: at least one exact evidence route is required.`);
  } else if (
    value.evidenceRefs.some(
      (entry) => !entry || typeof entry.route !== "string" || !entry.route || typeof entry.caseId !== "string" || !entry.caseId,
    )
  ) {
    failures.push(`${value?.id ?? "<unknown>"}: evidence routes require route and caseId.`);
  }
  if (
    !Array.isArray(value?.requiredEvidence) ||
    value.requiredEvidence.length === 0 ||
    value.requiredEvidence.some((entry) => !EVIDENCE_CATEGORIES.includes(entry))
  ) {
    failures.push(`${value?.id ?? "<unknown>"}: requiredEvidence is missing or invalid.`);
  }
  return failures;
}

const EVIDENCE_CATEGORIES = [
  "roles",
  "policy",
  "identities",
  "quantities",
  "containers",
  "currency",
  "failures",
  "manifests",
];

function row(number, id, evidenceRefs, requiredEvidence) {
  return { number, id, label: id.replaceAll("-", " "), evidenceRefs, requiredEvidence };
}

function ref(route, caseId) {
  return { route, caseId };
}

function freezeDefinitions(entries) {
  return Object.freeze(
    entries.map((entry) => {
      const withFingerprint = { ...entry, definitionFingerprint: fingerprint(entry) };
      return Object.freeze(withFingerprint);
    }),
  );
}

function validateDefinition(value, label) {
  const failures = [];
  if (!value || typeof value !== "object") return [`${label} must be an object.`];
  if (typeof value.id !== "string" || !value.id) failures.push(`${label} requires an id.`);
  if (typeof value.label !== "string" || !value.label) failures.push(`${value.id ?? "<unknown>"}: label is required.`);
  if (value.definitionFingerprint !== fingerprint(withoutFingerprint(value))) {
    failures.push(`${value.id ?? "<unknown>"}: definition fingerprint drifted.`);
  }
  return failures;
}

function withoutFingerprint(value) {
  const copy = { ...value };
  delete copy.definitionFingerprint;
  return copy;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
