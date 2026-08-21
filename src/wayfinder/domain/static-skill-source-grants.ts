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
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || rule.key !== "ActiveEffectLike" || typeof rule.path !== "string") {
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

  const bySlug = new Map<string, StaticSkillSourceGrant>();
  for (const grant of grants) {
    const existing = bySlug.get(grant.slug);
    if (!existing || existing.rank < grant.rank) bySlug.set(grant.slug, grant);
  }
  return Object.freeze(
    Array.from(bySlug.values())
      .sort((left, right) => left.slug.localeCompare(right.slug))
      .map((grant) => Object.freeze(grant))
  );
}

function normalizeSkillSlug(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
