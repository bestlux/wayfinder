import { matchesChoiceSetRulePredicate } from "../rule-data.js";

export interface StaticSkillSourceGrant {
  readonly slug: string;
  readonly rank: number;
  readonly sourceId: string;
}

type StaticSkillSourceDocument = {
  readonly system?: {
    readonly trainedSkills?: { readonly value?: unknown } | null;
    readonly rules?: unknown;
  } | null;
};

export function projectStaticSkillSourceGrants(args: {
  readonly document: unknown;
  readonly sourceId: string;
  readonly validSkillSlugs: ReadonlySet<string>;
  readonly activeRollOptions?: ReadonlySet<string>;
}): readonly StaticSkillSourceGrant[] {
  const document = args.document as StaticSkillSourceDocument | null;
  const grants: StaticSkillSourceGrant[] = [];
  const trainedSkills = document?.system?.trainedSkills?.value;
  if (Array.isArray(trainedSkills)) {
    for (const value of trainedSkills) {
      const slug = normalizeSkillSlug(value);
      if (slug && args.validSkillSlugs.has(slug)) {
        grants.push({ slug, rank: 1, sourceId: args.sourceId });
      }
    }
  }

  const rules = Array.isArray(document?.system?.rules) ? document.system.rules : [];
  const activeRollOptions = args.activeRollOptions ?? new Set<string>();
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || rule.key !== "ActiveEffectLike" || typeof rule.path !== "string") {
      continue;
    }
    if (
      (rule.mode !== undefined && rule.mode !== "upgrade" && rule.mode !== "override") ||
      !matchesChoiceSetRulePredicate(rule, activeRollOptions)
    ) {
      continue;
    }
    const match = /^system\.skills\.([a-z][a-z0-9-]*)\.rank$/iu.exec(rule.path.trim());
    const rank = Number(rule.value);
    const slug = match?.[1]?.toLowerCase();
    if (slug && args.validSkillSlugs.has(slug) && Number.isFinite(rank) && rank >= 1) {
      grants.push({
        slug,
        rank: Math.max(1, Math.min(4, Math.floor(rank))),
        sourceId: args.sourceId,
      });
    }
  }

  return canonicalizeSkillSourceGrants(grants);
}

export function canonicalizeSkillSourceGrants<
  T extends { readonly slug: string; readonly rank: number; readonly sourceId?: string },
>(grants: readonly T[]): readonly Readonly<T>[] {
  const byIdentity = new Map<string, T>();
  for (const grant of grants) {
    const slug = normalizeSkillSlug(grant.slug);
    if (!slug || !Number.isFinite(grant.rank)) continue;
    const normalizedGrant = { ...grant, slug, rank: Math.max(0, Math.min(4, Math.floor(grant.rank))) };
    const identity = JSON.stringify([grant.sourceId ?? null, slug]);
    const existing = byIdentity.get(identity);
    if (!existing || existing.rank < normalizedGrant.rank) byIdentity.set(identity, normalizedGrant);
  }
  return Object.freeze(
    Array.from(byIdentity.values())
      .sort((left, right) =>
        `${left.sourceId ?? ""}:${left.slug}:${left.rank}`.localeCompare(
          `${right.sourceId ?? ""}:${right.slug}:${right.rank}`
        )
      )
      .map((grant) => Object.freeze(grant))
  );
}

function normalizeSkillSlug(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
