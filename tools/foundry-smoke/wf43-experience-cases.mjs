import { createHash } from "node:crypto";

export const WF43_VIEWPORT = Object.freeze({ width: 1440, height: 1000 });
export const WF43_APP_WIDTHS = Object.freeze([1240, 1180, 980, 760]);
export const WF43_STATE_IDS = Object.freeze([
  "policy",
  "browse-cart",
  "review",
  "handoff",
  "forced-failure",
  "receipt",
]);

const locale = (id, name, stateAnchors = {}) => {
  const definition = {
    schemaVersion: 1,
    id,
    name,
    viewport: WF43_VIEWPORT,
    appWidths: WF43_APP_WIDTHS,
    stateIds: WF43_STATE_IDS,
    stateAnchors,
    fixture: {
      smokeCaseId: "wizard-l1-l5-apply-rerun",
      stepId: "starting-equipment-level-5",
      item: {
        name: "Dagger",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
      },
    },
  };
  return Object.freeze({
    ...definition,
    definitionFingerprint: fingerprint(definition),
  });
};

export const wf43ExperienceCases = Object.freeze([
  locale("en", "English"),
  locale("cn", "Simplified Chinese", {
    policy: "开始选购",
    "browse-cart": "你的装备",
    review: "装备已确认",
    handoff: "请在角色卡上完成此步骤",
    "forced-failure": "寻路仪无法应用此起始装备草稿",
    receipt: "最近一次应用",
  }),
]);

export function validateWf43ExperienceCaseDefinition(definition) {
  const failures = [];
  if (definition?.schemaVersion !== 1) failures.push("WF-080-43 case schema must be version 1.");
  if (!new Set(["en", "cn"]).has(definition?.id)) failures.push("WF-080-43 locale must be en or cn.");
  if (fingerprint(withoutFingerprint(definition)) !== definition?.definitionFingerprint) {
    failures.push(`${definition?.id ?? "unknown"}: definition fingerprint drifted.`);
  }
  if (JSON.stringify(definition?.viewport) !== JSON.stringify(WF43_VIEWPORT)) {
    failures.push(`${definition?.id ?? "unknown"}: viewport is not the frozen 1440x1000 release viewport.`);
  }
  if (JSON.stringify(definition?.appWidths) !== JSON.stringify(WF43_APP_WIDTHS)) {
    failures.push(`${definition?.id ?? "unknown"}: app widths differ from the frozen release widths.`);
  }
  if (JSON.stringify(definition?.stateIds) !== JSON.stringify(WF43_STATE_IDS)) {
    failures.push(`${definition?.id ?? "unknown"}: state matrix is incomplete or reordered.`);
  }
  if (
    definition?.id === "cn" &&
    WF43_STATE_IDS.some(
      (stateId) => typeof definition?.stateAnchors?.[stateId] !== "string" || !definition.stateAnchors[stateId].trim(),
    )
  ) {
    failures.push("cn: every required state needs an exact Chinese live anchor.");
  }
  if (
    definition?.fixture?.smokeCaseId !== "wizard-l1-l5-apply-rerun" ||
    definition?.fixture?.stepId !== "starting-equipment-level-5" ||
    definition?.fixture?.item?.sourceUuid !== "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z"
  ) {
    failures.push(`${definition?.id ?? "unknown"}: guarded fixture identity drifted.`);
  }
  return failures;
}

function withoutFingerprint(value) {
  const copy = structuredClone(value);
  delete copy.definitionFingerprint;
  return copy;
}

function fingerprint(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
