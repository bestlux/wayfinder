import type { CampaignFeatFilterSnapshot, CampaignFeatSectionSnapshot, CampaignFeatSlotSnapshot } from "./types.js";

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
  filter?: unknown;
  slots?: unknown;
}

interface CampaignSectionSettingLike {
  id: string;
  label: string;
  supported: string[];
  filter: CampaignFeatFilterSnapshot;
  slots: CampaignFeatSlotSnapshot[];
}

export interface CampaignFeatSlotAuthority {
  sectionId: string;
  supported: string[];
  filter: CampaignFeatFilterSnapshot;
  slot: CampaignFeatSlotSnapshot;
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

export function resolveCampaignFeatSlotSetting(sectionId: string, slotId: string): CampaignFeatSlotAuthority | null {
  const section = readCampaignFeatSectionSettings().find((candidate) => candidate.id === sectionId);
  const slot = section?.slots.find((candidate) => candidate.id === slotId);
  if (!section || !slot) {
    return null;
  }

  return {
    sectionId: section.id,
    supported: section.supported,
    filter: slot.filter ?? section.filter,
    slot,
  };
}

export function campaignFeatAllowsCandidate(
  supported: string[],
  filter: CampaignFeatFilterSnapshot,
  category: string | null,
  traits: string[]
): boolean {
  if (supported.length > 0 && (!category || !supported.includes(category))) {
    return false;
  }
  if (filter.categories.length > 0 && (!category || !filter.categories.includes(category))) {
    return false;
  }

  const normalizedTraits = new Set(traits.map(normalizeIdentifier).filter(Boolean));
  if (filter.omitTraits.some((trait) => normalizedTraits.has(trait))) {
    return false;
  }
  if (filter.traits.length === 0) {
    return true;
  }

  return filter.conjunction === "and"
    ? filter.traits.every((trait) => normalizedTraits.has(trait))
    : filter.traits.some((trait) => normalizedTraits.has(trait));
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

  const supported = normalizeSupported(group.supported);
  const effectiveSupported = supported.length > 0 ? supported : (configured?.supported ?? []);
  const groupFilter = normalizeFilter(group.filter, effectiveSupported) ?? configured?.filter;
  if (!groupFilter) {
    return [];
  }

  const actorSlots = normalizeActorSlots(group.slots, id, effectiveSupported);
  const slotsById = new Map<string, CampaignFeatSlotSnapshot>();
  for (const slot of configured?.slots ?? []) {
    slotsById.set(slot.id, slot);
  }
  for (const slot of actorSlots) {
    slotsById.set(slot.id, slot);
  }

  return [
    {
      id,
      label,
      supported: effectiveSupported,
      filter: groupFilter,
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
    if (!Array.isArray(value)) {
      return [];
    }

    const duplicateIds = duplicateSectionIds(value);
    return value.flatMap(normalizeSettingSection).filter((section) => !duplicateIds.has(section.id));
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
  const supported = normalizeSupported(section.supported);
  const filter = normalizeFilter(section.filter, supported);
  if (!id || !label || CORE_FEAT_GROUP_IDS.has(id) || !supportedIsValid || !filter || !Array.isArray(section.slots)) {
    return [];
  }

  const slots = section.slots.flatMap((slot) => normalizeConfiguredSlot(slot, id, supported));
  const slotIdsAreUnique = new Set(slots.map((slot) => slot.id)).size === slots.length;
  return slots.length === section.slots.length && slots.length > 0 && slotIdsAreUnique
    ? [
        {
          id,
          label,
          supported,
          filter,
          slots,
        },
      ]
    : [];
}

function normalizeActorSlots(value: unknown, groupId: string, supported: string[]): CampaignFeatSlotSnapshot[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value).flatMap((slot) => {
    if (!slot || typeof slot !== "object") {
      return [];
    }

    const record = slot as Record<string, unknown>;
    const level = campaignLevel(record.level);
    const filter = record.filter === undefined ? null : normalizeFilter(record.filter, supported);
    if (level === null || (record.filter !== undefined && !filter)) {
      return [];
    }

    return [
      {
        id: stringValue(record.id) || `${groupId}-${level}`,
        level,
        fulfilled: Boolean(record.feat),
        filter,
      },
    ];
  });
}

function normalizeConfiguredSlot(value: unknown, groupId: string, supported: string[]): CampaignFeatSlotSnapshot[] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const rawLevel = record?.level ?? value;
  const level = typeof rawLevel === "number" ? campaignLevel(rawLevel) : null;
  const configuredId = stringValue(record?.id);
  const filter = record?.filter === undefined ? null : normalizeFilter(record.filter, supported);
  if (record && record.id !== undefined && !configuredId) {
    return [];
  }
  if (level === null || (record?.filter !== undefined && !filter)) {
    return [];
  }

  return [
    {
      id: configuredId || `${groupId}-${level}`,
      level,
      fulfilled: false,
      filter,
    },
  ];
}

function normalizeSupported(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(normalizeIdentifier).filter((entry): entry is string => entry.length > 0)))
    : [];
}

function normalizeFilter(value: unknown, fallbackCategories: string[]): CampaignFeatFilterSnapshot | null {
  if (value === undefined) {
    return {
      categories: [...fallbackCategories],
      traits: [],
      omitTraits: [],
      conjunction: "or",
    };
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const categories = normalizeFilterList(record.categories, fallbackCategories);
  const traits = normalizeFilterList(record.traits, []);
  const omitTraits = normalizeFilterList(record.omitTraits, []);
  const conjunction = record.conjunction ?? "or";
  if (!categories || !traits || !omitTraits || (conjunction !== "or" && conjunction !== "and")) {
    return null;
  }

  return { categories, traits, omitTraits, conjunction };
}

function normalizeFilterList(value: unknown, fallback: string[]): string[] | null {
  if (value === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(value) || value.some((entry) => !normalizeIdentifier(entry))) {
    return null;
  }

  return Array.from(new Set(value.map(normalizeIdentifier)));
}

function duplicateSectionIds(values: unknown[]): Set<string> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const id = stringValue((value as Record<string, unknown> | null)?.id);
    if (id) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return new Set(Array.from(counts).flatMap(([id, count]) => (count > 1 ? [id] : [])));
}

function campaignLevel(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 20 ? numeric : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdentifier(value: unknown): string {
  return stringValue(value).toLowerCase();
}
