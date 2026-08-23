import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ClassGrantProfileId,
  PHYSICAL_GRANT_ROUTE_REGISTRY,
  PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS,
  physicalGrantRouteById,
  physicalGrantScannerRouteDisposition,
  SUPPORTED_PHYSICAL_GRANT_ROUTES,
  supportedPhysicalGrantRoute,
  UNSUPPORTED_PHYSICAL_GRANT_ROUTES,
} from "../src/wayfinder/domain/physical-grant-route-registry";

interface CoverageRoute {
  routeId: string;
  label: string;
  classification: "supported-native" | "supported-wayfinder-acquisition" | "unsupported-handoff";
  profileId?: string;
  materializer?: string;
  sourcePolicy: string;
  activationVariants: Array<
    Array<{ sourceUuid: string; slotId?: string; channel?: "selections" | "branchSelections" }>
  >;
  terminalSourceUuids: string[];
  blocker?: { preReview: boolean; reasonCode: string; detail: string };
}

const coverage = JSON.parse(readFileSync(resolve("docs/coverage/pf2e-8.4.1-level1-physical-grants.json"), "utf8")) as {
  routes: CoverageRoute[];
  discovery: { routeKeys: string[] };
  unclassifiedAdditions: unknown[];
};

describe("physical-grant route registry", () => {
  it("exactly owns every pinned route classification and runtime activation fact", () => {
    expect(PHYSICAL_GRANT_ROUTE_REGISTRY).toHaveLength(51);
    expect(new Set(PHYSICAL_GRANT_ROUTE_REGISTRY.map((route) => route.routeId)).size).toBe(51);
    expect(coverage.unclassifiedAdditions).toEqual([]);

    const expected = coverage.routes.map(normalizeCoverageRoute).sort(byRouteId);
    const actual = PHYSICAL_GRANT_ROUTE_REGISTRY.map(normalizeRuntimeRoute).sort(byRouteId);
    expect(actual).toEqual(expected);
  });

  it("partitions every route into one supported or unsupported runtime lane", () => {
    expect(SUPPORTED_PHYSICAL_GRANT_ROUTES).toHaveLength(5);
    expect(UNSUPPORTED_PHYSICAL_GRANT_ROUTES).toHaveLength(46);
    expect([
      ...SUPPORTED_PHYSICAL_GRANT_ROUTES.map((route) => route.routeId),
      ...UNSUPPORTED_PHYSICAL_GRANT_ROUTES.map((route) => route.routeId),
    ]).toHaveLength(51);
  });

  it("explicitly dispositions every independently scanned route key", () => {
    const reviewedKeys = Object.keys(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS).sort();
    expect(reviewedKeys).toEqual([...coverage.discovery.routeKeys].sort());
    const physical = Object.values(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS).filter(
      (disposition) => disposition.classification === "physical-grant"
    );
    const nonPhysical = Object.values(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS).filter(
      (disposition) => disposition.classification === "reviewed-non-physical"
    );
    expect(physical).toHaveLength(59);
    expect(nonPhysical).toHaveLength(103);
    for (const disposition of physical) {
      if (disposition.classification !== "physical-grant") continue;
      expect(disposition.routeIds.length).toBeGreaterThan(0);
      expect(new Set(disposition.routeIds).size).toBe(disposition.routeIds.length);
      for (const routeId of disposition.routeIds) {
        expect(physicalGrantRouteById(routeId)).not.toBeNull();
      }
    }
  });

  it("declares the exact write, identity, and budget outcome for each supported materializer", () => {
    const native = SUPPORTED_PHYSICAL_GRANT_ROUTES.filter((route) => route.classification === "supported-native");
    const acquisition = SUPPORTED_PHYSICAL_GRANT_ROUTES.filter(
      (route) => route.classification === "supported-wayfinder-acquisition"
    );

    expect(native).toHaveLength(4);
    expect(native.every((route) => route.materializer === "pf2e-native")).toBe(true);
    expect(native.every((route) => route.expectedOutcome.acquisitionItemCreateCount === 0)).toBe(true);
    expect(native.every((route) => route.expectedOutcome.acquisitionStamped === false)).toBe(true);
    expect(acquisition).toHaveLength(1);
    expect(acquisition[0]).toMatchObject({
      profileId: "giant-instinct-titan-mauler",
      materializer: "wayfinder-acquisition",
      expectedOutcome: { acquisitionItemCreateCount: 1, acquisitionStamped: true, budgetChargeCopper: 0 },
    });
    expect(SUPPORTED_PHYSICAL_GRANT_ROUTES.every((route) => route.expectedOutcome.budgetChargeCopper === 0)).toBe(true);
  });

  it("resolves supported and unsupported routes through one total registry", () => {
    for (const route of PHYSICAL_GRANT_ROUTE_REGISTRY) {
      expect(physicalGrantRouteById(route.routeId)).toBe(route);
    }
    expect(physicalGrantRouteById("missing-route")).toBeNull();
    expect(supportedPhysicalGrantRoute("dwarf-clan-dagger")).toBe(physicalGrantRouteById("dwarf-clan-dagger"));
  });

  it("deep-freezes the executable route facts", () => {
    expect(Object.isFrozen(PHYSICAL_GRANT_ROUTE_REGISTRY)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_PHYSICAL_GRANT_ROUTES)).toBe(true);
    expect(Object.isFrozen(UNSUPPORTED_PHYSICAL_GRANT_ROUTES)).toBe(true);
    expect(Object.isFrozen(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS)).toBe(true);
    for (const disposition of Object.values(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS)) {
      expect(Object.isFrozen(disposition)).toBe(true);
      if (disposition.classification === "physical-grant") expect(Object.isFrozen(disposition.routeIds)).toBe(true);
    }
    for (const route of PHYSICAL_GRANT_ROUTE_REGISTRY) {
      expect(Object.isFrozen(route)).toBe(true);
      expect(Object.isFrozen(route.activationVariants)).toBe(true);
      expect(Object.isFrozen(route.terminalSourceUuids)).toBe(true);
      for (const variant of route.activationVariants) {
        expect(Object.isFrozen(variant)).toBe(true);
        for (const requirement of variant) {
          expect(Object.isFrozen(requirement)).toBe(true);
        }
      }
      if (route.classification === "unsupported-handoff") {
        expect(Object.isFrozen(route.blocker)).toBe(true);
      } else {
        expect(Object.isFrozen(route.grant)).toBe(true);
        expect(Object.isFrozen(route.grant.nativeGrantChainSourceUuids)).toBe(true);
        expect(Object.isFrozen(route.expectedOutcome)).toBe(true);
      }
    }
  });

  it("fails closed for absent or unsupported profile lookups and declares every rejection", () => {
    expect(physicalGrantRouteById("missing-route")).toBeNull();
    expect(physicalGrantScannerRouteDisposition("missing-route-key")).toBeNull();
    expect(physicalGrantScannerRouteDisposition("toString")).toBeNull();
    expect(physicalGrantScannerRouteDisposition("constructor")).toBeNull();
    expect(physicalGrantScannerRouteDisposition("__proto__")).toBeNull();
    expect(physicalGrantScannerRouteDisposition(coverage.discovery.routeKeys[0]!)).not.toBeNull();
    expect(() => supportedPhysicalGrantRoute("missing-route" as ClassGrantProfileId)).toThrow(
      "Unknown supported physical-grant profile missing-route."
    );
    expect(() =>
      supportedPhysicalGrantRoute(UNSUPPORTED_PHYSICAL_GRANT_ROUTES[0]!.routeId as ClassGrantProfileId)
    ).toThrow("Unknown supported physical-grant profile");
    expect(
      UNSUPPORTED_PHYSICAL_GRANT_ROUTES.every(
        (route) => route.blocker.preReview && route.blocker.reasonCode.length > 0 && route.blocker.detail.length > 0
      )
    ).toBe(true);
  });
});

function normalizeCoverageRoute(route: CoverageRoute) {
  return {
    routeId: route.routeId,
    label: route.label,
    classification: route.classification,
    profileId: route.profileId ?? null,
    materializer: route.materializer ?? null,
    sourcePolicy: route.sourcePolicy,
    activationVariants: route.activationVariants,
    terminals: route.terminalSourceUuids,
    blocker: route.blocker
      ? {
          preReview: route.blocker.preReview,
          reasonCode: route.blocker.reasonCode,
          detail: route.blocker.detail,
        }
      : null,
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
    terminals: route.terminalSourceUuids,
    blocker: route.classification === "unsupported-handoff" ? route.blocker : null,
  };
}

function byRouteId(left: { routeId: string }, right: { routeId: string }): number {
  return left.routeId.localeCompare(right.routeId);
}
