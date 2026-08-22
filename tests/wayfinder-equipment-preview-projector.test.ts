import { describe, expect, it, vi } from "vitest";
import type { EquipmentCataloguePreview } from "../src/wayfinder/application/equipment-catalogue-service";
import {
  createEquipmentPreviewProjector,
  type EquipmentPreviewProjection,
} from "../src/wayfinder/application/equipment-preview-projector";

describe("equipment preview projector", () => {
  it.each([
    [0, "carried", "—", null],
    [0.1, "held-in-one-hand", "L", "1"],
    [0.3, "held-in-one-plus-hands", "3L", "1+"],
    [1, "held-in-one-or-two-hands", "1", "1–2"],
    [2.4, "held-in-two-hands", "2; 4L", "2"],
  ] as const)("enriches selected source HTML and formats Bulk %s with usage %s", async (bulk, usage, bulkLabel, handsLabel) => {
    const enrich = vi.fn(async (content: string) => `<section data-sanitized>${content}</section>`);
    const projector = createEquipmentPreviewProjector({ enrich });

    await expect(projector.project(preview({ bulk, usage }))).resolves.toEqual({
      sourceUuid: SOURCE_UUID,
      description: "<section data-sanitized><p>@UUID[Compendium.pf2e.actionspf2e.Item.Interact]</p></section>",
      bulkLabel,
      handsLabel,
    } satisfies EquipmentPreviewProjection);
    expect(enrich).toHaveBeenCalledWith("<p>@UUID[Compendium.pf2e.actionspf2e.Item.Interact]</p>", {
      async: true,
    });
  });

  it("keeps only the selected source projection hot and refreshes changed hydrated fields", async () => {
    const enrich = vi.fn(async (content: string) => `<p>${content}</p>`);
    const projector = createEquipmentPreviewProjector({ enrich });
    const first = preview({ description: "First" });

    await projector.project(first);
    await projector.project(first);
    expect(enrich).toHaveBeenCalledTimes(1);

    await projector.project(preview({ sourceUuid: `${SOURCE_UUID}-other`, description: "Other" }));
    await projector.project(first);
    expect(enrich).toHaveBeenCalledTimes(3);

    await projector.project(preview({ description: "Changed after invalidation" }));
    expect(enrich).toHaveBeenCalledTimes(4);
  });

  it.each([
    null,
    {},
    { system: [] },
    { system: { description: { value: 42 } } },
    { system: { description: { value: "Safe" }, bulk: { value: "L" } } },
    { system: { description: { value: "Safe" }, usage: { value: ["held-in-one-hand"] } } },
    { system: { description: { value: "Safe" }, bulk: { value: -1 } } },
    { system: { description: { value: "Safe" }, bulk: { value: 0.25 } } },
  ])("fails closed on malformed hydrated source %#", async (source) => {
    const enrich = vi.fn(async (content: string) => content);
    const projector = createEquipmentPreviewProjector({ enrich });

    await expect(projector.project(preview({ source }))).resolves.toBeNull();
    expect(enrich).not.toHaveBeenCalled();
  });

  it("does not expose raw HTML when enrichment fails", async () => {
    const projector = createEquipmentPreviewProjector({
      enrich: vi.fn(async () => {
        throw new Error("Sanitizer unavailable");
      }),
    });

    await expect(projector.project(preview())).resolves.toBeNull();
  });
});

const SOURCE_UUID = "Compendium.pf2e.equipment-srd.Item.preview";

function preview(
  options: {
    readonly sourceUuid?: string;
    readonly description?: string;
    readonly bulk?: number;
    readonly usage?: string;
    readonly source?: Readonly<Record<string, unknown>> | null;
  } = {}
): EquipmentCataloguePreview {
  const sourceUuid = options.sourceUuid ?? SOURCE_UUID;
  return {
    sourceUuid,
    previewIdentity: "equipment-preview-v1-test",
    source:
      options.source === undefined
        ? {
            system: {
              description: {
                value: options.description ?? "<p>@UUID[Compendium.pf2e.actionspf2e.Item.Interact]</p>",
              },
              bulk: { value: options.bulk ?? 0.1 },
              usage: { value: options.usage ?? "held-in-one-hand" },
            },
          }
        : options.source,
    entry: null,
  };
}
