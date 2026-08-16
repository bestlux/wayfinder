export interface CurrentGmPrincipal {
  userId: string;
  isGM: true;
}

export class WayfinderGmCommandAuthorityError extends Error {
  constructor() {
    super("Only a current GM may perform this Wayfinder command.");
    this.name = "WayfinderGmCommandAuthorityError";
  }
}

export function requireCurrentGmPrincipal(user: unknown): CurrentGmPrincipal {
  if (!isRecord(user) || user.isGM !== true || typeof user.id !== "string" || user.id.trim().length === 0) {
    throw new WayfinderGmCommandAuthorityError();
  }
  return {
    userId: user.id,
    isGM: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
