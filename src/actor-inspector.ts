import type { ActorSnapshot } from "./types.js";

export function inspectActor(actor: any): ActorSnapshot {
  const items = normalizeItems(actor);
  const level = clampLevel(Number(actor?.system?.details?.level?.value ?? 1));
  const namesByType: Record<string, string[]> = {};
  const sourceIds = new Set<string>();
  const singletonSlots = {
    ancestry: false,
    heritage: false,
    background: false,
    class: false,
  };
  const featCounts = {
    ancestry: 0,
    class: 0,
    archetype: 0,
    skill: 0,
    general: 0,
  };

  for (const item of items) {
    const type = String(item?.type ?? "");
    const name = String(item?.name ?? "").trim();
    if (type) {
      namesByType[type] ??= [];
      if (name) {
        namesByType[type].push(name);
      }
    }

    if (type in singletonSlots) {
      singletonSlots[type as keyof typeof singletonSlots] = true;
    }

    const sourceId = item?.flags?.core?.sourceId;
    if (typeof sourceId === "string" && sourceId) {
      sourceIds.add(sourceId);
    }

    if (type === "feat") {
      const featType = String(item?.system?.featType?.value ?? item?.system?.category ?? "");
      if (featType in featCounts) {
        featCounts[featType as keyof typeof featCounts] += 1;
      }
    }
  }

  return {
    actorId: String(actor?.id ?? ""),
    level,
    isBlank: items.length === 0 && !hasAnySingleton(singletonSlots),
    singletonSlots,
    featCounts,
    sourceIds: Array.from(sourceIds),
    namesByType,
    skillRanks: extractSkillRanks(actor),
  };
}

function extractSkillRanks(actor: any): Record<string, number> {
  const skills = actor?.system?.skills;
  if (!skills || typeof skills !== "object") {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [slug, data] of Object.entries(skills)) {
    const rank = Number((data as any)?.rank ?? 0);
    result[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
  }
  return result;
}

function normalizeItems(actor: any): any[] {
  if (Array.isArray(actor?.items)) {
    return actor.items;
  }

  if (Array.isArray(actor?.items?.contents)) {
    return actor.items.contents;
  }

  return [];
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }

  return Math.max(1, Math.min(20, Math.floor(level)));
}

function hasAnySingleton(singletonSlots: Record<"ancestry" | "heritage" | "background" | "class", boolean>): boolean {
  return singletonSlots.ancestry || singletonSlots.heritage || singletonSlots.background || singletonSlots.class;
}
