type FoundryTemplateLoader = (paths: string[] | Record<string, string>) => Promise<unknown[]>;
type FoundryHtmlEnricher = (content: string, options?: Record<string, unknown>) => Promise<string>;

interface FoundryTextEditorLike {
  implementation?: {
    enrichHTML?: FoundryHtmlEnricher;
  };
  enrichHTML?: FoundryHtmlEnricher;
}

interface FoundryV14ApiLike {
  applications?: {
    handlebars?: {
      loadTemplates?: FoundryTemplateLoader;
    };
    ux?: {
      TextEditor?: FoundryTextEditorLike;
    };
  };
  utils?: {
    fromUuid?: (uuid: string) => Promise<unknown | null>;
  };
  data?: {
    operators?: {
      ForcedDeletion?: new () => unknown;
    };
  };
}

type FoundryCompatGlobals = typeof globalThis & {
  foundry?: FoundryV14ApiLike;
};

export function preloadHandlebarsTemplates(paths: string[] | Record<string, string>): Promise<unknown[]> {
  const loadTemplates = compatGlobals().foundry?.applications?.handlebars?.loadTemplates;
  if (typeof loadTemplates !== "function") {
    throw new Error("Foundry v14 handlebars template loader is unavailable.");
  }

  return loadTemplates(paths);
}

export async function enrichHtml(content: string, options: Record<string, unknown> = {}): Promise<string> {
  const textEditor = compatGlobals().foundry?.applications?.ux?.TextEditor;
  const implementation = textEditor?.implementation;
  const enrichHTML = implementation?.enrichHTML ?? textEditor?.enrichHTML;
  if (typeof enrichHTML !== "function") {
    throw new Error("Foundry v14 TextEditor HTML enricher is unavailable.");
  }

  return enrichHTML.call(implementation ?? textEditor, content, options);
}

export function foundryDeleteValue(): unknown {
  const ForcedDeletion = compatGlobals().foundry?.data?.operators?.ForcedDeletion;
  if (typeof ForcedDeletion !== "function") {
    throw new Error("Foundry v14 forced-deletion operator is unavailable.");
  }

  return new ForcedDeletion();
}

export function resolveUuid<TDocument = unknown>(uuid: string): Promise<TDocument | null> {
  const fromUuid = compatGlobals().foundry?.utils?.fromUuid;
  if (typeof fromUuid !== "function") {
    throw new Error("Foundry v14 UUID resolver is unavailable.");
  }

  return fromUuid(uuid) as Promise<TDocument | null>;
}

function compatGlobals(): FoundryCompatGlobals {
  return globalThis as FoundryCompatGlobals;
}
