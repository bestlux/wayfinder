import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createPhysicalGrantDiscoverySnapshot,
  diffPhysicalGrantRoutes,
  discoverPhysicalGrantRoutes,
  scanPf2eGrantCoverage,
} from "../tools/pf2e-grant-coverage/scan.mjs";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("PF2E physical-grant source discovery", () => {
  test("recursively discovers level-one static, choice-backed, and dynamic equipment routes", async () => {
    const fixture = await createFixture();

    const discovery = await discoverPhysicalGrantRoutes({ pf2eRepo: fixture.root });

    expect(discovery.roots.map((root: { uuid: string }) => root.uuid)).toContain(fixture.uuids.classRoot);
    expect(discovery.roots.map((root: { uuid: string }) => root.uuid)).not.toContain(fixture.uuids.levelTwoFeat);
    expect(discovery.reachableDocumentUuids).toContain(fixture.uuids.classFeature);
    expect(discovery.reachableDocumentUuids).toContain(fixture.uuids.orphanFeature);
    expect(discovery.reachableDocumentUuids).not.toContain(fixture.uuids.levelTwoFeature);

    const equipmentRoutes = discovery.observedRoutes.filter(
      (route: { terminal: { kind: string } }) => route.terminal.kind === "equipment"
    );
    expect(equipmentRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeUuids: [fixture.uuids.classRoot, fixture.uuids.classFeature, fixture.uuids.equipmentOne],
          rootFamily: "class",
          terminal: { kind: "equipment", uuid: fixture.uuids.equipmentOne },
        }),
        expect.objectContaining({
          nodeUuids: [fixture.uuids.ancestryRoot, fixture.uuids.ancestryFeature, fixture.uuids.equipmentTwo],
          rootFamily: "ancestry",
          terminal: { kind: "equipment", uuid: fixture.uuids.equipmentTwo },
        }),
        expect.objectContaining({
          nodeUuids: [fixture.uuids.backgroundRoot, fixture.uuids.equipmentOne],
          rootFamily: "background",
          terminal: { kind: "equipment", uuid: fixture.uuids.equipmentOne },
        }),
      ])
    );
    expect(
      equipmentRoutes.filter(
        (route: { rootUuid: string; terminal: { uuid: string } }) =>
          route.rootUuid === fixture.uuids.ancestryRoot && route.terminal.uuid === fixture.uuids.equipmentTwo
      )
    ).toHaveLength(2);
    expect(
      discovery.observedRoutes.some(
        (route: { rootUuid: string; terminal: { kind: string } }) =>
          route.rootUuid === fixture.uuids.ancestryRoot && route.terminal.kind === "dynamic"
      )
    ).toBe(true);
    expect(discovery.observations.map((entry: { kind: string }) => entry.kind)).toEqual(
      expect.arrayContaining(["system.items", "ChoiceSet", "GrantItem"])
    );
  });

  test("detects a GrantItem added to an existing document without relying on pack counts", async () => {
    const fixture = await createFixture();
    const reviewed = await discoverPhysicalGrantRoutes({ pf2eRepo: fixture.root });
    const registry = registryFor(reviewed);

    await fixture.addGrantItem(fixture.uuids.equipmentTwo);
    const changed = await discoverPhysicalGrantRoutes({ pf2eRepo: fixture.root });
    const findings = diffPhysicalGrantRoutes({ discovery: changed, registry });

    expect(changed.roots).toHaveLength(reviewed.roots.length);
    expect(findings.unexpectedObservationKeys).toHaveLength(1);
    expect(findings.unexpectedRouteKeys.length).toBeGreaterThan(0);
    await expect(scanPf2eGrantCoverage({ pf2eRepo: fixture.root, registry })).rejects.toThrow(
      /differs from the reviewed registry/u
    );
  });

  test("reports both upstream additions and stale registry entries", async () => {
    const fixture = await createFixture();
    const discovery = await discoverPhysicalGrantRoutes({ pf2eRepo: fixture.root });
    const registry = registryFor(discovery);
    const removedObservation = registry.discovery.observationKeys.shift();
    const removedRoute = registry.discovery.routeKeys.shift();
    registry.discovery.observationKeys.push("source-observation-v1|stale");
    registry.discovery.routeKeys.push("physical-route-v1|stale");

    const findings = diffPhysicalGrantRoutes({ discovery, registry });

    expect(findings.unexpectedObservationKeys).toContain(removedObservation);
    expect(findings.missingObservationKeys).toContain("source-observation-v1|stale");
    expect(findings.unexpectedRouteKeys).toContain(removedRoute);
    expect(findings.missingRouteKeys).toContain("physical-route-v1|stale");
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinder-pf2e-grants-"));
  tempDirectories.push(root);
  const sourceRoot = path.join(root, "packs", "pf2e");
  const packs = [
    ["ancestries", "ancestries"],
    ["ancestryfeatures", "ancestry-features"],
    ["backgrounds", "backgrounds"],
    ["classes", "classes"],
    ["classfeatures", "class-features"],
    ["equipment-srd", "equipment"],
    ["feats-srd", "feats"],
    ["heritages", "heritages"],
  ] as const;
  await Promise.all(packs.map(([, directory]) => mkdir(path.join(sourceRoot, directory), { recursive: true })));
  await writeJson(path.join(root, "system.pf2e.json"), {
    packs: packs.map(([name, directory]) => ({ name, path: `packs/${directory}`, type: "Item" })),
    version: "8.4.1-test",
  });

  const ids = {
    ancestryFeature: "ANCFTR0000000001",
    ancestryRoot: "ANCESTRY00000001",
    backgroundRoot: "BKGROUND00000001",
    classFeature: "CLSFTR0000000001",
    classRoot: "CLASS00000000001",
    equipmentOne: "EQUIPMENT0000001",
    equipmentTwo: "EQUIPMENT0000002",
    levelTwoFeat: "LEVEL2FEAT000001",
    levelTwoFeature: "LEVEL2FTR0000001",
    orphanFeature: "ORPHANFTR0000001",
  };
  const uuids = {
    ancestryFeature: uuid("ancestryfeatures", ids.ancestryFeature),
    ancestryRoot: uuid("ancestries", ids.ancestryRoot),
    backgroundRoot: uuid("backgrounds", ids.backgroundRoot),
    classFeature: uuid("classfeatures", ids.classFeature),
    classRoot: uuid("classes", ids.classRoot),
    equipmentOne: uuid("equipment-srd", ids.equipmentOne),
    equipmentTwo: uuid("equipment-srd", ids.equipmentTwo),
    levelTwoFeat: uuid("feats-srd", ids.levelTwoFeat),
    levelTwoFeature: uuid("classfeatures", ids.levelTwoFeature),
    orphanFeature: uuid("classfeatures", ids.orphanFeature),
  };

  const classFeaturePath = path.join(sourceRoot, "class-features", "starting-tool.json");
  const orphanFeaturePath = path.join(sourceRoot, "class-features", "orphan-feature.json");
  const classFeature = item(ids.classFeature, "Starting Tool", "feat", {
    level: { value: 1 },
    rules: [{ key: "GrantItem", uuid: "Compendium.pf2e.equipment-srd.Item.Training Blade" }],
  });
  await Promise.all([
    writeJson(
      path.join(sourceRoot, "classes", "test-class.json"),
      item(ids.classRoot, "Test Class", "class", {
        items: {
          first: {
            level: 1,
            name: "Starting Tool",
            uuid: "Compendium.pf2e.classfeatures.Item.Starting Tool",
          },
          later: {
            level: 2,
            name: "Later Feature",
            uuid: uuids.levelTwoFeature,
          },
        },
      })
    ),
    writeJson(classFeaturePath, classFeature),
    writeJson(
      orphanFeaturePath,
      item(ids.orphanFeature, "Orphan Feature", "feat", {
        level: { value: 1 },
        rules: [] as { key: string; uuid: string }[],
      })
    ),
    writeJson(
      path.join(sourceRoot, "class-features", "later-feature.json"),
      item(ids.levelTwoFeature, "Later Feature", "feat", {
        level: { value: 2 },
        rules: [{ key: "GrantItem", uuid: uuids.equipmentTwo }],
      })
    ),
    writeJson(
      path.join(sourceRoot, "ancestries", "test-ancestry.json"),
      item(ids.ancestryRoot, "Test Ancestry", "ancestry", {
        items: {
          gift: {
            level: 0,
            name: "Ancestry Gift",
            uuid: uuids.ancestryFeature,
          },
        },
      })
    ),
    writeJson(
      path.join(sourceRoot, "ancestry-features", "ancestry-gift.json"),
      item(ids.ancestryFeature, "Ancestry Gift", "feat", {
        level: { value: 0 },
        rules: [
          {
            allowedDrops: { predicate: ["item:type:weapon"] },
            choices: [{ value: "Compendium.pf2e.equipment-srd.Item.Practice Shield" }],
            flag: "gift",
            key: "ChoiceSet",
          },
          {
            choices: [{ value: "Compendium.pf2e.equipment-srd.Item.Practice Shield" }],
            flag: "gift",
            key: "ChoiceSet",
            predicate: ["variant:second"],
          },
          { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.gift}" },
        ],
      })
    ),
    writeJson(
      path.join(sourceRoot, "backgrounds", "test-background.json"),
      item(ids.backgroundRoot, "Test Background", "background", {
        rules: [
          {
            key: "GrantItem",
            uuid: `@UUID[${uuids.equipmentOne}]{Training Blade}`,
          },
        ],
      })
    ),
    writeJson(
      path.join(sourceRoot, "feats", "level-two-feat.json"),
      item(ids.levelTwoFeat, "Level Two Feat", "feat", {
        category: "general",
        level: { value: 2 },
        rules: [{ key: "GrantItem", uuid: uuids.equipmentTwo }],
      })
    ),
    writeJson(
      path.join(sourceRoot, "equipment", "training-blade.json"),
      item(ids.equipmentOne, "Training Blade", "weapon", { level: { value: 0 } })
    ),
    writeJson(
      path.join(sourceRoot, "equipment", "practice-shield.json"),
      item(ids.equipmentTwo, "Practice Shield", "shield", { level: { value: 0 } })
    ),
  ]);

  return {
    async addGrantItem(targetUuid: string) {
      const orphanFeature = item(ids.orphanFeature, "Orphan Feature", "feat", {
        level: { value: 1 },
        rules: [{ key: "GrantItem", uuid: targetUuid }],
      });
      await writeJson(orphanFeaturePath, orphanFeature);
    },
    root,
    uuids,
  };
}

function registryFor(discovery: { observationKeys: string[]; routeKeys: string[]; unresolvedReferences: string[] }) {
  return {
    discovery: createPhysicalGrantDiscoverySnapshot(discovery),
  };
}

function item<TSystem extends Record<string, unknown>>(id: string, name: string, type: string, system: TSystem) {
  return { _id: id, name, system, type };
}

function uuid(pack: string, id: string) {
  return `Compendium.pf2e.${pack}.Item.${id}`;
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
