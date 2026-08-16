export class WayfinderGmCommandAuthorityError extends Error {
    constructor() {
        super("Only a current GM may perform this Wayfinder command.");
        this.name = "WayfinderGmCommandAuthorityError";
    }
}
export function requireCurrentGmPrincipal(user) {
    if (!isRecord(user) || user.isGM !== true || typeof user.id !== "string" || user.id.trim().length === 0) {
        throw new WayfinderGmCommandAuthorityError();
    }
    return {
        userId: user.id,
        isGM: true,
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=gm-command-authority.js.map