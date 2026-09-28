/** Filter the already-rendered trait vocabulary without replacing the focused input or preparing the actor. */
export class PickerTraitSearch {
  readonly #queries = new Map<string, string>();
  readonly #bound = new WeakSet<HTMLElement>();

  bind(root: HTMLElement): void {
    for (const panel of root.querySelectorAll<HTMLElement>("[data-picker-trait-panel]")) {
      const input = panel.querySelector<HTMLInputElement>("[data-picker-trait-search]");
      const stepId = input?.dataset.stepId;
      if (!input || !stepId) continue;
      input.value = this.#queries.get(stepId) ?? "";
      const apply = () => {
        const query = input.value.trim().toLocaleLowerCase();
        this.#queries.set(stepId, input.value);
        let visible = 0;
        for (const row of panel.querySelectorAll<HTMLElement>("[data-picker-trait-option]")) {
          row.hidden = row.dataset.active !== "true" && !(row.dataset.search ?? "").toLocaleLowerCase().includes(query);
          if (!row.hidden) visible++;
        }
        const count = panel.querySelector<HTMLElement>("[data-picker-trait-count]");
        if (count) count.textContent = String(visible);
      };
      apply();
      if (this.#bound.has(panel)) continue;
      this.#bound.add(panel);
      input.addEventListener("input", apply);
      panel.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        panel
          .closest("[data-wayfinder-filter-menu]")
          ?.querySelector<HTMLButtonElement>(".picker-filter-trigger")
          ?.click();
      });
    }
  }

  clear(stepId?: string): void {
    if (stepId) this.#queries.delete(stepId);
    else this.#queries.clear();
  }

  focusTarget(root: HTMLElement, focusId: string | null): HTMLElement | null {
    if (!focusId?.startsWith("picker-trait")) return null;
    const control = root.querySelector<HTMLElement>(`[data-wayfinder-focus-id="${CSS.escape(focusId)}"]`);
    if (control?.getClientRects().length) return control;
    return (
      root.querySelector<HTMLElement>("[data-picker-trait-search]") ??
      root.querySelector<HTMLElement>('[data-wayfinder-focus-id="picker-traits-trigger"]')
    );
  }
}
