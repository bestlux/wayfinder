import type { CampaignFeatSectionSnapshot, CampaignFeatSlotSnapshot } from "./types.js";

const CORE_FEAT_GROUP_IDS = new Set([
  "ancestryfeature",
  "classfeature",
  "ancestry",
  "class",
  "archetype",
  "skill",
  "general",
  "mythic",
  "campaign",
  "bonus",
]);

interface FeatGroupLike {
  id?: unknown;
  label?: unknown;
  supported?: unknown;
  slots?: unknown;
}

interface CampaignSectionSettingLike {
  id: string;
  label: string;
  supported: string[];
  slots: CampaignFeatSlotSnapshot[];
}

export function readCampaignFeatSections(actor: unknown): CampaignFeatSectionSnapshot[] {
  // PF2E's prepared group proves the section is active for this actor, while
  // the native setting retains future slots that PF2E prunes above actor level.
  const configuredSections = readCampaignFeatSectionSettings();
  if (configuredSections.length === 0) {
    return [];
  }

  const groupsById = campaignFeatGroups(actor, configuredSections);
  return configuredSections
    .flatMap((configured) => {
      const group = groupsById.get(configured.id);
      return group ? normalizeActorSection(group, configured) : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function campaignFeatStepId(
  section: Pick<CampaignFeatSectionSnapshot, "id" | "slots">,
  slot: CampaignFeatSlotSnapshot
): string {
  const sharesLevel = section.slots.filter((candidate) => candidate.level === slot.level).length > 1;
  const slotIdentity = sharesLevel ? `-${encodeURIComponent(slot.id)}` : "";
  return `campaign-feat-${section.id}${slotIdentity}-level-${slot.level}`;
}

function campaignFeatGroups(
  actor: unknown,
  configuredSections: CampaignSectionSettingLike[]
): Map<string, FeatGroupLike> {
  const feats = (actor as { feats?: unknown } | null)?.feats;
  if (!feats || (typeof feats !== "object" && typeof feats !== "function")) {
    return new Map();
  }

  const groups = new Map<string, FeatGroupLike>();
  for (const setting of configuredSections) {
    try {
      const group = getFeatGroup(feats, setting.id);
      addCampaignGroup(groups, group);
    } catch {
      // A malformed actor collection is treated as having no additional group.
    }
  }

  return groups;
}

function addCampaignGroup(groups: Map<string, FeatGroupLike>, value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const group = value as FeatGroupLike;
  const id = stringValue(group.id);
  if (!id || CORE_FEAT_GROUP_IDS.has(id)) {
    return;
  }

  groups.set(id, group);
}

function getFeatGroup(feats: unknown, id: string): unknown {
  const get = (feats as { get?: (groupId: string) => unknown }).get;
  return typeof get === "function" ? get.call(feats, id) : (feats as Record<string, unknown>)[id];
}

function normalizeActorSection(
  group: FeatGroupLike,
  configured: CampaignSectionSettingLike | undefined
): CampaignFeatSectionSnapshot[] {
  const id = stringValue(group.id);
  const label = stringValue(group.label) || configured?.label || id;
  if (!id || !label) {
    return [];
  }

  const actorSlots = normalizeActorSlots(group.slots, id);
  const slotsById = new Map<string, CampaignFeatSlotSnapshot>();
  for (const slot of configured?.slots ?? []) {
    slotsById.set(slot.id, slot);
  }
  for (const slot of actorSlots) {
    slotsById.set(slot.id, slot);
  }

  const supported = normalizeSupported(group.supported);
  return [
    {
      id,
      label,
      supported: supported.length > 0 ? supported : (configured?.supported ?? []),
      slots: Array.from(slotsById.values()).sort(
        (left, right) => left.level - right.level || left.id.localeCompare(right.id)
      ),
    },
  ];
}

function readCampaignFeatSectionSettings(): CampaignSectionSettingLike[] {
  try {
    const settings = (globalThis as { game?: { settings?: { get?: (scope: string, key: string) => unknown } } }).game
      ?.settings;
    if (typeof settings?.get !== "function") {
      return [];
    }

    const value = settings.get("pf2e", "campaignFeatSections");
    return Array.isArray(value) ? value.flatMap(normalizeSettingSection) : [];
  } catch {
    return [];
  }
}

function normalizeSettingSection(value: unknown): CampaignSectionSettingLike[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const section = value as Record<string, unknown>;
  const id = stringValue(section.id);
  const label = stringValue(section.label);
  const supportedIsValid =
    section.supported === undefined ||
    (Array.isArray(section.supported) && section.supported.every((entry) => stringValue(entry).length > 0));
  if (!id || !label || CORE_FEAT_GROUP_IDS.has(id) || !supportedIsValid || !Array.isArray(section.slots)) {
    return [];
  }

  const slots = section.slots.flatMap((slot) => normalizeConfiguredSlot(slot, id));
  return slots.length === section.slots.length && slots.length > 0
    ? [
        {
          id,
          label,
          supported: normalizeSupported(section.supported),
          slots,
        },
      ]
    : [];
}

function normalizeActorSlots(value: unknown, groupId: string): CampaignFeatSlotSnapshot[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value).flatMap((slot) => {
    if (!slot || typeof slot !== "object") {
      return [];
    }

    const record = slot as Record<string, unknown>;
    const level = campaignLevel(record.level);
    if (level === null) {
      return [];
    }

    return [
      {
        id: stringValue(record.id) || `${groupId}-${level}`,
        level,
        fulfilled: Boolean(record.feat),
      },
    ];
  });
}

function normalizeConfiguredSlot(value: unknown, groupId: string): CampaignFeatSlotSnapshot[] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const rawLevel = record?.level ?? value;
  const level = typeof rawLevel === "number" ? campaignLevel(rawLevel) : null;
  const configuredId = stringValue(record?.id);
  if (record && record.id !== undefined && !configuredId) {
    return [];
  }
  if (level === null) {
    return [];
  }

  return [
    {
      id: configuredId || `${groupId}-${level}`,
      level,
      fulfilled: false,
    },
  ];
}

function normalizeSupported(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(stringValue).filter((entry): entry is string => entry.length > 0)))
    : [];
}

function campaignLevel(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 20 ? numeric : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
