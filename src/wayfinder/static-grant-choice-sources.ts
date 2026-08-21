import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { slugifyName } from "../shared/slug.js";
import type { SelectionRef } from "../types.js";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  matchesChoiceSetRulePredicate,
  toNonEmptyString,
} from "./rule-data.js";
import { selectionTakenLevel } from "./selection-level.js";

export interface StaticGrantChoiceSource {
  grantRuleIndex: number;
  supportsGuidedChoices: boolean;
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
  const grants = args.sources.flatMap(({ sourceSelection, sourceDocument }) =>
    staticGrantSelections(sourceSelection, sourceDocument, args.activeRollOptions).map((grant) => ({
      ...grant,
      parentSelection: sourceSelection,
    }))
  );
  const occurrenceCounts = new Map<string, number>();
  for (const grant of grants) {
    const key = staticGrantOccurrenceKey(grant.selection);
    occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1);
  }

  const pending = grants.map(
    async ({
      grantRuleIndex,
      preselectChoices,
      selection,
      parentSelection,
    }): Promise<StaticGrantChoiceSource | null> => {
      const sourceDocument = await args.fetchSelectionDocument(selection);
      const choiceRules = sourceDocument
        ? getDocumentRules(sourceDocument).filter((rule) => rule.key === "ChoiceSet")
        : [];
      if (
        !sourceDocument ||
        choiceRules.length === 0 ||
        choiceRules.every((rule) => {
          const key = extractChoiceKey(rule);
          return key !== null && typeof preselectChoices[key] === "string" && preselectChoices[key].length > 0;
        })
      ) {
        return null;
      }

      const sourceItemType = inferGrantedSourceItemType(selection, sourceDocument);
      const sourceLevel = selectionTakenLevel(parentSelection, documentFeatureLevel(sourceDocument));
      return {
        grantRuleIndex,
        supportsGuidedChoices: occurrenceCounts.get(staticGrantOccurrenceKey(selection)) === 1,
        parentSelection,
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
  );

  const resolved = await Promise.all(pending);
  return dedupeStaticGrantSources(resolved.filter((source): source is StaticGrantChoiceSource => source !== null));
}

function staticGrantOccurrenceKey(childSelection: SelectionRef): string {
  return childSelection.uuid.trim().toLowerCase();
}

export function staticGrantSelections(
  parentSelection: SelectionRef,
  sourceDocument: unknown,
  activeRollOptions: ReadonlySet<string> = new Set()
): Array<{ grantRuleIndex: number; preselectChoices: Record<string, string>; selection: SelectionRef }> {
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
        preselectChoices: isStringRecord(rule.preselectChoices) ? rule.preselectChoices : {},
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
  options.add(`self:level:${selectionTakenLevel(parentSelection, documentFeatureLevel(sourceDocument))}`);
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
    byParentAndUuid.set(
      `${source.parentSelection.uuid}|${source.grantRuleIndex}|${source.sourceSelection.uuid}`,
      source
    );
  }
  return Array.from(byParentAndUuid.values());
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
