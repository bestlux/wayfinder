export interface ActorInventorySheetHost {
  readonly sheet?: {
    readonly render?: (force: boolean, options: { readonly tab: "inventory" }) => unknown;
  } | null;
}

export async function openActorInventorySheet(actor: ActorInventorySheetHost): Promise<void> {
  const sheet = actor.sheet;
  const render = sheet?.render;
  if (typeof render !== "function") {
    throw new Error("The PF2E character inventory sheet is unavailable.");
  }
  await Reflect.apply(render, sheet, [true, { tab: "inventory" }]);
}
