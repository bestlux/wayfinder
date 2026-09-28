/** Filter the already-rendered trait vocabulary without replacing the focused input or preparing the actor. */
export class PickerTraitSearch {
    #queries = new Map();
    #bound = new WeakSet();
    bind(root) {
        for (const panel of root.querySelectorAll("[data-picker-trait-panel]")) {
            const input = panel.querySelector("[data-picker-trait-search]");
            const stepId = input?.dataset.stepId;
            if (!input || !stepId)
                continue;
            input.value = this.#queries.get(stepId) ?? "";
            const apply = () => {
                const query = input.value.trim().toLocaleLowerCase();
                this.#queries.set(stepId, input.value);
                let visible = 0;
                for (const row of panel.querySelectorAll("[data-picker-trait-option]")) {
                    row.hidden = row.dataset.active !== "true" && !(row.dataset.search ?? "").toLocaleLowerCase().includes(query);
                    if (!row.hidden)
                        visible++;
                }
                const count = panel.querySelector("[data-picker-trait-count]");
                if (count)
                    count.textContent = String(visible);
            };
            apply();
            if (this.#bound.has(panel))
                continue;
            this.#bound.add(panel);
            input.addEventListener("input", apply);
            panel.addEventListener("keydown", (event) => {
                if (event.key !== "Escape")
                    return;
                event.preventDefault();
                event.stopPropagation();
                panel
                    .closest("[data-wayfinder-filter-menu]")
                    ?.querySelector(".picker-filter-trigger")
                    ?.click();
            });
        }
    }
    clear(stepId) {
        if (stepId)
            this.#queries.delete(stepId);
        else
            this.#queries.clear();
    }
    focusTarget(root, focusId) {
        if (!focusId?.startsWith("picker-trait"))
            return null;
        const control = root.querySelector(`[data-wayfinder-focus-id="${CSS.escape(focusId)}"]`);
        if (control?.getClientRects().length)
            return control;
        return (root.querySelector("[data-picker-trait-search]") ??
            root.querySelector('[data-wayfinder-focus-id="picker-traits-trigger"]'));
    }
}
//# sourceMappingURL=picker-trait-search.js.map