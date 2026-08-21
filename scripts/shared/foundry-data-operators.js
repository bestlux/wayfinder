/**
 * Replace one exact Foundry document leaf while allowing the surrounding
 * document update to retain its normal recursive merge behavior.
 */
export function forceFoundryLeafReplacement(value) {
    const globals = globalThis;
    const ForcedReplacement = globals.foundry?.data?.operators?.ForcedReplacement;
    if (typeof ForcedReplacement?.create !== "function") {
        throw new Error("Foundry's ForcedReplacement data operator is unavailable.");
    }
    return ForcedReplacement.create(value);
}
//# sourceMappingURL=foundry-data-operators.js.map