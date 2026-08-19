export async function openActorInventorySheet(actor) {
    const sheet = actor.sheet;
    const render = sheet?.render;
    if (typeof render !== "function") {
        throw new Error("The PF2E character inventory sheet is unavailable.");
    }
    await Reflect.apply(render, sheet, [true, { tab: "inventory" }]);
}
//# sourceMappingURL=actor-inventory-navigation-service.js.map