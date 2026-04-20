type SlugDocument = {
  name?: unknown;
  system?: {
    slug?: unknown;
    ancestry?: {
      slug?: unknown;
    };
  };
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizedSlug(value: unknown): string | null {
  const rawValue = stringOrNull(value);
  return rawValue ? slugifyName(rawValue) : null;
}

export function slugifyName(value: unknown): string | null {
  const name = stringOrNull(value);
  if (!name) {
    return null;
  }

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || null
  );
}

export function extractDocumentSlug(document: unknown): string | null {
  const slugDocument = document as SlugDocument | null | undefined;
  return (
    normalizedSlug((slugDocument as { slug?: unknown } | null | undefined)?.slug) ??
    normalizedSlug(slugDocument?.system?.slug) ??
    normalizedSlug(slugDocument?.system?.ancestry?.slug) ??
    slugifyName(slugDocument?.name)
  );
}
