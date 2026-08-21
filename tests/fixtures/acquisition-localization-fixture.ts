import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AcquisitionLocalizationValues,
  AcquisitionLocalize,
} from "../../src/wayfinder/application/acquisition-localization";

const english = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8")) as Readonly<Record<string, unknown>>;

export const localizeAcquisitionEnglish: AcquisitionLocalize = (key, values) =>
  format(resolveKey(english, key), values);

function resolveKey(root: Readonly<Record<string, unknown>>, key: string): string {
  let current: unknown = root;
  for (const segment of key.split(".")) {
    current = isRecord(current) ? current[segment] : undefined;
  }
  if (typeof current !== "string" || !current.trim()) throw new Error(`Missing test localization: ${key}`);
  return current;
}

function format(template: string, values?: AcquisitionLocalizationValues): string {
  return template.replace(/\{([^}]+)\}/gu, (_match, name: string) => String(values?.[name] ?? `{${name}}`));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
