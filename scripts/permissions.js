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
//# sourceMappingURL=permissions.js.map