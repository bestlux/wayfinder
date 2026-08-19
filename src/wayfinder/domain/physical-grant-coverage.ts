import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import type { WayfinderDraftReadiness, WayfinderStepIssue } from "./step-evaluation.js";

export const PHYSICAL_GRANT_COVERAGE_PF2E_VERSION = "8.4.1" as const;

export type UnsupportedPhysicalGrantReason =
  | "unprofiled-native-grant"
  | "unsupported-physical-choice"
  | "owned-item-dependency"
  | "slot-key-collision"
  | "prose-only-no-terminal"
  | "semantic-prerequisite-mismatch";

export interface PhysicalGrantCoverageBlocker {
  readonly code: "unsupported-physical-grant" | "coverage-version-mismatch";
  readonly routeId: string;
  readonly reasonCode: UnsupportedPhysicalGrantReason | "pf2e-version-mismatch";
  readonly sourceSlotId: string | null;
  readonly sourceUuid: string | null;
  readonly message: string;
}

export type PhysicalGrantSelectionChannel = "selections" | "branchSelections";

export interface ActiveSelectionRequirement {
  readonly sourceUuid: string;
  readonly slotId?: string;
  readonly channel?: PhysicalGrantSelectionChannel;
}

export interface UnsupportedPhysicalGrantRoute {
  readonly routeId: string;
  readonly label: string;
  readonly reasonCode: UnsupportedPhysicalGrantReason;
  readonly requirements: readonly ActiveSelectionRequirement[];
  readonly terminalSourceUuids: readonly string[];
  readonly detail: string;
}

const background = (id: string): string => `Compendium.pf2e.backgrounds.Item.${id}`;
const classFeature = (id: string): string => `Compendium.pf2e.classfeatures.Item.${id}`;
const equipment = (id: string): string => `Compendium.pf2e.equipment-srd.Item.${id}`;
const feat = (id: string): string => `Compendium.pf2e.feats-srd.Item.${id}`;
const heritage = (id: string): string => `Compendium.pf2e.heritages.Item.${id}`;

function selectedRoute(args: {
  readonly routeId: string;
  readonly label: string;
  readonly sourceUuid: string;
  readonly reasonCode: UnsupportedPhysicalGrantReason;
  readonly terminals?: readonly string[];
  readonly detail: string;
}): UnsupportedPhysicalGrantRoute {
  return {
    routeId: args.routeId,
    label: args.label,
    reasonCode: args.reasonCode,
    requirements: [{ sourceUuid: args.sourceUuid }],
    terminalSourceUuids: args.terminals ?? [],
    detail: args.detail,
  };
}

const UNPROFILED_NATIVE_DETAIL =
  "PF2E creates this physical item before acquisition, but Wayfinder has no reviewed reconciliation profile for it.";
const DYNAMIC_CHOICE_DETAIL =
  "This build reaches a PF2E physical-item choice that Wayfinder does not capture as reviewed starting-equipment authority.";
const OWNED_OR_GRANTED_DETAIL =
  "This feature can grant a new physical item or depend on an owned item, and neither path is represented by reviewed Wayfinder equipment authority.";

export const UNSUPPORTED_PHYSICAL_GRANT_ROUTES: readonly UnsupportedPhysicalGrantRoute[] = Object.freeze(
  [
    selectedRoute({
      routeId: "inventor-armor-innovation",
      label: "Inventor Armor Innovation",
      sourceUuid: classFeature("fpwtpm8pdwO1I6MO"),
      reasonCode: "unprofiled-native-grant",
      terminals: [equipment("N42lmp3Ft6EsSvzg"), equipment("56CTZheeNhNPpLo1")],
      detail: UNPROFILED_NATIVE_DETAIL,
    }),
    selectedRoute({
      routeId: "inventor-weapon-innovation",
      label: "Inventor Weapon Innovation",
      sourceUuid: classFeature("bok3P78CMchFibxC"),
      reasonCode: "unsupported-physical-choice",
      detail: DYNAMIC_CHOICE_DETAIL,
    }),
    ...[
      ["thaumaturge-amulet-implement", "Thaumaturge Amulet implement", "PoclGJ7BCEyIuqJe", "GbR8rgZMCVBn3Evb"],
      ["thaumaturge-bell-implement", "Thaumaturge Bell implement", "DK1LCE5pd0YCY11c", "f0A1zqCFiUJuXc9U"],
      ["thaumaturge-chalice-implement", "Thaumaturge Chalice implement", "1vgFGSnn0DIBmK7j", "FodtZGtCsH9NDXlC"],
      ["thaumaturge-lantern-implement", "Thaumaturge Lantern implement", "AltwHU7hCqTwpn48", "AtiSK2lwEi25f3PT"],
      ["thaumaturge-mirror-implement", "Thaumaturge Mirror implement", "N6KvTbaRsphc0Ymb", "NpNDlH8YE2i67vQV"],
      ["thaumaturge-regalia-implement", "Thaumaturge Regalia implement", "DhdLzrcMvB93Rjmt", "7FzmHy7PugYNGkoX"],
      ["thaumaturge-tome-implement", "Thaumaturge Tome implement", "MyN1cQgE0HsLF20e", "V9mhR91d2qWa3dGh"],
      ["thaumaturge-wand-implement", "Thaumaturge Wand implement", "pDxdE8S8QJV2PGiB", "ZjApNlusD5oZkPTJ"],
    ].map(([routeId, label, featureId, terminalId]) =>
      selectedRoute({
        routeId: routeId!,
        label: label!,
        sourceUuid: classFeature(featureId!),
        reasonCode: "unprofiled-native-grant",
        terminals: [equipment(terminalId!)],
        detail: UNPROFILED_NATIVE_DETAIL,
      })
    ),
    selectedRoute({
      routeId: "thaumaturge-shield-implement",
      label: "Thaumaturge Shield implement",
      sourceUuid: classFeature("84GDSAXaMKMTg2IT"),
      reasonCode: "unsupported-physical-choice",
      detail: DYNAMIC_CHOICE_DETAIL,
    }),
    selectedRoute({
      routeId: "thaumaturge-weapon-implement",
      label: "Thaumaturge Weapon implement",
      sourceUuid: classFeature("YiDkrwaxiF7Gao7y"),
      reasonCode: "unsupported-physical-choice",
      detail: DYNAMIC_CHOICE_DETAIL,
    }),
    ...[
      ["exemplar-bands-of-imprisonment", "Exemplar Bands of Imprisonment ikon", "N1hWQx0IuKWjZ2dn", "G72UFwPRKBdfqib9"],
      ["exemplar-fetching-bangles", "Exemplar Fetching Bangles ikon", "xrJ4nGGgejUPf16q", "wyodEqz1v4PjQFCr"],
      ["exemplar-horn-of-plenty", "Exemplar Horn of Plenty ikon", "gjZXHLjezR0mkMnc", "kF6oa9xUGAz4zF11"],
      ["exemplar-pelt-of-the-beast", "Exemplar Pelt of the Beast ikon", "Wy6vSjm588txUFFv", "huzq73aQUEAlAXiu"],
      ["exemplar-skybearers-belt", "Exemplar Skybearer's Belt ikon", "iecFmUwSrytQNwoE", "mQTRsxgl7ST3GaRL"],
      [
        "exemplar-thousand-league-sandals",
        "Exemplar Thousand-League Sandals ikon",
        "6dtTNqL4SdPFKOrh",
        "Qp3FW0dmSed1iBxA",
      ],
      ["exemplar-victors-wreath", "Exemplar Victor's Wreath ikon", "pHUi7KCh1DH5pxMe", "1gmWdViYy3zgaW5c"],
    ].map(([routeId, label, featureId, terminalId]) =>
      selectedRoute({
        routeId: routeId!,
        label: label!,
        sourceUuid: classFeature(featureId!),
        reasonCode: "owned-item-dependency",
        terminals: [equipment(terminalId!)],
        detail: OWNED_OR_GRANTED_DETAIL,
      })
    ),
    ...[
      ["exemplar-mortal-harvest", "Exemplar Mortal Harvest ikon", "HhDQOylStcEVZCNg"],
      ["exemplar-unfailing-bow", "Exemplar Unfailing Bow ikon", "Jm8L7uSM01pJxSiW"],
      ["exemplar-starshot", "Exemplar Starshot ikon", "LC8i3ZJjhhKEHSLI"],
      ["exemplar-barrows-edge", "Exemplar Barrow's Edge ikon", "LfgeEJgJdA8WAKV8"],
      ["exemplar-mirrored-aegis", "Exemplar Mirrored Aegis ikon", "lJAQPRT2t8IABR4v"],
      ["exemplar-noble-branch", "Exemplar Noble Branch ikon", "ndSCXO9Dg57fmZIY"],
    ].map(([routeId, label, featureId]) =>
      selectedRoute({
        routeId: routeId!,
        label: label!,
        sourceUuid: classFeature(featureId!),
        reasonCode: "owned-item-dependency",
        detail: OWNED_OR_GRANTED_DETAIL,
      })
    ),
    ...[
      ["exemplar-hands-of-the-wildling", "Exemplar Hands of the Wildling ikon", "MhM6u4Stl0jV6CF2"],
      ["exemplar-titans-breaker", "Exemplar Titan's Breaker ikon", "jpS7wcMnBXK1rS4J"],
      ["exemplar-gleaming-blade", "Exemplar Gleaming Blade ikon", "o8Q7wWx2oKvKMi1s"],
    ].map(([routeId, label, featureId]) =>
      selectedRoute({
        routeId: routeId!,
        label: label!,
        sourceUuid: classFeature(featureId!),
        reasonCode: "slot-key-collision",
        detail:
          "This physical ikon has multiple no-flag PF2E choices that collapse to one Wayfinder draft slot, so its terminal item is not reviewed deterministically.",
      })
    ),
    selectedRoute({
      routeId: "verdant-weapon",
      label: "Verdant Weapon",
      sourceUuid: feat("qPFWEyihvbWsCcUv"),
      reasonCode: "owned-item-dependency",
      detail: OWNED_OR_GRANTED_DETAIL,
    }),
    selectedRoute({
      routeId: "munitions-crafter-formula-book",
      label: "Munitions Crafter formula book",
      sourceUuid: feat("lFVqejlf52cdYrZy"),
      reasonCode: "prose-only-no-terminal",
      detail:
        "The formula book is described in prose without an exact physical GrantItem terminal, so Wayfinder cannot assign acquisition authority to it.",
    }),
    selectedRoute({
      routeId: "reinforced-chassis",
      label: "Reinforced Chassis",
      sourceUuid: feat("cilZUszwjSGB4p1W"),
      reasonCode: "unprofiled-native-grant",
      terminals: [equipment("U5IGgD7Z225OPnhK")],
      detail: UNPROFILED_NATIVE_DETAIL,
    }),
    selectedRoute({
      routeId: "clan-pistol",
      label: "Clan Pistol",
      sourceUuid: feat("LvVg83ZDj8mabcWF"),
      reasonCode: "unprofiled-native-grant",
      terminals: [equipment("BtncTx8EfxTsHqQI")],
      detail:
        "Clan Pistol replaces the default Clan Dagger, but Wayfinder does not yet capture and reconcile that replacement branch.",
    }),
    selectedRoute({
      routeId: "tough-skin",
      label: "Tough Skin",
      sourceUuid: feat("TcUpt0KaDnoYheX8"),
      reasonCode: "semantic-prerequisite-mismatch",
      terminals: [equipment("7cy9gLlKX2vNja0a")],
      detail:
        "Wayfinder does not yet prove Tough Skin's required Lethoci or Xyloshi heritage before PF2E creates its armor.",
    }),
    selectedRoute({
      routeId: "orc-warmask",
      label: "Orc Warmask",
      sourceUuid: feat("1HsH8hE79MDsi8kK"),
      reasonCode: "unsupported-physical-choice",
      terminals: [equipment("ZEDDVQDtUZ2qOB5q")],
      detail:
        "The granted warmask owns a nested tradition choice that Wayfinder does not capture before PF2E creates the item.",
    }),
    selectedRoute({
      routeId: "pilgrims-token-feat",
      label: "Pilgrim's Token feat",
      sourceUuid: feat("BqceQIKE0lwIS98s"),
      reasonCode: "semantic-prerequisite-mismatch",
      terminals: [equipment("gwP3Uums2ApH6o9K")],
      detail:
        "Wayfinder does not yet prove the feat's religion and follower requirements before PF2E creates the free token.",
    }),
    selectedRoute({
      routeId: "hunted-by-the-night-equipment",
      label: "Hunted by the Night equipment",
      sourceUuid: background("N0CRYmDCw8bgNxLl"),
      reasonCode: "unprofiled-native-grant",
      terminals: [equipment("plplsXJsqrdqNQVI"), equipment("z9T4c1hXwOotsMCp")],
      detail: UNPROFILED_NATIVE_DETAIL,
    }),
    ...[
      ["wandering-preacher-pilgrims-token", "Wandering Preacher Pilgrim's Token", "UFHezf1LXUwcQIAQ"],
      ["writ-in-the-stars-pilgrims-token", "Writ in the Stars Pilgrim's Token", "maxaKunHAOKUrR4q"],
      ["pilgrim-background-token", "Pilgrim background token", "r9fzNQEz33HyKTxm"],
      ["ex-mendevian-crusader-pilgrims-token", "Ex-Mendevian Crusader Pilgrim's Token", "ynObDI0VbZ4sqeMI"],
    ].map(([routeId, label, backgroundId]) =>
      selectedRoute({
        routeId: routeId!,
        label: label!,
        sourceUuid: background(backgroundId!),
        reasonCode: "semantic-prerequisite-mismatch",
        terminals: [equipment("gwP3Uums2ApH6o9K")],
        detail:
          "This background embeds Pilgrim's Token, whose religion and follower requirements are not yet proven by Wayfinder.",
      })
    ),
    ...[
      ["titan-nagaji-scales", "Titan Nagaji Scales", "LlUEmCDOLSZaGOyI", "KA0Ku5qOQfXqw3BK"],
      ["bakuwa-bony-plates", "Bakuwa Lizardfolk Bony Plates", "OIW3UYrdaWLwUZCh", "mrgtvEbYTjGpOi7F"],
      [
        "rite-of-reinforcement-exoskeleton",
        "Rite of Reinforcement Exoskeleton",
        "q2omqJ9t0skGTYki",
        "0KHgAaDi3tmu32Hq",
      ],
      ["hardshell-surki-carapace", "Hardshell Surki Carapace", "qKn9k3TQt0gsOLn7", "iwsNMFqLdORjkotL"],
    ].map(([routeId, label, heritageId, terminalId]) =>
      selectedRoute({
        routeId: routeId!,
        label: label!,
        sourceUuid: heritage(heritageId!),
        reasonCode: "unprofiled-native-grant",
        terminals: [equipment(terminalId!)],
        detail: UNPROFILED_NATIVE_DETAIL,
      })
    ),
    {
      routeId: "ancient-elf-giant-instinct-weapon",
      label: "Ancient Elf Giant Instinct weapon",
      reasonCode: "unsupported-physical-choice",
      requirements: [
        {
          sourceUuid: heritage("Nd9hdX8rdYyRozw8"),
          slotId: "heritage-level-1",
          channel: "selections",
        },
        {
          sourceUuid: feat("WVU0c8rgcpGSRqSi"),
          slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
          channel: "selections",
        },
        {
          sourceUuid: classFeature("JuKD6k7nDwfO0Ckv"),
          slotId: "grant-choice-none-feat-barbarian-dedication-instinct-level-1",
          channel: "selections",
        },
      ],
      terminalSourceUuids: [],
      detail:
        "The Ancient Elf dedication path reaches Giant Instinct without the reviewed Titan Mauler acquisition profile used by a Barbarian class selection.",
    } satisfies UnsupportedPhysicalGrantRoute,
    {
      routeId: "ancient-elf-alchemist-formula-book",
      label: "Ancient Elf Alchemist Dedication formula book",
      reasonCode: "prose-only-no-terminal",
      requirements: [
        {
          sourceUuid: heritage("Nd9hdX8rdYyRozw8"),
          slotId: "heritage-level-1",
          channel: "selections",
        },
        {
          sourceUuid: feat("CJMkxlxHiHZQYDCz"),
          slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
          channel: "selections",
        },
      ],
      terminalSourceUuids: [],
      detail: "Alchemist Dedication mentions a formula book in prose without an exact physical GrantItem terminal.",
    } satisfies UnsupportedPhysicalGrantRoute,
  ].sort((left, right) => left.routeId.localeCompare(right.routeId))
);

export const UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS: readonly string[] = Object.freeze(
  UNSUPPORTED_PHYSICAL_GRANT_ROUTES.map((route) => route.routeId)
);

export function physicalGrantCoverageVersionBlocker(pf2eVersion: string | null): PhysicalGrantCoverageBlocker | null {
  if (pf2eVersion === PHYSICAL_GRANT_COVERAGE_PF2E_VERSION) return null;
  const observed = nonEmpty(pf2eVersion) ? pf2eVersion : "an unknown version";
  return {
    code: "coverage-version-mismatch",
    routeId: "pf2e-version-pin",
    reasonCode: "pf2e-version-mismatch",
    sourceSlotId: null,
    sourceUuid: null,
    message: `Starting-equipment physical-grant coverage is qualified for PF2E ${PHYSICAL_GRANT_COVERAGE_PF2E_VERSION}, not ${observed}. Review is blocked until the coverage matrix is refreshed.`,
  };
}

export function currentPf2eVersion(): string | null {
  const currentGame = (globalThis as { game?: { system?: { id?: unknown; version?: unknown } } }).game;
  return currentGame?.system?.id === "pf2e" && nonEmpty(currentGame.system.version) ? currentGame.system.version : null;
}

export function physicalGrantCoverageBlockers(
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): readonly PhysicalGrantCoverageBlocker[] {
  const versionBlocker = hasLevelOnePhysicalGrantCoverageEvidence(draft, activeSteps)
    ? physicalGrantCoverageVersionBlocker(pf2eVersion)
    : null;
  return versionBlocker ? [versionBlocker] : findUnsupportedPhysicalGrantRoutes(draft, activeSteps);
}

export function physicalGrantCoverageIssues(
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): WayfinderStepIssue[] {
  return physicalGrantCoverageBlockers(draft, activeSteps, pf2eVersion).map((blocker) => ({
    code: "equipment-review",
    stepId: blocker.sourceSlotId ?? "starting-equipment-coverage",
    slotId: blocker.sourceSlotId ?? "starting-equipment",
    title: "Starting equipment coverage",
    message: blocker.message,
  }));
}

export function withPhysicalGrantCoverageReadiness(
  readiness: WayfinderDraftReadiness,
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): WayfinderDraftReadiness {
  const coverageIssues = physicalGrantCoverageIssues(draft, activeSteps, pf2eVersion);
  if (coverageIssues.length === 0) return readiness;
  return {
    ...readiness,
    ready: false,
    blockers: [...readiness.blockers, ...coverageIssues],
    firstBlocker: readiness.firstBlocker ?? coverageIssues[0] ?? null,
  };
}

export function findUnsupportedPhysicalGrantRoutes(
  draft: DraftState,
  activeSteps: readonly PendingStep[]
): readonly PhysicalGrantCoverageBlocker[] {
  const activeSlotIds = new Set([
    ...activeSteps.map((step) => step.slotId),
    ...draft.applyAttemptStepIds,
    ...draft.applyCompletedStepIds,
  ]);
  const facts = [
    ...selectionFacts("selections", draft.selections, activeSlotIds),
    ...selectionFacts("branchSelections", draft.branchSelections, activeSlotIds),
  ];

  return UNSUPPORTED_PHYSICAL_GRANT_ROUTES.flatMap((route) => {
    const matches = route.requirements.map((requirement) =>
      facts.find(
        (fact) =>
          fact.sourceUuid === requirement.sourceUuid &&
          (requirement.slotId === undefined || fact.sourceSlotId === requirement.slotId) &&
          (requirement.channel === undefined || fact.channel === requirement.channel)
      )
    );
    if (matches.some((match) => match === undefined)) return [];
    const source = matches.at(-1)!;
    return [
      {
        code: "unsupported-physical-grant" as const,
        routeId: route.routeId,
        reasonCode: route.reasonCode,
        sourceSlotId: source.sourceSlotId,
        sourceUuid: source.sourceUuid,
        message: `${route.label} is not supported by Wayfinder starting equipment on PF2E ${PHYSICAL_GRANT_COVERAGE_PF2E_VERSION}. ${route.detail} Use the PF2E sheet for this build.`,
      },
    ];
  });
}

interface ActiveSelectionFact {
  readonly channel: PhysicalGrantSelectionChannel;
  readonly sourceSlotId: string;
  readonly sourceUuid: string;
}

const PHYSICAL_GRANT_STEP_KINDS = new Set<PendingStep["kind"]>([
  "pick-item",
  "singleton-choice",
  "class-archetype",
  "class-branch",
  "class-choice",
  "starting-equipment",
]);

function hasLevelOnePhysicalGrantCoverageEvidence(draft: DraftState, activeSteps: readonly PendingStep[]): boolean {
  if (
    activeSteps.some(
      (step) =>
        step.slotId === "starting-equipment-level-1" || (step.level === 1 && PHYSICAL_GRANT_STEP_KINDS.has(step.kind))
    )
  ) {
    return true;
  }

  const frozenSlotIds = [...draft.applyAttemptStepIds, ...draft.applyCompletedStepIds];
  if (frozenSlotIds.includes("starting-equipment-level-1")) return true;

  const activeSlotIds = new Set([...activeSteps.map((step) => step.slotId), ...frozenSlotIds]);
  return [
    ...selectionFacts("selections", draft.selections, activeSlotIds),
    ...selectionFacts("branchSelections", draft.branchSelections, activeSlotIds),
  ].some((fact) => isLevelOneSlotId(fact.sourceSlotId));
}

function selectionFacts(
  channel: PhysicalGrantSelectionChannel,
  selections: Readonly<Record<string, SelectionRef>>,
  activeSlotIds: ReadonlySet<string>
): ActiveSelectionFact[] {
  return Object.entries(selections).flatMap(([mapSlotId, selection]) => {
    if (mapSlotId !== selection.slotId || !activeSlotIds.has(mapSlotId)) return [];
    return [{ channel, sourceSlotId: mapSlotId, sourceUuid: selection.uuid }];
  });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLevelOneSlotId(slotId: string): boolean {
  return slotId.endsWith("-level-1");
}
