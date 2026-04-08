export function parseCompendiumAllowlist(raw: unknown): string[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function mergePackIds(basePackIds: string[], extraPackIds: string[]): string[] {
  return Array.from(new Set([...basePackIds, ...extraPackIds]));
}
