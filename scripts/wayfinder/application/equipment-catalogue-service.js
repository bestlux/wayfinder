import { cloneData } from "../../shared/cloning.js";
import { evaluateEquipmentItemAuthority, resolveEquipmentItemExceptionJudgmentIds, } from "../domain/equipment-policy.js";
export const EQUIPMENT_CATALOGUE_PROJECTION_VERSION = 1;
export const WF_080_21_DAGGER_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
const INDEX_FIELDS = Object.freeze([
    "img",
    "type",
    "system.level.value",
    "system.traits.rarity",
    "system.traits.value",
    "system.publication.title",
    "system.source.value",
    "system.price.value",
    "system.price.per",
    "system.quantity",
    "system.rules",
]);
const PHYSICAL_ITEM_TYPES = new Set(["ammo", "armor", "backpack", "consumable", "equipment", "shield", "weapon"]);
const CONTAINER_ITEM_TYPES = new Set(["kit"]);
const INTERACTIVE_RULE_KEYS = new Set(["ChoiceSet", "GrantItem"]);
const DENOMINATIONS = ["pp", "gp", "sp", "cp"];
const COPPER_VALUE = Object.freeze({ pp: 1000, gp: 100, sp: 10, cp: 1 });
export function fingerprintEquipmentDocument(source) {
    if (!isRecord(source))
        throw new TypeError("Equipment document fingerprinting requires a source object.");
    return fingerprint("equipment-document-v1", source);
}
export function createEquipmentAccessRegistry(records = []) {
    const byUuid = new Map();
    for (const record of records) {
        parseCompendiumItemUuid(record.sourceUuid);
        if (!nonEmpty(record.accessRef) || !nonEmpty(record.profileVersion)) {
            throw new TypeError("Equipment Access records require stable access and profile identities.");
        }
        if (byUuid.has(record.sourceUuid)) {
            throw new TypeError(`Equipment Access is registered more than once for ${record.sourceUuid}.`);
        }
        byUuid.set(record.sourceUuid, record);
    }
    const sourceUuids = [...byUuid.keys()].sort((left, right) => left.localeCompare(right));
    const registryFingerprint = fingerprint("equipment-access-registry-v1", sourceUuids.map((sourceUuid) => {
        const record = byUuid.get(sourceUuid);
        return { sourceUuid, accessRef: record.accessRef, profileVersion: record.profileVersion };
    }));
    return Object.freeze({
        fingerprint: registryFingerprint,
        sourceUuids: Object.freeze(sourceUuids),
        resolve(input) {
            const record = byUuid.get(input.candidate.sourceUuid);
            if (!record)
                return null;
            try {
                return record.resolve(input) ? record.accessRef : null;
            }
            catch {
                return null;
            }
        },
    });
}
export const EMPTY_EQUIPMENT_ACCESS_REGISTRY = createEquipmentAccessRegistry();
export function createEquipmentCatalogueDraftContext(input) {
    if (!nonEmpty(input.draftId) ||
        !Number.isSafeInteger(input.targetLevel) ||
        input.targetLevel < 1 ||
        input.targetLevel > 20 ||
        !Number.isSafeInteger(input.version) ||
        input.version < 1 ||
        !isRecord(input.accessFacts)) {
        throw new TypeError("Equipment catalogue Access requires current draft identity, version, and facts.");
    }
    const accessFacts = deepFreeze(cloneData(input.accessFacts));
    const material = {
        draftId: input.draftId,
        targetLevel: input.targetLevel,
        version: input.version,
        accessFacts,
    };
    return Object.freeze({
        ...material,
        accessFactsFingerprint: fingerprint("equipment-access-facts-v1", material),
    });
}
export class EquipmentCatalogueService {
    #packs;
    #equipmentPackIds;
    #accessRegistry;
    #packIndexCache = new Map();
    #projectionCache = new Map();
    #latestCandidateByUuid = new Map();
    #previewCache = new Map();
    #pendingPreviews = new Map();
    #packGenerations = new Map();
    #projectionGeneration = 0;
    constructor(options) {
        this.#packs = options.packs;
        this.#equipmentPackIds = new Set(uniqueSorted(options.equipmentPackIds.filter(nonEmpty)));
        if (this.#equipmentPackIds.size !== options.equipmentPackIds.length) {
            throw new TypeError("Equipment catalogue pack IDs must be non-empty and unique.");
        }
        this.#accessRegistry = options.accessRegistry ?? EMPTY_EQUIPMENT_ACCESS_REGISTRY;
    }
    async project(context) {
        assertContext(context);
        const packIds = uniqueSorted(context.policy.sourcePolicy.effectivePackIds.filter((packId) => this.#equipmentPackIds.has(packId)));
        const cacheKey = this.#projectionKey(context.policy, packIds);
        let pending = this.#projectionCache.get(cacheKey);
        if (pending === undefined) {
            pending = this.#loadProjectionCandidates(packIds);
            this.#projectionCache.set(cacheKey, pending);
            pending.catch(() => {
                if (this.#projectionCache.get(cacheKey) === pending)
                    this.#projectionCache.delete(cacheKey);
            });
        }
        const candidates = await pending;
        if (cacheKey !== this.#projectionKey(context.policy, packIds))
            return this.project(context);
        const entries = candidates.map((candidate) => this.#evaluateCandidate(context, candidate)).sort(compareEntries);
        for (const entry of entries)
            this.#latestCandidateByUuid.set(entry.sourceUuid, stripEvaluation(entry));
        return Object.freeze({
            version: EQUIPMENT_CATALOGUE_PROJECTION_VERSION,
            cacheKey,
            entries: Object.freeze(entries),
        });
    }
    async search(context, filters = {}) {
        const projection = await this.project(context);
        const queryTerms = tokenize(filters.query ?? "");
        const itemTypes = normalizedSet(filters.itemTypes);
        const rarities = new Set(filters.rarities ?? []);
        const publications = normalizedSet(filters.publicationSlugs);
        const traits = normalizedSet(filters.traits);
        const availability = filters.availability ?? "all";
        const maximumLevel = filters.maximumLevel;
        return projection.entries.filter((entry) => {
            if (availability === "available" && !entry.available)
                return false;
            if (availability === "unavailable" && entry.available)
                return false;
            if (itemTypes.size > 0 && !itemTypes.has(entry.itemType))
                return false;
            if (rarities.size > 0 && !rarities.has(entry.rarity))
                return false;
            if (publications.size > 0 && !publications.has(entry.publicationSlug))
                return false;
            if (traits.size > 0 && [...traits].some((trait) => !entry.traits.includes(trait)))
                return false;
            if (maximumLevel !== undefined && entry.level > maximumLevel)
                return false;
            if (queryTerms.length === 0)
                return true;
            const searchable = normalizeSearchText([entry.name, entry.itemType, entry.publicationSlug, ...entry.traits].join(" "));
            return queryTerms.every((term) => searchable.includes(term));
        });
    }
    async hydratePreview(sourceUuid, context) {
        if (context)
            assertContext(context);
        const candidate = this.#latestCandidateByUuid.get(sourceUuid);
        if (!candidate)
            return null;
        const generation = this.#packGeneration(candidate.packId);
        const cached = this.#previewCache.get(sourceUuid);
        if (cached?.previewIdentity === candidate.previewIdentity) {
            return this.#previewResult(sourceUuid, candidate, cached, context);
        }
        let pending = this.#pendingPreviews.get(sourceUuid);
        if (pending === undefined ||
            pending.generation !== generation ||
            pending.previewIdentity !== candidate.previewIdentity) {
            const { pack, documentId } = this.#resolvePack(sourceUuid);
            const previewIdentity = candidate.previewIdentity;
            pending = {
                generation,
                previewIdentity,
                promise: pack.getDocument(documentId).then((document) => Object.freeze({
                    previewIdentity,
                    source: document === null ? null : extractDocumentSource(document),
                })),
            };
            this.#pendingPreviews.set(sourceUuid, pending);
        }
        let next;
        try {
            next = await pending.promise;
        }
        finally {
            if (this.#pendingPreviews.get(sourceUuid) === pending)
                this.#pendingPreviews.delete(sourceUuid);
        }
        const currentCandidate = this.#latestCandidateByUuid.get(sourceUuid);
        if (generation !== this.#packGeneration(candidate.packId) ||
            currentCandidate?.previewIdentity !== candidate.previewIdentity) {
            return currentCandidate ? this.hydratePreview(sourceUuid, context) : null;
        }
        this.#previewCache.set(sourceUuid, next);
        return this.#previewResult(sourceUuid, candidate, next, context);
    }
    async resolveForApply(context, sourceUuid) {
        return this.#resolveHydratedForApply(context, sourceUuid, false);
    }
    /**
     * Hydrates one exact source for a caller that already proved fixed native-grant authority.
     * This does not add the pack to catalogue projection, search, preview, or ordinary Apply.
     */
    async resolveFixedNativeSourceForApply(context, sourceUuid, authority) {
        if (authority.kind !== "fixed-native-grant" || sourceUuid !== authority.expectedSourceUuid) {
            throw new TypeError("Fixed native equipment hydration requires exact source authority.");
        }
        const { packId } = this.#resolvePack(sourceUuid);
        if (packId !== authority.expectedPackId) {
            throw new TypeError("Fixed native equipment hydration requires exact pack authority.");
        }
        return this.#resolveHydratedForApply(context, sourceUuid, true);
    }
    async #resolveHydratedForApply(context, sourceUuid, allowOutsideEffectivePackSet) {
        assertContext(context);
        const { pack, packId, documentId } = this.#resolvePack(sourceUuid);
        if (!allowOutsideEffectivePackSet &&
            (!this.#equipmentPackIds.has(packId) || !context.policy.sourcePolicy.effectivePackIds.includes(packId))) {
            throw new TypeError(`Equipment source ${sourceUuid} is outside the current effective pack set.`);
        }
        const document = await pack.getDocument(documentId);
        if (!document)
            throw new TypeError(`Equipment source ${sourceUuid} is no longer available.`);
        const source = extractDocumentSource(document);
        const normalized = normalizeCandidate(source, packId, sourceUuid);
        const evaluated = this.#evaluateCandidate(context, normalized, source);
        return Object.freeze({
            source: cloneData(source),
            candidate: stripEvaluation(evaluated),
            documentFingerprint: fingerprintEquipmentDocument(source),
            priceFingerprint: fingerprint("equipment-price-v1", evaluated.price),
            available: evaluated.available,
            unavailableReasons: evaluated.unavailableReasons,
            policyDecision: evaluated.policyDecision,
        });
    }
    invalidatePack(packId) {
        if (!nonEmpty(packId))
            throw new TypeError("Equipment pack invalidation requires a pack ID.");
        this.#projectionGeneration += 1;
        this.#packGenerations.set(packId, this.#packGeneration(packId) + 1);
        this.#projectionCache.clear();
        for (const key of this.#packIndexCache.keys()) {
            if (key.startsWith(`${packId}|`))
                this.#packIndexCache.delete(key);
        }
        for (const [sourceUuid, candidate] of this.#latestCandidateByUuid) {
            if (candidate.packId === packId)
                this.#latestCandidateByUuid.delete(sourceUuid);
        }
        for (const sourceUuid of this.#previewCache.keys()) {
            if (parseCompendiumItemUuid(sourceUuid).packId === packId)
                this.#previewCache.delete(sourceUuid);
        }
        for (const sourceUuid of this.#pendingPreviews.keys()) {
            if (parseCompendiumItemUuid(sourceUuid).packId === packId)
                this.#pendingPreviews.delete(sourceUuid);
        }
    }
    #projectionKey(policy, packIds) {
        return canonicalJson({
            version: EQUIPMENT_CATALOGUE_PROJECTION_VERSION,
            packIds,
            policyFingerprint: policy.fingerprint,
            accessRegistryFingerprint: this.#accessRegistry.fingerprint,
            invalidationGeneration: this.#projectionGeneration,
        });
    }
    async #loadProjectionCandidates(packIds) {
        const byPack = await Promise.all(packIds.map((packId) => this.#loadPackCandidates(packId)));
        const flattened = byPack.flat();
        const seen = new Set();
        for (const { candidate } of flattened) {
            if (seen.has(candidate.sourceUuid)) {
                throw new TypeError(`Equipment catalogue contains duplicate source UUID ${candidate.sourceUuid}.`);
            }
            seen.add(candidate.sourceUuid);
        }
        return Object.freeze(flattened);
    }
    #loadPackCandidates(packId) {
        const key = `${packId}|${this.#packGeneration(packId)}`;
        let pending = this.#packIndexCache.get(key);
        if (pending !== undefined)
            return pending;
        const pack = this.#packs.get(packId);
        if (!pack)
            throw new TypeError(`Configured equipment pack ${packId} is unavailable.`);
        const documentName = pack.documentName ?? pack.metadata?.type;
        if (documentName !== undefined && documentName !== "Item") {
            throw new TypeError(`Configured equipment pack ${packId} is not an Item pack.`);
        }
        pending = pack.getIndex({ fields: [...INDEX_FIELDS] }).then((index) => Object.freeze(Array.from(index ?? []).flatMap((entry) => {
            const normalized = normalizeIndexEntry(entry, packId);
            return normalized ? [normalized] : [];
        })));
        this.#packIndexCache.set(key, pending);
        pending.catch(() => {
            if (this.#packIndexCache.get(key) === pending)
                this.#packIndexCache.delete(key);
        });
        return pending;
    }
    #evaluateCandidate(context, normalized, source = null) {
        const candidate = normalized.candidate;
        const blanketAuthorized = rarityAtOrBelow(candidate.rarity, context.policy.rarityPolicy.blanketCeiling);
        const characterAccessRef = blanketAuthorized || source === null
            ? null
            : this.#accessRegistry.resolve({
                actor: context.actor,
                draft: cloneAccessDraft(context.draft),
                candidate,
                source: source === null ? null : cloneData(source),
            });
        const exceptionIds = resolveEquipmentItemExceptionJudgmentIds({
            policy: context.policy,
            sourceUuid: candidate.sourceUuid,
            packId: candidate.packId,
            publicationSlug: candidate.publicationSlug,
            rarity: candidate.rarity,
        });
        const authority = evaluateEquipmentItemAuthority({
            policy: context.policy,
            sourceUuid: candidate.sourceUuid,
            packId: candidate.packId,
            publicationSlug: candidate.publicationSlug,
            rarity: candidate.rarity,
            hasCharacterAccess: characterAccessRef !== null,
            ...exceptionIds,
        });
        const policyReasons = authority.reasons.flatMap((code) => authorityReason(code));
        const unavailableReasons = dedupeReasons([...normalized.reasons, ...policyReasons]);
        const policyDecision = Object.freeze({
            eligible: authority.eligible && normalized.reasons.length === 0,
            packId: candidate.packId,
            publicationSlug: candidate.publicationSlug,
            rarity: candidate.rarity,
            sourceBasis: exceptionIds.sourceExceptionJudgmentId
                ? "gm-source-exception"
                : authority.reasons.includes("source-not-allowed")
                    ? "source-not-allowed"
                    : "approved-pack",
            rarityBasis: candidate.rarity === "common"
                ? "common"
                : exceptionIds.rarityExceptionJudgmentId
                    ? "gm-rarity-exception"
                    : characterAccessRef
                        ? "specific-character-access"
                        : `blanket-${context.policy.rarityPolicy.blanketCeiling}`,
            characterAccessRef,
            ...exceptionIds,
            abpTreatment: context.policy.abp.enabled ? `abp-${context.policy.abp.mode ?? "enabled"}` : "unchanged",
        });
        return Object.freeze({
            ...candidate,
            available: policyDecision.eligible,
            unavailableReasons: Object.freeze(unavailableReasons),
            policyDecision,
        });
    }
    #resolvePack(sourceUuid) {
        const { packId, documentId } = parseCompendiumItemUuid(sourceUuid);
        const pack = this.#packs.get(packId);
        if (!pack)
            throw new TypeError(`Equipment pack ${packId} is unavailable.`);
        return { pack, packId, documentId };
    }
    #packGeneration(packId) {
        return this.#packGenerations.get(packId) ?? 0;
    }
    #previewResult(sourceUuid, indexedCandidate, cached, context) {
        const source = cached.source === null ? null : cloneData(cached.source);
        const current = source === null ? null : normalizeCandidate(source, indexedCandidate.packId, sourceUuid);
        return Object.freeze({
            sourceUuid,
            previewIdentity: cached.previewIdentity,
            source,
            entry: context && current ? this.#evaluateCandidate(context, current, source) : null,
        });
    }
}
export function createEquipmentCatalogueService(options) {
    return new EquipmentCatalogueService(options);
}
function normalizeIndexEntry(entry, packId) {
    const value = record(entry);
    const documentId = nonEmpty(value._id) ? value._id : documentIdFromUuid(value.uuid, packId);
    if (!documentId)
        return null;
    return normalizeCandidate(value, packId, `Compendium.${packId}.Item.${documentId}`);
}
function normalizeCandidate(source, packId, sourceUuid) {
    const value = record(source);
    const system = record(value.system);
    const traitsRoot = record(system.traits);
    const rulesValid = Array.isArray(system.rules);
    const rawRules = Array.isArray(system.rules) ? system.rules : [];
    const ruleKeys = uniqueSorted(rawRules.map((rule) => (nonEmpty(record(rule).key) ? String(record(rule).key) : "<unknown>")));
    const itemType = nonEmpty(value.type) ? value.type.trim().toLowerCase() : "unknown";
    const rarity = equipmentRarity(traitsRoot.rarity);
    const publication = record(system.publication);
    const legacySource = record(system.source);
    const publicationSlug = slugify(nonEmpty(publication.title) ? publication.title : nonEmpty(legacySource.value) ? legacySource.value : "");
    const price = normalizePrice(system);
    const level = nonNegativeInteger(record(system.level).value);
    const reasons = [];
    if (itemType === "treasure") {
        reasons.push(reason("treasure-excluded", "Treasure is excluded from equipment acquisition."));
    }
    else if (CONTAINER_ITEM_TYPES.has(itemType)) {
        reasons.push(reason("container-or-kit-excluded", "Kits are not supported in this catalogue."));
    }
    else if (!PHYSICAL_ITEM_TYPES.has(itemType)) {
        reasons.push(reason("item-type-unsupported", `Item type ${itemType} is not supported for equipment acquisition.`));
    }
    if (price.kind === "missing")
        reasons.push(reason("price-missing", "This item has no indexed base Price."));
    if (price.kind === "unparseable") {
        reasons.push(reason("price-unparseable", "This item's indexed base Price cannot be parsed safely."));
    }
    if (level === null) {
        reasons.push(reason("level-unparseable", "This item's indexed level is missing or invalid."));
    }
    if (rarity === null) {
        reasons.push(reason("rarity-unparseable", "This item's indexed rarity is missing or invalid."));
    }
    if (!rulesValid) {
        reasons.push(reason("rules-unparseable", "This item's indexed rule-element list is missing or invalid."));
    }
    const interactiveKeys = ruleKeys.filter((key) => INTERACTIVE_RULE_KEYS.has(key) || key === "<unknown>");
    if (interactiveKeys.length > 0) {
        reasons.push(reason("interactive-rule-unsupported", `Interactive rule elements are not supported: ${interactiveKeys.join(", ")}.`));
    }
    const parsedUuid = parseCompendiumItemUuid(sourceUuid);
    if (parsedUuid.packId !== packId)
        throw new TypeError(`Equipment source ${sourceUuid} does not belong to ${packId}.`);
    const candidateMaterial = {
        sourceUuid,
        packId,
        documentId: parsedUuid.documentId,
        name: nonEmpty(value.name) ? value.name.trim() : "Unnamed equipment",
        img: nonEmpty(value.img) ? value.img.trim() : "",
        itemType,
        level: level ?? 0,
        rarity: rarity ?? "unique",
        publicationSlug,
        price,
        traits: Object.freeze(uniqueSorted(stringArray(traitsRoot.value).map((trait) => trait.toLowerCase()))),
        ruleKeys: Object.freeze(ruleKeys),
    };
    const candidate = Object.freeze({
        ...candidateMaterial,
        previewIdentity: fingerprint("equipment-preview-v1", candidateMaterial),
    });
    return Object.freeze({ candidate, reasons: Object.freeze(reasons) });
}
function normalizePrice(system) {
    if (!isRecord(system.price) || system.price.value === null || system.price.value === undefined) {
        return Object.freeze({ kind: "missing", value: null, copperValue: null, per: 1, sourceQuantity: 1 });
    }
    const price = record(system.price);
    const per = positiveInteger(price.per, 1);
    const sourceQuantity = positiveInteger(system.quantity, 1);
    const value = normalizeCoinValue(price.value);
    if (!value || per === null || sourceQuantity === null) {
        return Object.freeze({
            kind: "unparseable",
            value: null,
            copperValue: null,
            per: per ?? 1,
            sourceQuantity: sourceQuantity ?? 1,
        });
    }
    const copperValue = DENOMINATIONS.reduce((total, denomination) => {
        return total + (value[denomination] ?? 0) * COPPER_VALUE[denomination];
    }, 0);
    if (!Number.isSafeInteger(copperValue)) {
        return Object.freeze({ kind: "unparseable", value: null, copperValue: null, per, sourceQuantity });
    }
    return Object.freeze({ kind: "priced", value: Object.freeze(value), copperValue, per, sourceQuantity });
}
function normalizeCoinValue(raw) {
    if (typeof raw === "string")
        return parseCoinString(raw);
    if (!isRecord(raw))
        return null;
    const normalized = {};
    for (const [key, rawValue] of Object.entries(raw)) {
        if (rawValue === null || rawValue === undefined || rawValue === "")
            continue;
        if (!DENOMINATIONS.includes(key))
            return null;
        const value = Number(rawValue);
        if (!Number.isSafeInteger(value) || value < 0)
            return null;
        normalized[key] = value;
    }
    return normalized;
}
function parseCoinString(raw) {
    const text = raw.trim().toLowerCase();
    if (!text)
        return null;
    const normalized = {};
    const pattern = /(\d+)\s*(pp|gp|sp|cp)/g;
    let matched = false;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        matched = true;
        const denomination = match[2];
        const value = Number(match[1]);
        const total = (normalized[denomination] ?? 0) + value;
        if (!Number.isSafeInteger(total))
            return null;
        normalized[denomination] = total;
    }
    if (!matched || text.replace(pattern, "").replace(/[,+\s]/g, "") !== "")
        return null;
    return normalized;
}
function assertContext(context) {
    const actor = record(context.actor);
    if (!nonEmpty(actor.id) || actor.id !== context.policy.actorId) {
        throw new TypeError("Equipment catalogue actor does not match the effective policy subject.");
    }
    if (!nonEmpty(context.draft.draftId) ||
        context.draft.draftId !== context.policy.draftId ||
        context.draft.targetLevel !== context.policy.targetLevel ||
        context.draft.accessFactsFingerprint !==
            createEquipmentCatalogueDraftContext({
                draftId: context.draft.draftId,
                targetLevel: context.draft.targetLevel,
                version: context.draft.version,
                accessFacts: context.draft.accessFacts,
            }).accessFactsFingerprint) {
        throw new TypeError("Equipment catalogue draft does not match the effective policy subject.");
    }
}
function cloneAccessDraft(draft) {
    return createEquipmentCatalogueDraftContext({
        draftId: draft.draftId,
        targetLevel: draft.targetLevel,
        version: draft.version,
        accessFacts: draft.accessFacts,
    });
}
function rarityAtOrBelow(rarity, ceiling) {
    const order = ["common", "uncommon", "rare", "unique"];
    return order.indexOf(rarity) <= order.indexOf(ceiling);
}
function authorityReason(code) {
    if (code === "source-not-allowed") {
        return [reason("source-not-allowed", "This equipment source is not allowed by the current world policy.")];
    }
    if (code === "rarity-not-available") {
        return [
            reason("rarity-not-available", "This item's rarity is not available through policy or a registered character Access profile."),
        ];
    }
    return [];
}
function reason(code, message) {
    return Object.freeze({ code, message });
}
function dedupeReasons(reasons) {
    const byCode = new Map(reasons.map((entry) => [entry.code, entry]));
    return [...byCode.values()];
}
function stripEvaluation(entry) {
    return Object.freeze({
        sourceUuid: entry.sourceUuid,
        packId: entry.packId,
        documentId: entry.documentId,
        name: entry.name,
        img: entry.img,
        itemType: entry.itemType,
        level: entry.level,
        rarity: entry.rarity,
        publicationSlug: entry.publicationSlug,
        price: entry.price,
        traits: entry.traits,
        ruleKeys: entry.ruleKeys,
        previewIdentity: entry.previewIdentity,
    });
}
function extractDocumentSource(document) {
    if (!isRecord(document))
        throw new TypeError("Equipment document hydration returned malformed data.");
    const toObject = document.toObject;
    const raw = typeof toObject === "function"
        ? toObject.call(document, true)
        : isRecord(document._source)
            ? document._source
            : document;
    if (!isRecord(raw))
        throw new TypeError("Equipment document has no serializable source.");
    return cloneData(raw);
}
function parseCompendiumItemUuid(sourceUuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/.exec(sourceUuid);
    if (!match)
        throw new TypeError(`Equipment source UUID is not an exact Compendium Item UUID: ${sourceUuid}.`);
    return { packId: match[1], documentId: match[2] };
}
function documentIdFromUuid(raw, packId) {
    if (!nonEmpty(raw))
        return null;
    try {
        const parsed = parseCompendiumItemUuid(raw);
        return parsed.packId === packId ? parsed.documentId : null;
    }
    catch {
        return null;
    }
}
function equipmentRarity(raw) {
    return raw === "common" || raw === "uncommon" || raw === "rare" || raw === "unique" ? raw : null;
}
function positiveInteger(raw, fallback) {
    if (raw === null || raw === undefined)
        return fallback;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function nonNegativeInteger(raw) {
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function stringArray(raw) {
    return Array.isArray(raw) ? raw.filter((value) => nonEmpty(value)).map((value) => value.trim()) : [];
}
function slugify(raw) {
    return raw
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function normalizedSet(values) {
    return new Set((values ?? []).map((value) => normalizeSearchText(value)).filter(Boolean));
}
function tokenize(value) {
    return uniqueSorted(normalizeSearchText(value).split(/\s+/).filter(Boolean));
}
function normalizeSearchText(value) {
    return value.trim().toLowerCase();
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function compareEntries(left, right) {
    return (left.level - right.level || left.name.localeCompare(right.name) || left.sourceUuid.localeCompare(right.sourceUuid));
}
function fingerprint(prefix, value) {
    const text = canonicalJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object") {
        for (const nested of Object.values(value))
            deepFreeze(nested);
        Object.freeze(value);
    }
    return value;
}
function record(value) {
    return isRecord(value) ? value : {};
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
//# sourceMappingURL=equipment-catalogue-service.js.map