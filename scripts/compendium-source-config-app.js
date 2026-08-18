import { discoverItemCompendia, findUnavailableSelectedCompendiumIds, isOfficialCompendium, resolveCompendiumSelection, scanCompendiumCatalog, serializeCompendiumSelection, } from "./compendium-source-catalog.js";
import { MODULE_ID, SETTINGS } from "./constants.js";
import { invalidatePackSourceCaches } from "./pack/access.js";
import { getExtraPackSetting } from "./settings.js";
const FILTERS = [
    ["all", "wayfinder-pf2e.CompendiumSources.Filters.All"],
    ["relevant", "wayfinder-pf2e.CompendiumSources.Filters.Relevant"],
    ["ancestry", "wayfinder-pf2e.CompendiumSources.Filters.Ancestry"],
    ["feat", "wayfinder-pf2e.CompendiumSources.Filters.Feat"],
    ["spell", "wayfinder-pf2e.CompendiumSources.Filters.Spell"],
];
const SORTS = [
    ["package", "wayfinder-pf2e.CompendiumSources.Sorts.Package"],
    ["relevant", "wayfinder-pf2e.CompendiumSources.Sorts.Relevant"],
    ["selected", "wayfinder-pf2e.CompendiumSources.Sorts.Selected"],
];
export class CompendiumSourceConfigApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: `${MODULE_ID}-compendium-sources`,
        tag: "form",
        classes: ["wayfinder-source-config"],
        position: {
            width: 900,
            height: 720,
        },
        form: {
            closeOnSubmit: false,
            handler: CompendiumSourceConfigApp.#handleSubmit,
        },
        window: {
            icon: "fa-solid fa-books",
            title: "wayfinder-pf2e.CompendiumSources.Title",
            contentClasses: ["standard-form"],
            resizable: true,
        },
    };
    static PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/compendium-source-config.hbs`,
        },
    };
    #rows;
    #selectedIds;
    #unavailableIds;
    #legacyPatterns;
    #unmatchedLegacyPatterns;
    #preservedLegacyPatterns;
    #hasGlobalWildcard;
    #scanGeneration = 0;
    #scanning = false;
    #scanStarted = false;
    #searchTerm = "";
    #contentFilter = "all";
    #sortOrder = "package";
    #selectedOnly = false;
    constructor(options = {}) {
        super(options);
        this.#rows = discoverItemCompendia();
        const migration = resolveCompendiumSelection(getExtraPackSetting(), this.#rows.map((row) => row.id));
        this.#selectedIds = new Set(migration.selectedIds.filter((id) => !isOfficialCompendium(id)));
        this.#unavailableIds = new Set(migration.unavailableExactIds);
        for (const id of this.#unavailableIds)
            this.#selectedIds.add(id);
        this.#legacyPatterns = migration.legacyPatterns;
        this.#unmatchedLegacyPatterns = migration.unmatchedLegacyPatterns;
        this.#preservedLegacyPatterns = new Set(migration.unmatchedLegacyPatterns);
        this.#hasGlobalWildcard = migration.hasGlobalWildcard;
    }
    static open() {
        if (!game.user?.isGM) {
            ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.CompendiumSources.GmOnly"));
            return;
        }
        new CompendiumSourceConfigApp().render(true);
    }
    async _prepareContext() {
        const rows = this.#buildRowViews();
        return {
            rows,
            filters: FILTERS.map(([value, label]) => ({ value, label, selected: value === this.#contentFilter })),
            sorts: SORTS.map(([value, label]) => ({ value, label, selected: value === this.#sortOrder })),
            searchTerm: this.#searchTerm,
            selectedOnly: this.#selectedOnly,
            selectedOptionalCount: rows.filter((row) => row.selectable && row.selected).length,
            optionalCount: rows.filter((row) => row.selectable).length,
            scanning: this.#scanning || !this.#scanStarted,
            hasErrors: rows.some((row) => row.status === "error"),
            hasLegacyPatterns: this.#legacyPatterns.length > 0,
            hasUnmatchedLegacyPatterns: this.#unmatchedLegacyPatterns.length > 0,
            hasGlobalWildcard: this.#hasGlobalWildcard,
            legacyPatterns: this.#legacyPatterns.join(", "),
            unmatchedLegacyPatterns: this.#unmatchedLegacyPatterns.join(", "),
        };
    }
    async _onRender(context, options) {
        await super._onRender(context, options);
        const root = this.element;
        if (!(root instanceof HTMLElement))
            return;
        root.querySelector("[data-source-search]")?.addEventListener("input", (event) => {
            this.#searchTerm = event.currentTarget.value;
            this.#applyClientFilter(root);
        });
        root.querySelector("[data-source-content-filter]")?.addEventListener("change", (event) => {
            this.#contentFilter = event.currentTarget.value;
            this.#applyClientFilter(root);
        });
        root.querySelector("[data-source-sort]")?.addEventListener("change", (event) => {
            this.#sortOrder = event.currentTarget.value;
            this.render(false);
        });
        root.querySelector("[data-source-selected-only]")?.addEventListener("change", (event) => {
            this.#selectedOnly = event.currentTarget.checked;
            this.#applyClientFilter(root);
        });
        for (const checkbox of root.querySelectorAll("[data-source-pack-id]")) {
            checkbox.addEventListener("change", () => {
                const packId = checkbox.dataset.sourcePackId;
                if (!packId)
                    return;
                if (checkbox.dataset.sourceLegacyPattern === "true") {
                    if (checkbox.checked)
                        this.#preservedLegacyPatterns.add(packId);
                    else
                        this.#preservedLegacyPatterns.delete(packId);
                    this.#patchSelectedSummary(root);
                    this.#applyClientFilter(root);
                    return;
                }
                if (checkbox.checked)
                    this.#selectedIds.add(packId);
                else {
                    this.#selectedIds.delete(packId);
                    this.#unavailableIds.delete(packId);
                }
                this.#patchSelectedSummary(root);
                this.#applyClientFilter(root);
            });
        }
        root.querySelector("[data-action='select-visible']")?.addEventListener("click", () => {
            this.#setVisibleSelection(root, true);
        });
        root.querySelector("[data-action='clear-visible']")?.addEventListener("click", () => {
            this.#setVisibleSelection(root, false);
        });
        root.querySelector("[data-action='refresh-counts']")?.addEventListener("click", () => {
            this.#refreshCounts();
        });
        root.querySelector("[data-action='cancel']")?.addEventListener("click", () => {
            void this.close();
        });
        this.#applyClientFilter(root);
        if (!this.#scanStarted) {
            this.#scanStarted = true;
            void this.#scanCounts();
        }
    }
    _tearDown(options) {
        this.#scanGeneration += 1;
        super._tearDown(options);
    }
    static async #handleSubmit(_event, _form) {
        if (!game.user?.isGM) {
            ui.notifications.error(game.i18n.localize("wayfinder-pf2e.CompendiumSources.GmOnly"));
            return;
        }
        const allowedIds = new Set([
            ...this.#rows.filter((row) => !row.official).map((row) => row.id),
            ...this.#unavailableIds,
        ]);
        const stored = serializeCompendiumSelection(Array.from(this.#selectedIds).filter((id) => allowedIds.has(id)), this.#preservedLegacyPatterns);
        invalidatePackSourceCaches();
        await game.settings.set(MODULE_ID, SETTINGS.extraPacks, stored);
        ui.notifications.info(game.i18n.localize("wayfinder-pf2e.CompendiumSources.Saved"));
        await this.close();
    }
    #buildRowViews() {
        const available = this.#rows.map((row) => this.#rowView(row));
        const unavailable = Array.from(this.#unavailableIds)
            .sort((left, right) => left.localeCompare(right))
            .map((id) => ({
            id,
            title: id,
            packageId: id.split(".")[0] ?? id,
            packageTitle: game.i18n.localize("wayfinder-pf2e.CompendiumSources.UnavailablePackage"),
            official: false,
            status: "unavailable",
            counts: {
                totalItems: 0,
                relevantTotal: 0,
                ancestry: 0,
                heritage: 0,
                background: 0,
                class: 0,
                deity: 0,
                feats: 0,
                ancestryFeats: 0,
                classFeats: 0,
                skillFeats: 0,
                generalFeats: 0,
                classFeatures: 0,
                spells: 0,
                other: 0,
            },
            selected: this.#selectedIds.has(id) || this.#unavailableIds.has(id),
            selectable: true,
            unavailable: true,
            legacyPattern: false,
            searchText: id.toLowerCase(),
            badges: [],
        }));
        const unmatchedPatterns = this.#unmatchedLegacyPatterns.map((pattern) => ({
            id: pattern,
            title: pattern,
            packageId: pattern.split(".")[0] ?? pattern,
            packageTitle: game.i18n.localize("wayfinder-pf2e.CompendiumSources.UnmatchedLegacyPackage"),
            official: false,
            status: "unavailable",
            counts: {
                totalItems: 0,
                relevantTotal: 0,
                ancestry: 0,
                heritage: 0,
                background: 0,
                class: 0,
                deity: 0,
                feats: 0,
                ancestryFeats: 0,
                classFeats: 0,
                skillFeats: 0,
                generalFeats: 0,
                classFeatures: 0,
                spells: 0,
                other: 0,
            },
            selected: this.#preservedLegacyPatterns.has(pattern),
            selectable: true,
            unavailable: false,
            legacyPattern: true,
            searchText: pattern.toLowerCase(),
            badges: [],
        }));
        return [...available, ...unavailable, ...unmatchedPatterns].sort((left, right) => this.#compareRowViews(left, right));
    }
    #rowView(row) {
        const badges = [];
        if (row.counts.ancestry > 0)
            badges.push({
                kind: "ancestry",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Ancestries"),
                count: row.counts.ancestry,
            });
        if (row.counts.heritage > 0)
            badges.push({
                kind: "heritage",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Heritages"),
                count: row.counts.heritage,
            });
        if (row.counts.background > 0)
            badges.push({
                kind: "background",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Backgrounds"),
                count: row.counts.background,
            });
        if (row.counts.class > 0)
            badges.push({
                kind: "class",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Classes"),
                count: row.counts.class,
            });
        if (row.counts.feats > 0)
            badges.push({
                kind: "feat",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Feats"),
                count: row.counts.feats,
            });
        if (row.counts.spells > 0)
            badges.push({
                kind: "spell",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Spells"),
                count: row.counts.spells,
            });
        if (row.counts.deity > 0)
            badges.push({
                kind: "deity",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Deities"),
                count: row.counts.deity,
            });
        if (row.counts.other > 0)
            badges.push({
                kind: "other",
                label: game.i18n.localize("wayfinder-pf2e.CompendiumSources.Counts.Other"),
                count: row.counts.other,
            });
        return {
            ...row,
            selected: row.official || this.#selectedIds.has(row.id),
            selectable: !row.official,
            unavailable: false,
            legacyPattern: false,
            searchText: `${row.title} ${row.packageTitle} ${row.id}`.toLowerCase(),
            badges,
        };
    }
    async #scanCounts() {
        const generation = ++this.#scanGeneration;
        this.#scanning = true;
        const scanned = await scanCompendiumCatalog(this.#rows);
        if (generation !== this.#scanGeneration)
            return;
        this.#rows = scanned;
        this.#scanning = false;
        this.render(false);
    }
    #refreshCounts() {
        this.#scanGeneration += 1;
        this.#rows = discoverItemCompendia();
        const availableIds = new Set(this.#rows.map((row) => row.id));
        const stillUnmatched = [];
        for (const pattern of this.#unmatchedLegacyPatterns) {
            const refreshed = resolveCompendiumSelection(pattern, [...availableIds]);
            if (refreshed.selectedIds.length === 0) {
                stillUnmatched.push(pattern);
                continue;
            }
            if (this.#preservedLegacyPatterns.has(pattern)) {
                for (const id of refreshed.selectedIds) {
                    if (!isOfficialCompendium(id))
                        this.#selectedIds.add(id);
                }
            }
            this.#preservedLegacyPatterns.delete(pattern);
        }
        this.#unmatchedLegacyPatterns = stillUnmatched;
        this.#unavailableIds = new Set(findUnavailableSelectedCompendiumIds(this.#selectedIds, availableIds));
        this.#scanStarted = true;
        void this.#scanCounts();
        this.render(false);
    }
    #setVisibleSelection(root, selected) {
        for (const checkbox of root.querySelectorAll("[data-source-pack-id]")) {
            const row = checkbox.closest("[data-source-row]");
            const packId = checkbox.dataset.sourcePackId;
            if (!packId || checkbox.disabled || row?.hidden)
                continue;
            checkbox.checked = selected;
            if (checkbox.dataset.sourceLegacyPattern === "true") {
                if (selected)
                    this.#preservedLegacyPatterns.add(packId);
                else
                    this.#preservedLegacyPatterns.delete(packId);
            }
            else if (selected)
                this.#selectedIds.add(packId);
            else {
                this.#selectedIds.delete(packId);
                this.#unavailableIds.delete(packId);
            }
        }
        this.#patchSelectedSummary(root);
        this.#applyClientFilter(root);
    }
    #applyClientFilter(root) {
        const query = this.#searchTerm.trim().toLowerCase();
        for (const row of root.querySelectorAll("[data-source-row]")) {
            const checkbox = row.querySelector("[data-source-pack-id]");
            const selected = checkbox?.checked ?? row.dataset.sourceOfficial === "true";
            const matchesSearch = query.length === 0 || (row.dataset.sourceSearch ?? "").includes(query);
            const matchesSelected = !this.#selectedOnly || selected;
            const matchesContent = this.#matchesContentFilter(row);
            row.hidden = !(matchesSearch && matchesSelected && matchesContent);
        }
    }
    #matchesContentFilter(row) {
        if (this.#contentFilter === "all")
            return true;
        if (this.#contentFilter === "relevant")
            return Number(row.dataset.sourceRelevant ?? 0) > 0;
        const kinds = (row.dataset.sourceKinds ?? "").split(" ");
        if (this.#contentFilter === "ancestry")
            return kinds.includes("ancestry") || kinds.includes("heritage");
        return kinds.includes(this.#contentFilter);
    }
    #compareRowViews(left, right) {
        if (left.official !== right.official)
            return left.official ? -1 : 1;
        if (this.#sortOrder === "selected" && left.selected !== right.selected)
            return left.selected ? -1 : 1;
        if (this.#sortOrder === "relevant" && left.counts.relevantTotal !== right.counts.relevantTotal) {
            return right.counts.relevantTotal - left.counts.relevantTotal;
        }
        return (left.packageTitle.localeCompare(right.packageTitle) ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id));
    }
    #patchSelectedSummary(root) {
        const selectedCount = Array.from(root.querySelectorAll("[data-source-pack-id]")).filter((checkbox) => checkbox.checked && !checkbox.disabled).length;
        const target = root.querySelector("[data-source-selected-count]");
        if (target)
            target.textContent = String(selectedCount);
    }
}
//# sourceMappingURL=compendium-source-config-app.js.map