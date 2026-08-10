import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { slugifyName } from "../shared/slug.js";
import type { SelectionRef } from "../types.js";
import {
  documentFeatureLevel,
  getDocumentRules,
  matchesChoiceSetRulePredicate,
  toNonEmptyString,
} from "./rule-data.js";

export interface StaticGrantChoiceSource {
  grantRuleIndex: number;
  parentSelection: SelectionRef;
  sourceItemType: "classfeature" | "feat";
  sourceSelection: SelectionRef;
  sourceDocument: unknown;
  sourceLevel: number;
}

interface ResolveStaticGrantChoiceSourcesArgs {
  sources: Array<{
    sourceSelection: SelectionRef;
    sourceDocument: unknown;
  }>;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  activeRollOptions?: ReadonlySet<string>;
}

/**
 * Loads only direct, static GrantItem targets that themselves carry ChoiceSets.
 *
 * This is deliberately one level deep. Dynamic `{item|flags...}` grants are
 * selections made by an earlier rule and are handled by the existing guided
 * lanes after that selection is drafted.
 */
export async function resolveStaticGrantChoiceSources(
  args: ResolveStaticGrantChoiceSourcesArgs
): Promise<StaticGrantChoiceSource[]> {
  const pending = args.sources.flatMap(({ sourceSelection, sourceDocument }) =>
    staticGrantSelections(sourceSelection, sourceDocument, args.activeRollOptions).map(
      async ({ grantRuleIndex, selection }): Promise<StaticGrantChoiceSource | null> => {
        const sourceDocument = await args.fetchSelectionDocument(selection);
        if (!sourceDocument || !getDocumentRules(sourceDocument).some((rule) => rule.key === "ChoiceSet")) {
          return null;
        }

        const sourceItemType = inferGrantedSourceItemType(selection, sourceDocument);
        const sourceLevel = sourceSelection.level ?? documentFeatureLevel(sourceDocument);
        return {
          grantRuleIndex,
          parentSelection: sourceSelection,
          sourceItemType,
          sourceSelection: {
            ...selection,
            name: toNonEmptyString((sourceDocument as { name?: unknown }).name) ?? selection.name,
            level: sourceLevel,
            featType: sourceItemType,
          },
          sourceDocument,
          sourceLevel,
        };
      }
    )
  );

  const resolved = await Promise.all(pending);
  return dedupeStaticGrantSources(resolved.filter((source): source is StaticGrantChoiceSource => source !== null));
}

export function staticGrantSelections(
  parentSelection: SelectionRef,
  sourceDocument: unknown,
  activeRollOptions: ReadonlySet<string> = new Set()
): Array<{ grantRuleIndex: number; selection: SelectionRef }> {
  const sourceRollOptions = buildSourceRollOptions(parentSelection, sourceDocument, activeRollOptions);
  return getDocumentRules(sourceDocument).flatMap((rule, grantRuleIndex) => {
    if (rule.key !== "GrantItem" || !matchesChoiceSetRulePredicate(rule, sourceRollOptions)) {
      return [];
    }

    const uuid = toNonEmptyString(rule.uuid);
    // Braced UUIDs depend on prior rule selections and are not static grants.
    const parsed = uuid && !uuid.includes("{") ? parseCompendiumItemUuid(uuid) : null;
    if (!uuid || !parsed) {
      return [];
    }

    return [
      {
        grantRuleIndex,
        selection: {
          slotId: `static-grant-choice-${parentSelection.slotId}-${grantRuleIndex}`,
          packId: parsed.packId,
          documentId: parsed.documentId,
          uuid,
          itemType: "feat",
          featType: parsed.packId === "pf2e.classfeatures" ? "classfeature" : null,
          name: parsed.documentId,
          level: parentSelection.level,
        },
      },
    ];
  });
}

function buildSourceRollOptions(
  parentSelection: SelectionRef,
  sourceDocument: unknown,
  activeRollOptions: ReadonlySet<string>
): Set<string> {
  const options = new Set(Array.from(activeRollOptions, (option) => option.trim().toLowerCase()));
  const sourceSlug =
    toNonEmptyString((sourceDocument as { system?: { slug?: unknown } } | null)?.system?.slug)?.toLowerCase() ??
    parentSelection.slug?.trim().toLowerCase() ??
    slugifyName(parentSelection.name);
  const sourceCategory = toNonEmptyString(
    (sourceDocument as { system?: { category?: unknown; featType?: { value?: unknown } } } | null)?.system?.featType
      ?.value ?? (sourceDocument as { system?: { category?: unknown } } | null)?.system?.category
  )?.toLowerCase();
  if (sourceSlug) {
    options.add(`${sourceCategory === "classfeature" ? "feature" : "feat"}:${sourceSlug}`);
  }
  options.add(`self:level:${parentSelection.level ?? documentFeatureLevel(sourceDocument)}`);
  return options;
}

function inferGrantedSourceItemType(selection: SelectionRef, document: unknown): "classfeature" | "feat" {
  const category = toNonEmptyString(
    (document as { system?: { category?: unknown } } | null | undefined)?.system?.category
  );
  return selection.packId === "pf2e.classfeatures" || category === "classfeature" ? "classfeature" : "feat";
}

function dedupeStaticGrantSources(sources: StaticGrantChoiceSource[]): StaticGrantChoiceSource[] {
  const byParentAndUuid = new Map<string, StaticGrantChoiceSource>();
  for (const source of sources) {
    byParentAndUuid.set(`${source.parentSelection.uuid}|${source.sourceSelection.uuid}`, source);
  }
  return Array.from(byParentAndUuid.values());
}
