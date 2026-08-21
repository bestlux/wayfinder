/**
 * Replace one exact Foundry document leaf while allowing the surrounding
 * document update to retain its normal recursive merge behavior.
 */
export function forceFoundryLeafReplacement<T>(value: T): T {
  const globals = globalThis as typeof globalThis & {
    foundry?: { data?: { operators?: { ForcedReplacement?: { create?: (value: unknown) => unknown } } } };
  };
  const ForcedReplacement = globals.foundry?.data?.operators?.ForcedReplacement;
  if (typeof ForcedReplacement?.create !== "function") {
    throw new Error("Foundry's ForcedReplacement data operator is unavailable.");
  }
  return ForcedReplacement.create(value) as T;
}
