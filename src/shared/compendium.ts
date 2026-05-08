export interface CompendiumItemUuidParts {
  packId: string;
  documentId: string;
}

export function parseCompendiumItemUuid(uuid: string): CompendiumItemUuidParts | null {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid.trim());
  return match ? { packId: match[1], documentId: match[2] } : null;
}
