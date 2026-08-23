import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
  PHYSICAL_GRANT_ROUTE_REGISTRY,
} from "../src/wayfinder/domain/physical-grant-route-registry";
import {
  assertPhysicalGrantRegistry,
  assertPhysicalGrantReportCurrent,
  assertUnsupportedDiscoveryBindings,
  generatePhysicalGrantCoverage,
  renderPhysicalGrantReport,
  verifyPhysicalGrantRegistryAgainstPf2e,
} from "../tools/pf2e-grant-coverage/registry.mjs";

const fixturePath = path.resolve("docs/coverage/pf2e-8.4.1-level1-physical-grants.json");
const reportPath = path.resolve("docs/coverage/pf2e-8.4.1-level1-physical-grants.md");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function registryFixture() {
  return structuredClone(fixture);
}

function route(registry: any, routeId: string) {
  const found = registry.routes.find((entry: any) => entry.routeId === routeId);
  if (!found) throw new Error(`Fixture route ${routeId} is missing.`);
  return found;
}

describe("PF2E physical-grant registry", () => {
  test("validates the authoritative registry and renders route-order-independent current Markdown", () => {
    const registry = registryFixture();

    expect(assertPhysicalGrantRegistry(registry)).toBe(registry);
    const rendered = renderPhysicalGrantReport(registry);
    const reordered = registryFixture();
    reordered.routes.reverse();

    expect(renderPhysicalGrantReport(reordered)).toBe(rendered);
    expect(rendered).toContain("| `supported-native` | 4 |");
    expect(rendered).toContain("| `supported-wayfinder-acquisition` | 1 |");
    expect(rendered).toContain("| `unsupported-handoff` | 46 |");
    expect(rendered).toContain(
      "Scanner version 1 records 1596 source observations and 162 reviewed grant-discovery route keys."
    );
    expect(rendered).toContain("`unclassifiedAdditions` is empty");
    expect(() => assertPhysicalGrantReportCurrent(readFileSync(reportPath, "utf8"), rendered)).not.toThrow();
  });

  test.each([
    ["wrong schema", (registry: any) => (registry.schemaVersion = 2), /schemaVersion must be 1/u],
    ["short source commit", (registry: any) => (registry.source.commit = "abc"), /full lowercase Git SHA/u],
    ["wrong scanner version", (registry: any) => (registry.discovery.scannerVersion = 99), /scannerVersion must be 1/u],
    [
      "bogus scan boundary",
      (registry: any) => (registry.scanBoundary.expectedDocumentCounts = { bogus: 0 }),
      /keys must be exactly/u,
    ],
    [
      "duplicate discovery key",
      (registry: any) => registry.discovery.routeKeys.push(registry.discovery.routeKeys[0]),
      /must not contain duplicates/u,
    ],
    [
      "duplicate route id",
      (registry: any) => (registry.routes[1].routeId = registry.routes[0].routeId),
      /Duplicate physical-grant routeId/u,
    ],
    [
      "unknown classification",
      (registry: any) => (route(registry, "clan-pistol").classification = "silently-ignore"),
      /invalid classification/u,
    ],
    [
      "missing route source policy",
      (registry: any) => delete route(registry, "alchemist-formula-book").sourcePolicy,
      /invalid sourcePolicy/u,
    ],
    [
      "legacy route field alias",
      (registry: any) => (route(registry, "clan-pistol").triggerVariants = []),
      /must use activationVariants/u,
    ],
    [
      "missing route evidence array",
      (registry: any) => delete route(registry, "alchemist-formula-book").links,
      /links must be an array/u,
    ],
    [
      "unsupported route without blocker",
      (registry: any) => delete route(registry, "clan-pistol").blocker,
      /needs an explicit pre-review blocker/u,
    ],
    [
      "native route with acquisition materializer",
      (registry: any) => (route(registry, "alchemist-formula-book").materializer = "wayfinder-acquisition"),
      /must use the pf2e-native materializer/u,
    ],
    [
      "supported source path mutation",
      (registry: any) => (route(registry, "alchemist-formula-book").nodes = route(registry, "dwarf-clan-dagger").nodes),
      /omits a runtime grant source/u,
    ],
    [
      "Titan selector mutation",
      (registry: any) => (route(registry, "giant-instinct-titan-mauler").terminalSelector.itemType = "armor"),
      /Only the giant-instinct-titan-mauler profile/u,
    ],
    [
      "runtime blocker reason drift",
      (registry: any) => (route(registry, "clan-pistol").blocker.reasonCode = "owned-item-dependency"),
      /differs from runtime coverage/u,
    ],
    [
      "runtime trigger drift",
      (registry: any) =>
        route(registry, "clan-pistol").activationVariants[0].push({
          sourceUuid: CLASS_GRANT_PROFILE_UUIDS.dwarfAncestry,
        }),
      /differs from runtime coverage/u,
    ],
    [
      "missing runtime route",
      (registry: any) => (registry.routes = registry.routes.filter((entry: any) => entry.routeId !== "clan-pistol")),
      /route count differs/u,
    ],
    [
      "unclassified addition",
      (registry: any) => registry.unclassifiedAdditions.push("new-route"),
      /unclassifiedAdditions must be an empty array/u,
    ],
  ])("rejects fixture mutation: %s", (_label, mutate, message) => {
    const registry = registryFixture();
    mutate(registry);

    expect(() => assertPhysicalGrantRegistry(registry)).toThrow(message);
  });

  test("matches every centralized runtime route contract exactly", () => {
    const registry = registryFixture();
    expect(registry.source.pf2eVersion).toBe(PHYSICAL_GRANT_COVERAGE_PF2E_VERSION);
    expect(route(registry, "alchemist-formula-book").nodes).toEqual([
      CLASS_GRANT_PROFILE_UUIDS.alchemistClass,
      CLASS_GRANT_PROFILE_UUIDS.alchemyFeature,
      CLASS_GRANT_PROFILE_UUIDS.formulaBookFeature,
      CLASS_GRANT_PROFILE_UUIDS.formulaBookItem,
    ]);
    expect(route(registry, "giant-instinct-titan-mauler").nodes).toEqual([
      CLASS_GRANT_PROFILE_UUIDS.barbarianClass,
      CLASS_GRANT_PROFILE_UUIDS.instinctFeature,
      CLASS_GRANT_PROFILE_UUIDS.giantInstinct,
    ]);

    const registryContracts = registry.routes.map(normalizeRegistryRoute).sort(byRouteId);
    const runtimeContracts = PHYSICAL_GRANT_ROUTE_REGISTRY.map(normalizeRuntimeRoute).sort(byRouteId);
    expect(registryContracts).toEqual(runtimeContracts);
    expect(route(registry, "ancient-elf-alchemist-formula-book").semanticChecks).toHaveLength(1);
    expect(route(registry, "munitions-crafter-formula-book").semanticChecks).toHaveLength(1);
  });

  test("rejects an unsupported terminal relationship mutation even when both UUIDs remain known", () => {
    const clanPistol = structuredClone(route(registryFixture(), "clan-pistol"));
    const sourceUuid = clanPistol.nodes.find((uuid: string) => !clanPistol.terminalSourceUuids.includes(uuid));
    const terminalUuid = clanPistol.terminalSourceUuids[0];
    const scan = {
      observedRoutes: [
        {
          nodeUuids: [sourceUuid, terminalUuid],
          rootUuid: sourceUuid,
          routeKey: "fixture-clan-pistol-route",
          terminal: { kind: "equipment", uuid: terminalUuid },
        },
      ],
    };

    expect(() =>
      assertUnsupportedDiscoveryBindings({ routes: [clanPistol] }, scan, { expectedClaimCount: 1 })
    ).not.toThrow();
    scan.observedRoutes[0].nodeUuids = [CLASS_GRANT_PROFILE_UUIDS.dwarfAncestry, terminalUuid];
    expect(() => assertUnsupportedDiscoveryBindings({ routes: [clanPistol] }, scan, { expectedClaimCount: 1 })).toThrow(
      /no discovered source relationship/u
    );
  });

  test("delegates an exact clean pinned checkout to both scanner and row-evidence verification", async () => {
    const registry = registryFixture();
    const readGitState = vi.fn(async () => ({ commit: registry.source.commit, dirtyEntries: [] }));
    const scanResult = { findings: null, observationKeys: [], routeKeys: [] };
    const scanCoverage = vi.fn(async () => scanResult);
    const verifySourceEvidence = vi.fn(async () => undefined);

    await expect(
      verifyPhysicalGrantRegistryAgainstPf2e({
        pf2eRepo: "fixture-pf2e",
        readGitState,
        registry,
        scanCoverage,
        verifySourceEvidence,
      })
    ).resolves.toBe(scanResult);
    expect(readGitState).toHaveBeenCalledWith(path.resolve("fixture-pf2e"));
    expect(scanCoverage).toHaveBeenCalledWith({
      failOnDiff: true,
      packRoot: "packs/pf2e",
      pf2eRepo: path.resolve("fixture-pf2e"),
      registry,
    });
    expect(verifySourceEvidence).toHaveBeenCalledWith({
      pf2eRepo: path.resolve("fixture-pf2e"),
      registry,
      scan: scanResult,
    });
  });

  test("rejects a wrong or dirty PF2E Git state before scanning", async () => {
    const registry = registryFixture();
    const scanCoverage = vi.fn();
    const verifySourceEvidence = vi.fn();

    await expect(
      verifyPhysicalGrantRegistryAgainstPf2e({
        pf2eRepo: "fixture-pf2e",
        readGitState: async () => ({ commit: "b".repeat(40), dirtyEntries: [] }),
        registry,
        scanCoverage,
        verifySourceEvidence,
      })
    ).rejects.toThrow(/does not match the registry pin/u);
    await expect(
      verifyPhysicalGrantRegistryAgainstPf2e({
        pf2eRepo: "fixture-pf2e",
        readGitState: async () => ({ commit: registry.source.commit, dirtyEntries: [" M packs/pf2e/item.json"] }),
        registry,
        scanCoverage,
        verifySourceEvidence,
      })
    ).rejects.toThrow(/checkout is dirty/u);
    expect(scanCoverage).not.toHaveBeenCalled();
    expect(verifySourceEvidence).not.toHaveBeenCalled();
  });

  test("checks generated report contents while tolerating platform line endings", () => {
    const report = renderPhysicalGrantReport(registryFixture());

    expect(() => assertPhysicalGrantReportCurrent(report.replaceAll("\n", "\r\n"), report)).not.toThrow();
    expect(() => assertPhysicalGrantReportCurrent(`${report}stale`, report)).toThrow(/report is stale/u);
  });

  test("requires live source verification for the public pre-release gate", async () => {
    const resolveSourceRepo = vi.fn(async () => "");

    await expect(
      generatePhysicalGrantCoverage({
        registryPath: fixturePath,
        requireSource: true,
        resolveSourceRepo,
      })
    ).rejects.toThrow(/source verification is required/u);
    expect(resolveSourceRepo).toHaveBeenCalledOnce();

    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    expect(packageJson.scripts["check:physical-grants"]).toContain("--check --require-source");
    expect(packageJson.scripts["check:physical-grant-report"]).toBe(
      "node tools/pf2e-grant-coverage/registry.mjs --check"
    );
    expect(packageJson.scripts.check).toContain("npm run check:physical-grant-report");
  });
});

function normalizeRegistryRoute(route: any) {
  return {
    routeId: route.routeId,
    label: route.label,
    classification: route.classification,
    profileId: route.profileId ?? null,
    materializer: route.materializer ?? null,
    sourcePolicy: route.sourcePolicy,
    activationVariants: route.activationVariants,
    terminalSourceUuids: route.terminalSourceUuids,
    blocker: route.blocker ?? null,
  };
}

function normalizeRuntimeRoute(route: (typeof PHYSICAL_GRANT_ROUTE_REGISTRY)[number]) {
  return {
    routeId: route.routeId,
    label: route.label,
    classification: route.classification,
    profileId: route.classification === "unsupported-handoff" ? null : route.profileId,
    materializer: route.classification === "unsupported-handoff" ? null : route.materializer,
    sourcePolicy: route.sourcePolicy,
    activationVariants: route.activationVariants,
    terminalSourceUuids: route.terminalSourceUuids,
    blocker: route.classification === "unsupported-handoff" ? route.blocker : null,
  };
}

function byRouteId(left: { routeId: string }, right: { routeId: string }): number {
  return left.routeId.localeCompare(right.routeId);
}
