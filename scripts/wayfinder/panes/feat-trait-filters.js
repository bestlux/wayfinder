import { formatSlug } from "../formatting.js";
export function supportsFeatTraitFilters(step) {
    return step.kind === "pick-item" && ["class-feat", "general-feat", "skill-feat"].includes(step.slotKind);
}
export function normalizeFeatTraitFilters(state) {
    const normalize = (values) => [
        ...new Set((Array.isArray(values) ? values : [])
            .filter((value) => typeof value === "string")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)),
    ].sort();
    const exclude = normalize(state?.exclude);
    return { include: normalize(state?.include).filter((value) => !exclude.includes(value)), exclude };
}
export function toggleFeatTraitFilter(state, value, mode) {
    const next = normalizeFeatTraitFilters(state);
    const trait = value.trim().toLowerCase();
    if (!trait)
        return next;
    const opposite = mode === "include" ? "exclude" : "include";
    next[opposite] = next[opposite].filter((entry) => entry !== trait);
    next[mode] = next[mode].includes(trait)
        ? next[mode].filter((entry) => entry !== trait)
        : [...next[mode], trait].sort();
    return next;
}
export function matchesFeatTraitFilters(option, state) {
    const traits = option.featTraits ?? [];
    return (state.include.every((trait) => traits.includes(trait)) && !state.exclude.some((trait) => traits.includes(trait)));
}
export function featTraitLabel(trait) {
    const globals = globalThis;
    const key = globals.CONFIG?.PF2E?.featTraits?.[trait];
    const label = key ? globals.game?.i18n?.localize(key) : null;
    return label && label !== key ? label : formatSlug(trait.replace(/^hb_/, ""));
}
export function buildFeatTraitFilterPane(options, state, isOpen, catalogue = options) {
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
//# sourceMappingURL=feat-trait-filters.js.map