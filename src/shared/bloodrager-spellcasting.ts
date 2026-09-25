import { sourceIdOf } from "./source-id.js";

export const RISING_BLOOD_MAGIC_UUID = "Compendium.pf2e.feats-srd.Item.QRqs9NIWeh0ONRSP";

export function documentIsRisingBloodMagic(document: unknown): boolean {
  const uuid = (document as { uuid?: unknown } | null)?.uuid;
  return sourceIdOf(document) === RISING_BLOOD_MAGIC_UUID || uuid === RISING_BLOOD_MAGIC_UUID;
}
