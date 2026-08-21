import { beforeEach } from "vitest";

type TestPackLike = {
  getDocument?: (documentId: string) => Promise<unknown | null>;
};

type TestGlobals = typeof globalThis & {
  foundry?: {
    utils?: {
      fromUuid?: (uuid: string) => Promise<unknown | null>;
    };
    applications?: {
      handlebars?: {
        loadTemplates?: (paths: string[] | Record<string, string>) => Promise<unknown[]>;
      };
      ux?: {
        TextEditor?: {
          implementation?: {
            enrichHTML?: (content: string) => Promise<string>;
          };
        };
      };
    };
    data?: {
      operators?: {
        ForcedDeletion?: new () => unknown;
        ForcedReplacement?: {
          create: (value: unknown) => unknown;
          get: (value: unknown) => unknown;
        };
      };
    };
  };
  game?: {
    packs?: Map<string, TestPackLike>;
  };
};

class TestForcedDeletion {}

const TEST_OPERATOR_VALUE = Symbol("TestDataFieldOperatorValue");

class TestForcedReplacement {
  [TEST_OPERATOR_VALUE]: unknown;

  constructor(value: unknown) {
    this[TEST_OPERATOR_VALUE] = TestForcedReplacement.get(value);
  }

  static create(value: unknown): unknown {
    return new Proxy(new TestForcedReplacement(value), {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        const inner = target[TEST_OPERATOR_VALUE];
        return inner && typeof inner === "object" ? Reflect.get(inner, property, receiver) : undefined;
      },
      has(target, property) {
        if (Reflect.has(target, property)) return true;
        const inner = target[TEST_OPERATOR_VALUE];
        return inner && typeof inner === "object" ? Reflect.has(inner, property) : false;
      },
      ownKeys(target) {
        const inner = target[TEST_OPERATOR_VALUE];
        return inner && typeof inner === "object" ? Reflect.ownKeys(inner) : [];
      },
      getOwnPropertyDescriptor(target, property) {
        const inner = target[TEST_OPERATOR_VALUE];
        return inner && typeof inner === "object" ? Reflect.getOwnPropertyDescriptor(inner, property) : undefined;
      },
    });
  }

  static get(value: unknown): unknown {
    return value instanceof TestForcedReplacement ? value[TEST_OPERATOR_VALUE] : value;
  }
}

installFoundryV14Globals();
beforeEach(() => {
  installFoundryV14Globals();
});

function installFoundryV14Globals(): void {
  const globals = globalThis as TestGlobals;
  globals.foundry ??= {};
  globals.foundry.utils ??= {};
  globals.foundry.utils.fromUuid ??= async (uuid: string) => {
    const parsed = parseCompendiumItemUuid(uuid);
    if (!parsed) {
      return null;
    }

    const pack = globals.game?.packs?.get(parsed.packId);
    return (await pack?.getDocument?.(parsed.documentId)) ?? null;
  };
  globals.foundry.applications ??= {};
  globals.foundry.applications.handlebars ??= {};
  globals.foundry.applications.handlebars.loadTemplates ??= async () => [];
  globals.foundry.applications.ux ??= {};
  globals.foundry.applications.ux.TextEditor ??= {};
  globals.foundry.applications.ux.TextEditor.implementation ??= {};
  globals.foundry.applications.ux.TextEditor.implementation.enrichHTML ??= async (content: string) => content;
  globals.foundry.data ??= {};
  globals.foundry.data.operators ??= {};
  globals.foundry.data.operators.ForcedDeletion ??= TestForcedDeletion;
  globals.foundry.data.operators.ForcedReplacement ??= TestForcedReplacement;
}

function parseCompendiumItemUuid(uuid: string): { packId: string; documentId: string } | null {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    packId: match[1],
    documentId: match[2],
  };
}
