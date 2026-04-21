export function parseCurriculumSpells(raw) {
    const description = typeof raw === "string" ? raw : "";
    const matches = description.matchAll(/<li><strong>([^<]+):<\/strong>\s*([\s\S]*?)<\/li>/gi);
    const result = {};
    for (const [, label, content] of matches) {
        const rank = rankFromCurriculumLabel(label);
        if (rank === null) {
            continue;
        }
        result[rank] = collectCurriculumSpellNames(String(content));
    }
    return result;
}
export function parseDeitySpellNames(document, rank) {
    const value = document?.system?.spells?.[String(rank)];
    const rawValues = Array.isArray(value) ? value : value ? [value] : [];
    const names = new Set();
    for (const raw of rawValues) {
        const name = spellNameFromDeityReference(raw);
        if (name) {
            names.add(name);
        }
    }
    return Array.from(names);
}
function collectCurriculumSpellNames(content) {
    const names = new Set();
    for (const match of content.matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\](?:\{([^}]+)\})?/gi)) {
        const name = normalizeCurriculumSpellName(match[2] ?? match[1] ?? "");
        if (name) {
            names.add(name);
        }
    }
    for (const match of content.matchAll(/<a\b[^>]*data-uuid="Compendium\.pf2e\.spells-srd\.Item\.[^"]+"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const name = normalizeCurriculumSpellName(match[1] ?? "");
        if (name) {
            names.add(name);
        }
    }
    return Array.from(names);
}
function rankFromCurriculumLabel(label) {
    const normalized = label.trim().toLowerCase();
    if (normalized === "cantrips" || normalized === "cantrip") {
        return 0;
    }
    const map = {
        "1st": 1,
        "2nd": 2,
        "3rd": 3,
        "4th": 4,
        "5th": 5,
        "6th": 6,
        "7th": 7,
        "8th": 8,
        "9th": 9,
    };
    return map[normalized] ?? null;
}
function spellNameFromDeityReference(raw) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        return null;
    }
    const match = /\.Item\.(.+)$/.exec(raw.trim());
    const name = match?.[1] ?? raw;
    return name
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function decodeCompendiumName(raw) {
    return decodeURIComponent(raw).replace(/\+/g, " ").trim();
}
function normalizeCurriculumSpellName(raw) {
    const decoded = decodeCompendiumName(raw);
    return decoded
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
//# sourceMappingURL=metadata-parsing.js.map