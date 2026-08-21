import {
  PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS,
  type PhysicalGrantScannerRouteDisposition,
} from "./physical-grant-scanner-route-dispositions.js";

export const PHYSICAL_GRANT_COVERAGE_PF2E_VERSION = "8.4.1" as const;
export {
  PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS,
  type PhysicalGrantScannerRouteDisposition,
} from "./physical-grant-scanner-route-dispositions.js";

export type PhysicalGrantRouteClassification =
  | "supported-native"
  | "supported-wayfinder-acquisition"
  | "unsupported-handoff";
export type PhysicalGrantSourcePolicy = "remaster-core" | "remaster-optional" | "mixed";
export type ClassGrantMaterializer = "pf2e-native" | "wayfinder-acquisition";
export type ClassGrantResaleRule = "normal" | "zero-until-rune-investment";
export type ClassGrantEligibilityKind = "fixed-class-grant" | "catalogue-choice";

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
  readonly classification: "unsupported-handoff";
  readonly sourcePolicy: "mixed";
  readonly activationVariants: readonly (readonly ActiveSelectionRequirement[])[];
  readonly terminalSourceUuids: readonly string[];
  readonly blocker: {
    readonly preReview: true;
    readonly reasonCode: UnsupportedPhysicalGrantReason;
    readonly detail: string;
  };
}

export interface SupportedPhysicalGrantRoute {
  readonly routeId: ClassGrantProfileId;
  readonly label: string;
  readonly classification: "supported-native" | "supported-wayfinder-acquisition";
  readonly profileId: ClassGrantProfileId;
  readonly materializer: ClassGrantMaterializer;
  readonly sourcePolicy: Exclude<PhysicalGrantSourcePolicy, "mixed">;
  readonly activationVariants: readonly [];
  readonly terminalSourceUuids: readonly string[];
  readonly grant: {
    readonly grantId: string | null;
    readonly originSourceSlotId: string;
    readonly originSourceUuid: string;
    readonly granterSourceUuid: string;
    readonly expectedSourceUuid: string | null;
    readonly expectedItemType: "equipment" | "weapon";
    readonly eligibilityKind: ClassGrantEligibilityKind;
    readonly resaleRule: ClassGrantResaleRule;
    readonly nativeGrantChainSourceUuids: readonly string[];
  };
  readonly expectedOutcome: {
    readonly acquisitionItemCreateCount: 0 | 1;
    readonly acquisitionStamped: boolean;
    readonly budgetChargeCopper: 0;
  };
}

export type PhysicalGrantRoute = SupportedPhysicalGrantRoute | UnsupportedPhysicalGrantRoute;

export const CLASS_GRANT_PROFILE_UUIDS = {
  alchemistClass: "Compendium.pf2e.classes.Item.XwfcJuskrhI9GIjX",
  alchemyFeature: "Compendium.pf2e.classfeatures.Item.w3aS3tsvH2Ub6XMn",
  formulaBookFeature: "Compendium.pf2e.classfeatures.Item.XPPG7nN9pxt0sjMg",
  formulaBookItem: "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx",
  investigatorClass: "Compendium.pf2e.classes.Item.4wrSCyX6akmyo7Wj",
  methodologyFeature: "Compendium.pf2e.classfeatures.Item.uhHg9BXBiHpL5ndS",
  alchemicalSciences: "Compendium.pf2e.classfeatures.Item.ln2Y1a4SxlU9sizX",
  barbarianClass: "Compendium.pf2e.classes.Item.YDRiP7uVvr9WRhOI",
  instinctFeature: "Compendium.pf2e.classfeatures.Item.dU7xRpg4kFd01hwZ",
  giantInstinct: "Compendium.pf2e.classfeatures.Item.JuKD6k7nDwfO0Ckv",
  dwarfAncestry: "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
  clanDaggerFeature: "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
  clanDaggerItem: "Compendium.pf2e.equipment-srd.Item.kJJvKm80KwWXPukV",
  clanPistolFeature: "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF",
  sarangayAncestry: "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
  headGemFeature: "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
  headGemItem: "Compendium.pf2e.equipment-srd.Item.FA1mAc7rEyC9vzZa",
} as const;

export type ClassGrantProfileId =
  | "alchemist-formula-book"
  | "investigator-alchemical-sciences-formula-book"
  | "giant-instinct-titan-mauler"
  | "dwarf-clan-dagger"
  | "sarangay-head-gem";

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
    classification: "unsupported-handoff",
    sourcePolicy: "mixed",
    activationVariants: [[{ sourceUuid: args.sourceUuid }]],
    terminalSourceUuids: args.terminals ?? [],
    blocker: { preReview: true, reasonCode: args.reasonCode, detail: args.detail },
  };
}

const UNPROFILED_NATIVE_DETAIL =
  "PF2E creates this physical item before acquisition, but Wayfinder has no reviewed reconciliation profile for it.";
const DYNAMIC_CHOICE_DETAIL =
  "This build reaches a PF2E physical-item choice that Wayfinder does not capture as reviewed starting-equipment authority.";
const OWNED_OR_GRANTED_DETAIL =
  "This feature can grant a new physical item or depend on an owned item, and neither path is represented by reviewed Wayfinder equipment authority.";

const U = CLASS_GRANT_PROFILE_UUIDS;

export const SUPPORTED_PHYSICAL_GRANT_ROUTES: readonly SupportedPhysicalGrantRoute[] = Object.freeze(
  [
    supportedRoute({
      routeId: "alchemist-formula-book",
      label: "Alchemist Formula Book",
      classification: "supported-native",
      sourcePolicy: "remaster-core",
      grantId: "class-grant:alchemist-formula-book:class-level-1",
      originSourceSlotId: "class-level-1",
      originSourceUuid: U.alchemistClass,
      granterSourceUuid: U.formulaBookFeature,
      expectedSourceUuid: U.formulaBookItem,
      expectedItemType: "equipment",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      nativeGrantChainSourceUuids: [U.formulaBookFeature, U.alchemyFeature, U.alchemistClass],
    }),
    supportedRoute({
      routeId: "investigator-alchemical-sciences-formula-book",
      label: "Investigator Alchemical Sciences Formula Book",
      classification: "supported-native",
      sourcePolicy: "remaster-core",
      grantId: "class-grant:investigator-formula-book:class-branch-methodology-level-1",
      originSourceSlotId: "class-branch-methodology-level-1",
      originSourceUuid: U.alchemicalSciences,
      granterSourceUuid: U.alchemicalSciences,
      expectedSourceUuid: U.formulaBookItem,
      expectedItemType: "equipment",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      nativeGrantChainSourceUuids: [U.alchemicalSciences, U.methodologyFeature, U.investigatorClass],
    }),
    supportedRoute({
      routeId: "giant-instinct-titan-mauler",
      label: "Giant Instinct Titan Mauler Weapon",
      classification: "supported-wayfinder-acquisition",
      sourcePolicy: "remaster-core",
      grantId: null,
      originSourceSlotId: "class-branch-instinct-level-1",
      originSourceUuid: U.giantInstinct,
      granterSourceUuid: U.giantInstinct,
      expectedSourceUuid: null,
      expectedItemType: "weapon",
      eligibilityKind: "catalogue-choice",
      resaleRule: "zero-until-rune-investment",
      nativeGrantChainSourceUuids: [],
    }),
    supportedRoute({
      routeId: "dwarf-clan-dagger",
      label: "Dwarf Clan Dagger",
      classification: "supported-native",
      sourcePolicy: "remaster-core",
      grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
      originSourceSlotId: "ancestry-level-1",
      originSourceUuid: U.dwarfAncestry,
      granterSourceUuid: U.clanDaggerFeature,
      expectedSourceUuid: U.clanDaggerItem,
      expectedItemType: "weapon",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      nativeGrantChainSourceUuids: [U.clanDaggerFeature, U.dwarfAncestry],
    }),
    supportedRoute({
      routeId: "sarangay-head-gem",
      label: "Sarangay Head Gem",
      classification: "supported-native",
      sourcePolicy: "remaster-optional",
      grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
      originSourceSlotId: "ancestry-level-1",
      originSourceUuid: U.sarangayAncestry,
      granterSourceUuid: U.headGemFeature,
      expectedSourceUuid: U.headGemItem,
      expectedItemType: "equipment",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      nativeGrantChainSourceUuids: [U.headGemFeature, U.sarangayAncestry],
    }),
  ]
    .map(freezeSupportedRoute)
    .sort((left, right) => left.routeId.localeCompare(right.routeId))
);

function supportedRoute(
  args: Omit<
    SupportedPhysicalGrantRoute,
    "profileId" | "materializer" | "activationVariants" | "terminalSourceUuids" | "grant" | "expectedOutcome"
  > &
    SupportedPhysicalGrantRoute["grant"]
): SupportedPhysicalGrantRoute {
  const native = args.classification === "supported-native";
  return {
    routeId: args.routeId,
    label: args.label,
    classification: args.classification,
    profileId: args.routeId,
    materializer: native ? "pf2e-native" : "wayfinder-acquisition",
    sourcePolicy: args.sourcePolicy,
    activationVariants: [],
    terminalSourceUuids: args.expectedSourceUuid ? [args.expectedSourceUuid] : [],
    grant: {
      grantId: args.grantId,
      originSourceSlotId: args.originSourceSlotId,
      originSourceUuid: args.originSourceUuid,
      granterSourceUuid: args.granterSourceUuid,
      expectedSourceUuid: args.expectedSourceUuid,
      expectedItemType: args.expectedItemType,
      eligibilityKind: args.eligibilityKind,
      resaleRule: args.resaleRule,
      nativeGrantChainSourceUuids: Object.freeze([...args.nativeGrantChainSourceUuids]),
    },
    expectedOutcome: {
      acquisitionItemCreateCount: native ? 0 : 1,
      acquisitionStamped: !native,
      budgetChargeCopper: 0,
    },
  };
}

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
      classification: "unsupported-handoff",
      sourcePolicy: "mixed",
      activationVariants: [
        [
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
      ],
      terminalSourceUuids: [],
      blocker: {
        preReview: true,
        reasonCode: "unsupported-physical-choice",
        detail:
          "The Ancient Elf dedication path reaches Giant Instinct without the reviewed Titan Mauler acquisition profile used by a Barbarian class selection.",
      },
    } satisfies UnsupportedPhysicalGrantRoute,
    {
      routeId: "ancient-elf-alchemist-formula-book",
      label: "Ancient Elf Alchemist Dedication formula book",
      classification: "unsupported-handoff",
      sourcePolicy: "mixed",
      activationVariants: [
        [
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
      ],
      terminalSourceUuids: [],
      blocker: {
        preReview: true,
        reasonCode: "prose-only-no-terminal",
        detail: "Alchemist Dedication mentions a formula book in prose without an exact physical GrantItem terminal.",
      },
    } satisfies UnsupportedPhysicalGrantRoute,
  ]
    .map(freezeUnsupportedRoute)
    .sort((left, right) => left.routeId.localeCompare(right.routeId))
);

export const UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS: readonly string[] = Object.freeze(
  UNSUPPORTED_PHYSICAL_GRANT_ROUTES.map((route) => route.routeId)
);

export const PHYSICAL_GRANT_ROUTE_REGISTRY: readonly PhysicalGrantRoute[] = Object.freeze(
  [...SUPPORTED_PHYSICAL_GRANT_ROUTES, ...UNSUPPORTED_PHYSICAL_GRANT_ROUTES].sort((left, right) =>
    left.routeId.localeCompare(right.routeId)
  )
);

assertPhysicalGrantRouteRegistry(PHYSICAL_GRANT_ROUTE_REGISTRY);
assertScannerRouteDispositions(PHYSICAL_GRANT_ROUTE_REGISTRY, PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS);

const ROUTES_BY_ID = new Map(PHYSICAL_GRANT_ROUTE_REGISTRY.map((route) => [route.routeId, route] as const));

export function physicalGrantRouteById(routeId: string): PhysicalGrantRoute | null {
  return ROUTES_BY_ID.get(routeId) ?? null;
}

export function supportedPhysicalGrantRoute(profileId: ClassGrantProfileId): SupportedPhysicalGrantRoute {
  const route = ROUTES_BY_ID.get(profileId);
  if (!route || route.classification === "unsupported-handoff") {
    throw new TypeError(`Unknown supported physical-grant profile ${profileId}.`);
  }
  return route;
}

export function physicalGrantScannerRouteDisposition(routeKey: string): PhysicalGrantScannerRouteDisposition | null {
  return Object.hasOwn(PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS, routeKey)
    ? PHYSICAL_GRANT_SCANNER_ROUTE_DISPOSITIONS[routeKey]!
    : null;
}

function freezeSupportedRoute(route: SupportedPhysicalGrantRoute): SupportedPhysicalGrantRoute {
  return Object.freeze({
    ...route,
    activationVariants: Object.freeze([]) as readonly [],
    terminalSourceUuids: Object.freeze([...route.terminalSourceUuids]),
    grant: Object.freeze({
      ...route.grant,
      nativeGrantChainSourceUuids: Object.freeze([...route.grant.nativeGrantChainSourceUuids]),
    }),
    expectedOutcome: Object.freeze({ ...route.expectedOutcome }),
  });
}

function freezeUnsupportedRoute(route: UnsupportedPhysicalGrantRoute): UnsupportedPhysicalGrantRoute {
  return Object.freeze({
    ...route,
    activationVariants: Object.freeze(
      route.activationVariants.map((variant) =>
        Object.freeze(variant.map((requirement) => Object.freeze({ ...requirement })))
      )
    ),
    terminalSourceUuids: Object.freeze([...route.terminalSourceUuids]),
    blocker: Object.freeze({ ...route.blocker }),
  });
}

function assertPhysicalGrantRouteRegistry(routes: readonly PhysicalGrantRoute[]): void {
  if (routes.length !== 51 || new Set(routes.map((route) => route.routeId)).size !== routes.length) {
    throw new TypeError("PF2E 8.4.1 physical-grant coverage requires exactly 51 unique reviewed routes.");
  }
  if (
    SUPPORTED_PHYSICAL_GRANT_ROUTES.length !== 5 ||
    new Set(SUPPORTED_PHYSICAL_GRANT_ROUTES.map((route) => route.profileId)).size !== 5 ||
    UNSUPPORTED_PHYSICAL_GRANT_ROUTES.length !== 46
  ) {
    throw new TypeError("PF2E 8.4.1 physical-grant coverage partition is incomplete.");
  }
}

function assertScannerRouteDispositions(
  routes: readonly PhysicalGrantRoute[],
  dispositions: Readonly<Record<string, PhysicalGrantScannerRouteDisposition>>
): void {
  const knownRouteIds = new Set(routes.map((route) => route.routeId));
  const entries = Object.entries(dispositions);
  const physical = entries.filter(([, disposition]) => disposition.classification === "physical-grant");
  const nonPhysical = entries.filter(([, disposition]) => disposition.classification === "reviewed-non-physical");
  if (entries.length !== 162 || physical.length !== 59 || nonPhysical.length !== 103) {
    throw new TypeError("PF2E 8.4.1 scanner coverage requires exactly 162 reviewed route-key dispositions.");
  }
  for (const [routeKey, disposition] of entries) {
    if (disposition.classification !== "physical-grant") continue;
    if (
      disposition.routeIds.length === 0 ||
      new Set(disposition.routeIds).size !== disposition.routeIds.length ||
      disposition.routeIds.some((routeId) => !knownRouteIds.has(routeId))
    ) {
      throw new TypeError(`Scanner route ${routeKey} does not resolve to unique executable physical-grant routes.`);
    }
  }
}
