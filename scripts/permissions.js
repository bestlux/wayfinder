export function canUseWayfinder(actor) {
    if (!actor || game.system?.id !== "pf2e" || actor.type !== "character") {
        return false;
    }
    if (actor.isOwner === true) {
        return true;
    }
    const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    if (typeof actor.permission === "number" && actor.permission >= ownerLevel) {
        return true;
    }
    if (typeof actor.testUserPermission === "function") {
        return actor.testUserPermission(game.user, ownerLevel);
    }
    return false;
}
export class WayfinderActorAuthorityError extends Error {
    constructor() {
        super("The current user can no longer modify this PF2E character.");
        this.name = "WayfinderActorAuthorityError";
    }
}
export function assertCanUseWayfinder(actor) {
    if (!canUseWayfinder(actor)) {
        throw new WayfinderActorAuthorityError();
    }
}
//# sourceMappingURL=permissions.js.map