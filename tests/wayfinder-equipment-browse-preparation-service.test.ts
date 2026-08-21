import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BROWSE_PHYSICAL_PREPARATION_ENTRIES,
  prepareTransientBrowsePhysicalItems,
} from "../src/wayfinder/application/equipment-browse-preparation-service";

describe("equipment browse physical preparation", () => {
  beforeEach(() => {
    PreparedBrowseActor.reset();
    vi.stubGlobal("CONFIG", { Actor: { documentClass: PreparedBrowseActor } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps prepared results in stable order while deleting each item and its grants", async () => {
    const results = await prepareTransientBrowsePhysicalItems({
      actor: sourceActor(),
      targetLevel: 5,
      targetSize: "large",
      entries: [
        { key: "alpha", source: physicalSource("alpha", { spawnGrant: true }) },
        { key: "bravo", source: physicalSource("bravo") },
      ],
    });

    expect(results).toMatchObject([
      {
        key: "alpha",
        prepared: { system: { preparedForLevel: 5, preparedFrom: "alpha", size: "lg" } },
        error: null,
      },
      {
        key: "bravo",
        prepared: { system: { preparedForLevel: 5, preparedFrom: "bravo", size: "lg" } },
        error: null,
      },
    ]);
    const actor = PreparedBrowseActor.instances[0]!;
    expect(actor.context).toEqual({ temporary: true });
    expect(actor.source).toMatchObject({ name: "Wayfinder browse-price preparation 5" });
    expect(actor.source.items.map((source: Record<string, unknown>) => source._id)).toEqual([
      "wfbrowse00000000",
      "wfbrowse00000001",
    ]);
    expect(actor.deletedItemIds).toEqual(["wfbrowse00000000", "grant-wfbrowse00000000", "wfbrowse00000001"]);
    expect(actor.items.contents).toEqual([]);
  });

  it("isolates a failed entry, cleans its partial documents, and continues in order", async () => {
    const results = await prepareTransientBrowsePhysicalItems({
      actor: sourceActor(),
      targetLevel: 1,
      targetSize: "medium",
      entries: [
        { key: "good-before", source: physicalSource("good-before") },
        { key: "failed", source: physicalSource("failed", { omitPrepared: true }) },
        { key: "good-after", source: physicalSource("good-after") },
      ],
    });

    expect(results.map((result) => result.key)).toEqual(["good-before", "failed", "good-after"]);
    expect(results[0]).toMatchObject({ prepared: { system: { size: "med" } }, error: null });
    expect(results[1]).toMatchObject({
      prepared: null,
      error: expect.objectContaining({ message: expect.stringMatching(/entry failed/i) }),
    });
    expect(results[2]).toMatchObject({ prepared: { system: { size: "med" } }, error: null });
    const actor = PreparedBrowseActor.instances[0]!;
    expect(actor.deletedItemIds).toEqual(["wfbrowse00000000", "wfbrowse00000002"]);
    expect(actor.items.contents).toEqual([]);
  });

  it("rejects batches beyond the visible-page bound and duplicate mappings before actor creation", async () => {
    const tooMany = Array.from({ length: MAX_BROWSE_PHYSICAL_PREPARATION_ENTRIES + 1 }, (_, index) => ({
      key: `entry-${index}`,
      source: physicalSource(`entry-${index}`),
    }));

    await expect(
      prepareTransientBrowsePhysicalItems({
        actor: sourceActor(),
        targetLevel: 1,
        targetSize: "medium",
        entries: tooMany,
      })
    ).rejects.toThrow(/at most 12/i);
    await expect(
      prepareTransientBrowsePhysicalItems({
        actor: sourceActor(),
        targetLevel: 1,
        targetSize: "medium",
        entries: [
          { key: "duplicate", source: physicalSource("first") },
          { key: "duplicate", source: physicalSource("second") },
        ],
      })
    ).rejects.toThrow(/unique non-empty/i);
    const nested = physicalSource("nested");
    (nested.system as Record<string, unknown>).subitems = [{ system: { rules: [] } }];
    await expect(
      prepareTransientBrowsePhysicalItems({
        actor: sourceActor(),
        targetLevel: 1,
        targetSize: "medium",
        entries: [{ key: "nested", source: nested }],
      })
    ).rejects.toThrow(/subitem-free/i);
    expect(PreparedBrowseActor.instances).toEqual([]);
  });
});

class PreparedBrowseActor {
  static instances: PreparedBrowseActor[] = [];

  readonly source: Record<string, any>;
  readonly context: unknown;
  readonly items = {
    contents: [] as PreparedBrowseItem[],
    get: (id: string) => this.items.contents.find((item) => item.id === id),
    delete: (id: string) => {
      this.deletedItemIds.push(id);
      this.items.contents = this.items.contents.filter((item) => item.id !== id);
    },
  };
  readonly deletedItemIds: string[] = [];

  constructor(source: unknown, context: unknown) {
    this.source = structuredClone(source) as Record<string, any>;
    this.context = context;
    PreparedBrowseActor.instances.push(this);
    for (const itemSource of this.source.items) {
      if (itemSource.system.omitPrepared === true) continue;
      this.items.contents.push(
        new PreparedBrowseItem(itemSource._id, {
          ...itemSource.system,
          preparedForLevel: this.source.system.details.level.value,
          preparedFrom: itemSource.name,
        })
      );
      if (itemSource.system.spawnGrant === true) {
        this.items.contents.push(new PreparedBrowseItem(`grant-${itemSource._id}`, { granted: true }));
      }
    }
  }

  static reset(): void {
    PreparedBrowseActor.instances = [];
  }
}

class PreparedBrowseItem {
  constructor(
    readonly id: string,
    readonly system: Readonly<Record<string, unknown>>
  ) {}
}

function sourceActor() {
  return {
    toObject: () => ({
      _id: "actor-source",
      name: "Source Actor",
      type: "character",
      system: { details: { level: { value: 1 } } },
      items: [{ _id: "existing", type: "ancestry" }],
    }),
  };
}

function physicalSource(
  name: string,
  options: { readonly spawnGrant?: boolean; readonly omitPrepared?: boolean } = {}
) {
  return {
    _id: `source-${name}`,
    name,
    type: "equipment",
    system: {
      size: "med",
      price: { sizeSensitive: true, value: { cp: 1 } },
      material: { type: null, grade: null },
      rules: [],
      ...options,
    },
  };
}
