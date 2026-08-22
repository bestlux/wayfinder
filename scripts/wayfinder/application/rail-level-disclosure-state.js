export function emptyRailLevelDisclosureState() {
    return {
        expansionOverrides: new Map(),
        invalidatedLevels: new Set(),
    };
}
export function deriveRailLevelDisclosures(rows, previous) {
    const groupedRows = new Map();
    for (const row of rows) {
        const group = groupedRows.get(row.level);
        if (group) {
            group.push(row);
        }
        else {
            groupedRows.set(row.level, [row]);
        }
    }
    const presentLevels = new Set(groupedRows.keys());
    const invalidatedLevels = new Set();
    for (const [level, steps] of groupedRows) {
        if (steps.some((step) => step.invalidated))
            invalidatedLevels.add(level);
    }
    const expansionOverrides = new Map([...previous.expansionOverrides].filter(([level]) => presentLevels.has(level) && !(invalidatedLevels.has(level) && !previous.invalidatedLevels.has(level))));
    const groups = [...groupedRows].map(([level, steps]) => {
        const completedCount = steps.filter((step) => step.complete).length;
        const active = steps.some((step) => step.active);
        const invalidated = invalidatedLevels.has(level);
        const defaultExpanded = active || completedCount < steps.length || invalidated;
        return {
            level,
            steps,
            completedCount,
            stepCount: steps.length,
            active,
            invalidated,
            // The active step must remain reachable even when this level had been collapsed manually.
            expanded: active || (expansionOverrides.has(level) ? expansionOverrides.get(level) === true : defaultExpanded),
        };
    });
    return {
        groups,
        state: { expansionOverrides, invalidatedLevels },
    };
}
export function setRailLevelExpansionOverride(state, level, expanded) {
    if (!Number.isInteger(level) || level < 1)
        return state;
    const expansionOverrides = new Map(state.expansionOverrides);
    expansionOverrides.set(level, expanded);
    return { ...state, expansionOverrides };
}
//# sourceMappingURL=rail-level-disclosure-state.js.map