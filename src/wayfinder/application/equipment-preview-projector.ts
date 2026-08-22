import { enrichHtml } from "../../shared/foundry-compat.js";
import type { EquipmentCataloguePreview } from "./equipment-catalogue-service.js";

export interface EquipmentPreviewProjection {
  readonly sourceUuid: string;
  readonly description: string;
  readonly bulkLabel: string | null;
  readonly handsLabel: string | null;
}

export interface EquipmentPreviewProjector {
  project(preview: EquipmentCataloguePreview): Promise<EquipmentPreviewProjection | null>;
}

interface EquipmentPreviewProjectorOptions {
  readonly enrich?: (content: string, options: Record<string, unknown>) => Promise<string>;
}

interface PreviewSourceFields {
  readonly description: string;
  readonly bulk: number | null;
  readonly usage: string | null;
}

interface CachedProjection {
  readonly sourceUuid: string;
  readonly previewIdentity: string;
  readonly fieldsIdentity: string;
  readonly value: EquipmentPreviewProjection | null;
}

export function createEquipmentPreviewProjector(
  options: EquipmentPreviewProjectorOptions = {}
): EquipmentPreviewProjector {
  const enrich = options.enrich ?? enrichHtml;
  let cached: CachedProjection | null = null;

  return {
    async project(preview) {
      const fields = previewSourceFields(preview.source);
      if (!fields) return null;
      const fieldsIdentity = JSON.stringify(fields);
      if (
        cached?.sourceUuid === preview.sourceUuid &&
        cached.previewIdentity === preview.previewIdentity &&
        cached.fieldsIdentity === fieldsIdentity
      ) {
        return cached.value;
      }

      let description: string;
      try {
        const enriched = await enrich(fields.description, { async: true });
        if (typeof enriched !== "string") return null;
        description = enriched;
      } catch {
        // Never fall back to rendering un-enriched compendium HTML.
        return null;
      }

      const value = Object.freeze({
        sourceUuid: preview.sourceUuid,
        description,
        bulkLabel: fields.bulk === null ? null : formatBulk(fields.bulk),
        handsLabel: fields.usage === null ? null : handsForUsage(fields.usage),
      });
      cached = { sourceUuid: preview.sourceUuid, previewIdentity: preview.previewIdentity, fieldsIdentity, value };
      return value;
    },
  };
}

function previewSourceFields(source: Readonly<Record<string, unknown>> | null): PreviewSourceFields | null {
  if (!source) return null;
  const system = record(source.system);
  if (!system) return null;

  const description = optionalNestedValue(system, "description", isString);
  const bulk = optionalNestedValue(system, "bulk", isBulk);
  const usage = optionalNestedValue(system, "usage", isString);
  if (!description.valid || !bulk.valid || !usage.valid) return null;

  return {
    description: description.value ?? "",
    bulk: bulk.value,
    usage: usage.value,
  };
}

function optionalNestedValue<T>(
  parent: Readonly<Record<string, unknown>>,
  key: string,
  validate: (value: unknown) => value is T
): { readonly valid: true; readonly value: T | null } | { readonly valid: false } {
  const nestedValue = parent[key];
  if (nestedValue === undefined) return { valid: true, value: null };
  const nested = record(nestedValue);
  if (!nested || !("value" in nested) || !validate(nested.value)) return { valid: false };
  return { valid: true, value: nested.value };
}

function formatBulk(value: number): string {
  const normal = Math.floor(value);
  const light = Math.round((value - normal) * 10);
  if (value === 0) return "—";
  if (light === 0) return String(normal);
  if (normal === 0 && light === 1) return "L";
  if (normal === 0) return `${light}L`;
  return `${normal}; ${light}L`;
}

function handsForUsage(usage: string): string | null {
  switch (usage) {
    case "held-in-one-hand":
      return "1";
    case "held-in-one-plus-hands":
      return "1+";
    case "held-in-one-or-two-hands":
      return "1–2";
    case "held-in-two-hands":
      return "2";
    default:
      return null;
  }
}

function isBulk(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Math.abs(value * 10 - Math.round(value * 10)) < Number.EPSILON
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}
