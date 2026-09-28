import type { OptionRecord, PendingStep, PickerTraitFilterState } from "../../types.js";
import { formatSlug } from "../formatting.js";

export interface FeatTraitFilterPane {
  isOpen: boolean;
  selectedCount: number;
  summary: string;
  canHideDedications: boolean;
  hideDedications: boolean;
  options: Array<{
    value: string;
    label: string;
    count: number;
    included: boolean;
    excluded: boolean;
    active: boolean;
  }>;
}

export function supportsFeatTraitFilters(step: PendingStep): boolean {
  return step.kind === "pick-item" && ["class-feat", "general-feat", "skill-feat"].includes(step.slotKind);
}

export function normalizeFeatTraitFilters(state?: Partial<PickerTraitFilterState>): PickerTraitFilterState {
  const normalize = (values: string[] | undefined) =>
    [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .filter((value) => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      ),
    ].sort();
  const exclude = normalize(state?.exclude);
  return { include: normalize(state?.include).filter((value) => !exclude.includes(value)), exclude };
}

export function toggleFeatTraitFilter(
  state: PickerTraitFilterState | undefined,
  value: string,
  mode: "include" | "exclude"
): PickerTraitFilterState {
  const next = normalizeFeatTraitFilters(state);
  const trait = value.trim().toLowerCase();
  if (!trait) return next;
  const opposite = mode === "include" ? "exclude" : "include";
  next[opposite] = next[opposite].filter((entry) => entry !== trait);
  next[mode] = next[mode].includes(trait)
    ? next[mode].filter((entry) => entry !== trait)
    : [...next[mode], trait].sort();
  return next;
}

export function matchesFeatTraitFilters(option: OptionRecord, state: PickerTraitFilterState): boolean {
  const traits = option.featTraits ?? [];
  return (
    state.include.every((trait) => traits.includes(trait)) && !state.exclude.some((trait) => traits.includes(trait))
  );
}

export function featTraitLabel(trait: string): string {
  const globals = globalThis as typeof globalThis & {
    CONFIG?: { PF2E?: { featTraits?: Record<string, string> } };
    game?: { i18n?: { localize: (key: string) => string } };
  };
  const key = globals.CONFIG?.PF2E?.featTraits?.[trait];
  const label = key ? globals.game?.i18n?.localize(key) : null;
  return label && label !== key ? label : formatSlug(trait.replace(/^hb_/, ""));
}

export function buildFeatTraitFilterPane(
  options: OptionRecord[],
  state: PickerTraitFilterState,
  isOpen: boolean,
  catalogue: OptionRecord[] = options
): FeatTraitFilterPane {
  const values = new Set([
    ...catalogue.flatMap((option) => option.featTraits ?? []),
    ...state.include,
    ...state.exclude,
  ]);
  const rows = [...values]
    .map((value) => {
      const others = {
        include: state.include.filter((trait) => trait !== value),
        exclude: state.exclude.filter((trait) => trait !== value),
      };
      const included = state.include.includes(value);
      const excluded = state.exclude.includes(value);
      return {
        value,
        label: featTraitLabel(value),
        count: options.filter((option) => option.featTraits?.includes(value) && matchesFeatTraitFilters(option, others))
          .length,
        included,
        excluded,
        active: included || excluded,
      };
    })
    .sort((left, right) => Number(right.active) - Number(left.active) || left.label.localeCompare(right.label));
  const selectedCount = state.include.length + state.exclude.length;
  return {
    isOpen,
    selectedCount,
    summary: rows
      .filter((row) => row.active)
      .map((row) => `${row.included ? "+" : "−"} ${row.label}`)
      .join(", "),
    canHideDedications: values.has("dedication"),
    hideDedications: state.exclude.includes("dedication"),
    options: rows,
  };
}
