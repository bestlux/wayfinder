type SourceIdCarrier = {
  sourceId?: unknown;
  flags?: {
    core?: {
      sourceId?: unknown;
    };
  };
  _stats?: {
    compendiumSource?: unknown;
  };
};

export function sourceIdOf(value: unknown): string | null {
  const carrier = value as SourceIdCarrier | null | undefined;
  const sourceId = carrier?.sourceId ?? carrier?.flags?.core?.sourceId ?? carrier?._stats?.compendiumSource ?? null;
  return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}

export function itemMatchesSourceId(item: unknown, sourceId: string): boolean {
  return sourceIdOf(item) === sourceId;
}
