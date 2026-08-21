import { cloneData } from "../../shared/cloning.js";
import { CHARACTER_WEALTH_POLICY_REF } from "./character-wealth-policy.js";
import { SEMANTIC_WEALTH_POLICY } from "./semantic-wealth-policy.js";
import { SEMANTIC_WEALTH_POLICY_REF } from "./semantic-wealth-rule-ledger.js";
export const DEFAULT_EQUIPMENT_WORLD_POLICY = Object.freeze({
    version: 1,
    enabledRecipes: Object.freeze(["permanent-items", "lump-sum"]),
    defaultRecipe: "permanent-items",
    recipeChoiceAuthority: "actor-owner",
    higherLevelStartAuthority: "gm-confirmation",
    blanketRarity: "common",
    allowedEquipmentPackFamilies: Object.freeze(["pf2e"]),
    applyAuthority: "actor-owner",
    recipeDecision: Object.freeze({ version: 1 }),
});
export const EMPTY_EQUIPMENT_POLICY_JUDGMENT_STORE = Object.freeze({
    version: 1,
    judgments: Object.freeze([]),
});
export function normalizeEquipmentWorldPolicy(raw) {
    if (!isRecord(raw) || raw.version !== 1)
        return cloneWorldPolicy(DEFAULT_EQUIPMENT_WORLD_POLICY);
    const enabledRecipes = uniqueSorted(Array.isArray(raw.enabledRecipes)
        ? raw.enabledRecipes.filter((value) => isRecipe(value))
        : []);
    const recipes = enabledRecipes.length > 0 ? enabledRecipes : [...DEFAULT_EQUIPMENT_WORLD_POLICY.enabledRecipes];
    const defaultRecipe = isRecipe(raw.defaultRecipe) && recipes.includes(raw.defaultRecipe) ? raw.defaultRecipe : recipes[0];
    const families = uniqueSorted(Array.isArray(raw.allowedEquipmentPackFamilies)
        ? raw.allowedEquipmentPackFamilies.filter(nonEmpty).map((value) => value.trim().toLowerCase())
        : []);
    const recipeDecision = normalizeRecipeDecision(raw.recipeDecision);
    return {
        version: 1,
        enabledRecipes: recipes,
        defaultRecipe,
        recipeChoiceAuthority: isOneOf(raw.recipeChoiceAuthority, ["gm-fixed", "actor-owner"])
            ? raw.recipeChoiceAuthority
            : DEFAULT_EQUIPMENT_WORLD_POLICY.recipeChoiceAuthority,
        higherLevelStartAuthority: isOneOf(raw.higherLevelStartAuthority, ["gm-confirmation", "actor-owner-attestation"])
            ? raw.higherLevelStartAuthority
            : DEFAULT_EQUIPMENT_WORLD_POLICY.higherLevelStartAuthority,
        blanketRarity: isOneOf(raw.blanketRarity, ["common", "uncommon", "rare", "unique"])
            ? raw.blanketRarity
            : DEFAULT_EQUIPMENT_WORLD_POLICY.blanketRarity,
        allowedEquipmentPackFamilies: families.length > 0 ? families : [...DEFAULT_EQUIPMENT_WORLD_POLICY.allowedEquipmentPackFamilies],
        applyAuthority: isOneOf(raw.applyAuthority, ["actor-owner", "gm-review"])
            ? raw.applyAuthority
            : DEFAULT_EQUIPMENT_WORLD_POLICY.applyAuthority,
        recipeDecision,
    };
}
function normalizeRecipeDecision(raw) {
    if (!isRecord(raw) || raw.version !== 1) {
        return { version: 1 };
    }
    if (raw.configuredBy == null && raw.configuredAt == null) {
        return { version: 1 };
    }
    if (isRecord(raw.configuredBy) &&
        nonEmpty(raw.configuredBy.userId) &&
        nonEmpty(raw.configuredBy.userName) &&
        nonEmpty(raw.configuredAt) &&
        Number.isFinite(Date.parse(raw.configuredAt))) {
        return {
            version: 1,
            configuredBy: { userId: raw.configuredBy.userId, userName: raw.configuredBy.userName },
            configuredAt: raw.configuredAt,
        };
    }
    return { version: 1 };
}
export function normalizeEquipmentPolicyJudgmentStore(raw) {
    if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.judgments))
        return { version: 1, judgments: [] };
    const judgments = raw.judgments.flatMap((value) => {
        const judgment = normalizeEquipmentPolicyJudgment(value);
        return judgment ? [judgment] : [];
    });
    if (judgments.length !== raw.judgments.length ||
        new Set(judgments.map((value) => value.id)).size !== judgments.length) {
        return { version: 1, judgments: [] };
    }
    return { version: 1, judgments: judgments.sort((left, right) => left.id.localeCompare(right.id)) };
}
export function normalizeEquipmentPolicyJudgment(raw) {
    if (!isRecord(raw) ||
        !nonEmpty(raw.id) ||
        !isJudgmentKind(raw.kind) ||
        !nonEmpty(raw.actorId) ||
        !nonEmpty(raw.draftId) ||
        !validTargetLevel(raw.targetLevel) ||
        !nonEmpty(raw.factsFingerprint) ||
        !nonEmpty(raw.authorUserId) ||
        !nonEmpty(raw.authorName) ||
        !validTimestamp(raw.recordedAt) ||
        !nonEmpty(raw.reason) ||
        !isRecord(raw.request)) {
        return null;
    }
    const request = normalizeEquipmentPolicyRequest({
        version: 1,
        requestId: raw.request.requestId,
        facts: raw.request.facts,
        factsFingerprint: raw.factsFingerprint,
        requesterUserId: raw.request.requesterUserId,
        requesterName: raw.request.requesterName,
        requestedAt: raw.request.requestedAt,
        reason: raw.request.reason,
        withdrawnAt: null,
    });
    const revocation = raw.revocation === null
        ? null
        : isRecord(raw.revocation) &&
            nonEmpty(raw.revocation.revokedByUserId) &&
            nonEmpty(raw.revocation.revokedByName) &&
            validTimestamp(raw.revocation.revokedAt) &&
            nonEmpty(raw.revocation.reason)
            ? {
                revokedByUserId: raw.revocation.revokedByUserId,
                revokedByName: raw.revocation.revokedByName,
                revokedAt: raw.revocation.revokedAt,
                reason: raw.revocation.reason.trim(),
            }
            : undefined;
    if (!request ||
        revocation === undefined ||
        request.facts.kind !== raw.kind ||
        request.facts.actorId !== raw.actorId ||
        request.facts.draftId !== raw.draftId ||
        request.facts.targetLevel !== raw.targetLevel ||
        canonicalJson(request.facts) !== canonicalJson(raw.request.facts)) {
        return null;
    }
    return {
        id: raw.id,
        kind: raw.kind,
        actorId: raw.actorId,
        draftId: raw.draftId,
        targetLevel: raw.targetLevel,
        factsFingerprint: raw.factsFingerprint,
        authorUserId: raw.authorUserId,
        authorName: raw.authorName,
        recordedAt: raw.recordedAt,
        reason: raw.reason.trim(),
        request: {
            requestId: request.requestId,
            requesterUserId: request.requesterUserId,
            requesterName: request.requesterName,
            requestedAt: request.requestedAt,
            reason: request.reason,
            facts: cloneData(request.facts),
        },
        revocation,
    };
}
export function createEquipmentPolicyRequest(input) {
    validateJudgmentFacts(input.facts);
    if (!nonEmpty(input.requestId) ||
        !nonEmpty(input.requesterUserId) ||
        !nonEmpty(input.requesterName) ||
        !validTimestamp(input.requestedAt) ||
        !nonEmpty(input.reason)) {
        throw new TypeError("Equipment policy request identity, requester, time, and reason are required.");
    }
    return {
        version: 1,
        requestId: input.requestId,
        facts: cloneData(input.facts),
        factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(input.facts),
        requesterUserId: input.requesterUserId,
        requesterName: input.requesterName,
        requestedAt: input.requestedAt,
        reason: input.reason.trim(),
        withdrawnAt: null,
    };
}
export function normalizeEquipmentPolicyRequest(raw) {
    if (!isRecord(raw) ||
        raw.version !== 1 ||
        !nonEmpty(raw.requestId) ||
        !isRecord(raw.facts) ||
        !nonEmpty(raw.factsFingerprint) ||
        !nonEmpty(raw.requesterUserId) ||
        !nonEmpty(raw.requesterName) ||
        !validTimestamp(raw.requestedAt) ||
        !nonEmpty(raw.reason) ||
        (raw.withdrawnAt !== null && !validTimestamp(raw.withdrawnAt))) {
        return null;
    }
    try {
        const facts = cloneData(raw.facts);
        validateJudgmentFacts(facts);
        if (buildEquipmentPolicyJudgmentFactsFingerprint(facts) !== raw.factsFingerprint)
            return null;
        return {
            version: 1,
            requestId: raw.requestId,
            facts,
            factsFingerprint: raw.factsFingerprint,
            requesterUserId: raw.requesterUserId,
            requesterName: raw.requesterName,
            requestedAt: raw.requestedAt,
            reason: raw.reason.trim(),
            withdrawnAt: raw.withdrawnAt,
        };
    }
    catch {
        return null;
    }
}
export function withdrawEquipmentPolicyRequest(request, withdrawnAt) {
    if (!validTimestamp(withdrawnAt))
        throw new TypeError("Equipment request withdrawal requires a valid timestamp.");
    return request.withdrawnAt ? request : { ...request, withdrawnAt };
}
export function createEquipmentPolicyResolver(authority) {
    return { resolve: (input) => resolveEffectiveEquipmentPolicy(input, authority) };
}
export function buildEquipmentPolicyJudgmentFactsFingerprint(facts) {
    validateJudgmentFacts(facts);
    return fingerprint({ version: 1, ...facts });
}
export function equipmentPolicyJudgmentFactsEqual(left, right) {
    validateJudgmentFacts(left);
    validateJudgmentFacts(right);
    return canonicalJson(left) === canonicalJson(right);
}
export function evaluateEquipmentItemAuthority(input) {
    return evaluateEquipmentItemAuthorityFacts({ ...input, policy: input.policy });
}
export function resolveEquipmentItemExceptionJudgmentIds(input) {
    const matching = (requestedScope) => [...input.policy.gmJudgments]
        .sort((left, right) => left.id.localeCompare(right.id))
        .find((judgment) => hasMatchingItemException(input, judgment.id, requestedScope))?.id ?? null;
    return {
        sourceExceptionJudgmentId: matching("source"),
        rarityExceptionJudgmentId: matching("rarity"),
    };
}
export function evaluateEquipmentItemAuthorityFacts(input) {
    const packAllowed = input.policy.sourcePolicy.effectivePackIds.includes(input.packId);
    const sourceVisible = sourceEnabled(input.policy.sourcePolicy, input.publicationSlug);
    const authority = SEMANTIC_WEALTH_POLICY.evaluateEquipmentAuthority({
        sourceAllowed: packAllowed && sourceVisible,
        rarity: input.rarity,
        blanketRarities: raritiesThrough(input.policy.rarityPolicy.blanketCeiling),
        hasCharacterAccess: input.hasCharacterAccess,
        approvedSourceException: hasMatchingItemException(input, input.sourceExceptionJudgmentId, "source"),
        approvedRarityException: hasMatchingItemException(input, input.rarityExceptionJudgmentId, "rarity"),
    });
    return { eligible: authority.ok, reasons: authority.diagnostics.map((entry) => entry.code) };
}
export function compareEffectiveEquipmentPolicyMaterial(reviewed, current, selectedItems = []) {
    const reasons = new Set();
    if (reviewed.actorId !== current.actorId || reviewed.draftId !== current.draftId)
        reasons.add("subject");
    if (reviewed.targetLevel !== current.targetLevel)
        reasons.add("target-level");
    if (!same(reviewed.rules, current.rules))
        reasons.add("rules");
    if (!same(reviewed.recipe, current.recipe))
        reasons.add("recipe");
    if (!same(reviewed.authorityPolicy, current.authorityPolicy))
        reasons.add("authority");
    if (!same(reviewed.higherLevelStartEvidence, current.higherLevelStartEvidence))
        reasons.add("start-authority");
    if (!same(reviewed.rarityPolicy, current.rarityPolicy))
        reasons.add("rarity");
    if (!same(reviewed.abp, current.abp))
        reasons.add("abp");
    if (!same(reviewed.gmJudgments, current.gmJudgments))
        reasons.add("judgments");
    for (const item of selectedItems) {
        const reviewedAllowed = reviewed.sourcePolicy.effectivePackIds.includes(item.packId) &&
            sourceEnabled(reviewed.sourcePolicy, item.publicationSlug);
        const currentAllowed = current.sourcePolicy.effectivePackIds.includes(item.packId) &&
            sourceEnabled(current.sourcePolicy, item.publicationSlug);
        if (reviewedAllowed !== currentAllowed)
            reasons.add("selected-source");
    }
    return [...reasons].sort();
}
function resolveEffectiveEquipmentPolicy(input, authority) {
    if (!nonEmpty(input.actorId) || !nonEmpty(input.draftId))
        throw new TypeError("Equipment policy subject is invalid.");
    if (!validTargetLevel(input.targetLevel))
        throw new RangeError("Equipment policy target level must be 1 through 20.");
    const world = normalizeEquipmentWorldPolicy(input.worldPolicy);
    const officialRecipe = resolveRecipeChoice(world, input.selectedRecipe, input.targetLevel);
    const official = SEMANTIC_WEALTH_POLICY.resolveOfficialStartingWealth({
        characterLevel: input.targetLevel,
        partySize: 1,
        recipe: officialRecipe,
    });
    if (!official.ok || !official.value)
        throw new Error(official.diagnostics[0]?.message ?? "Starting wealth unavailable.");
    const higherLevelStartEvidence = resolveStartEvidence(input, world, authority);
    const exceptionJudgments = resolveJudgments(input.exceptionJudgmentIds ?? [], "rarity-source-exception", input, authority);
    const extraJudgments = resolveJudgments(input.extraCurrentLevelAllowanceIds ?? [], "extra-current-level-allowance", input, authority, (judgment) => judgment.factsFingerprint ===
        buildEquipmentPolicyJudgmentFactsFingerprint({
            kind: "extra-current-level-allowance",
            actorId: input.actorId,
            draftId: input.draftId,
            targetLevel: input.targetLevel,
        }));
    if (extraJudgments.length > 1) {
        throw new TypeError("Only one extra current-level permanent-item allowance can be approved per draft.");
    }
    if (extraJudgments.length > 0 && (officialRecipe !== "permanent-items" || input.targetLevel === 1)) {
        throw new TypeError("An extra current-level allowance requires the higher-level permanent-items recipe.");
    }
    if (input.customLumpSum && extraJudgments.length > 0) {
        throw new TypeError("A custom lump sum cannot also receive a permanent-item allowance.");
    }
    let recipe;
    let customJudgment = null;
    if (input.customLumpSum) {
        if (officialRecipe !== "lump-sum" || !world.enabledRecipes.includes("lump-sum")) {
            throw new TypeError("A custom lump sum requires the effective official lump-sum recipe.");
        }
        if (!safeNonNegativeInteger(input.customLumpSum.amountCopper))
            throw new TypeError("Custom lump sum is invalid.");
        customJudgment = resolveJudgment(input.customLumpSum.judgmentId, "custom-lump-sum", input, authority, (judgment) => judgment.factsFingerprint ===
            buildEquipmentPolicyJudgmentFactsFingerprint({
                kind: "custom-lump-sum",
                actorId: input.actorId,
                draftId: input.draftId,
                targetLevel: input.targetLevel,
                amountCopper: input.customLumpSum.amountCopper,
            }));
        recipe = {
            kind: "custom-lump-sum",
            budgetCopper: input.customLumpSum.amountCopper,
            maxItemLevel: input.targetLevel - 1,
            judgment: cloneData(customJudgment),
        };
    }
    else if (input.targetLevel === 1) {
        recipe = { kind: "level-1-equivalent", budgetCopper: 1500 };
    }
    else if (officialRecipe === "permanent-items") {
        const allowances = expandAllowances(official.value.permanentItemAllowances);
        for (const judgment of extraJudgments) {
            allowances.push({ allowanceId: `gm-extra:${judgment.id}`, itemLevel: input.targetLevel });
        }
        recipe = {
            kind: "permanent-items",
            currencyCopper: official.value.currencyCopper,
            allowances: allowances.sort((left, right) => left.itemLevel - right.itemLevel || left.allowanceId.localeCompare(right.allowanceId)),
        };
    }
    else {
        recipe = { kind: "lump-sum", budgetCopper: official.value.currencyCopper, maxItemLevel: input.targetLevel - 1 };
    }
    const gmJudgments = uniqueJudgments([
        ...(higherLevelStartEvidence.kind === "gm-confirmation" ? [higherLevelStartEvidence.judgment] : []),
        ...(customJudgment ? [customJudgment] : []),
        ...extraJudgments,
        ...exceptionJudgments,
    ]);
    const material = {
        version: 1,
        actorId: input.actorId,
        draftId: input.draftId,
        targetLevel: input.targetLevel,
        rules: { wealth: CHARACTER_WEALTH_POLICY_REF, semantics: SEMANTIC_WEALTH_POLICY_REF },
        recipe,
        worldRecipePolicy: { enabledRecipes: [...world.enabledRecipes], defaultRecipe: world.defaultRecipe },
        sourcePolicy: {
            configuredPackFamilies: uniqueSorted([...world.allowedEquipmentPackFamilies]),
            effectivePackIds: uniqueSorted([...input.effectivePackIds]),
            enabledSourceSlugs: uniqueSorted([...input.enabledSourceSlugs]),
            knownSourceSlugs: uniqueSorted([...input.knownSourceSlugs]),
            showEmptySources: input.showEmptySources,
            showUnknownSources: input.showUnknownSources,
        },
        rarityPolicy: { blanketCeiling: world.blanketRarity },
        authorityPolicy: {
            recipeChoice: world.recipeChoiceAuthority,
            higherLevelStart: world.higherLevelStartAuthority,
            apply: world.applyAuthority,
        },
        higherLevelStartEvidence,
        abp: cloneData(input.abp),
        gmJudgments,
    };
    return { ...material, fingerprint: fingerprint(material), explanations: buildExplanations(world, recipe) };
}
function resolveStartEvidence(input, world, authority) {
    if (input.targetLevel === 1)
        return { kind: "not-required" };
    const claim = input.higherLevelStartClaim;
    if (world.higherLevelStartAuthority === "gm-confirmation") {
        if (!claim || claim.kind !== "gm-confirmation") {
            throw new TypeError("A trusted GM confirmation is required for this higher-level start.");
        }
        const expected = buildEquipmentPolicyJudgmentFactsFingerprint({
            kind: "higher-level-start",
            actorId: input.actorId,
            draftId: input.draftId,
            targetLevel: input.targetLevel,
            startKind: claim.startKind,
        });
        const judgment = resolveJudgment(claim.judgmentId, "higher-level-start", input, authority, (candidate) => candidate.factsFingerprint === expected);
        return { kind: "gm-confirmation", startKind: claim.startKind, judgment };
    }
    if (!claim ||
        claim.kind !== "actor-owner-attestation" ||
        !isOneOf(claim.startKind, ["new-campaign", "replacement-character"]) ||
        claim.actorId !== input.actorId ||
        claim.draftId !== input.draftId ||
        claim.targetLevel !== input.targetLevel ||
        !nonEmpty(claim.authorUserId) ||
        !nonEmpty(claim.authorName) ||
        !validTimestamp(claim.recordedAt) ||
        !nonEmpty(claim.reason) ||
        !authority.verifyOwnerStartAttestation(claim)) {
        throw new TypeError("A current actor-owner attestation is required for this higher-level start.");
    }
    return cloneData(claim);
}
function resolveJudgments(ids, kind, input, authority, predicate = () => true) {
    const uniqueIds = uniqueSorted(ids.filter(nonEmpty));
    if (uniqueIds.length !== ids.length)
        throw new TypeError(`Trusted ${kind} judgment IDs must be unique.`);
    return uniqueIds.map((id) => resolveJudgment(id, kind, input, authority, predicate));
}
function resolveJudgment(id, kind, input, authority, predicate = () => true) {
    const judgment = nonEmpty(id) ? normalizeEquipmentPolicyJudgment(authority.resolveGmJudgment(id)) : null;
    if (!judgment ||
        judgment.kind !== kind ||
        judgment.actorId !== input.actorId ||
        judgment.draftId !== input.draftId ||
        judgment.targetLevel !== input.targetLevel ||
        judgment.revocation !== null ||
        !predicate(judgment)) {
        throw new TypeError(`A trusted ${kind} judgment bound to the current facts is required.`);
    }
    return judgment;
}
function hasMatchingItemException(input, judgmentId, requestedScope) {
    if (!nonEmpty(judgmentId))
        return false;
    const judgment = input.policy.gmJudgments.find((candidate) => candidate.id === judgmentId);
    if (!judgment || judgment.kind !== "rarity-source-exception")
        return false;
    return [requestedScope, "source-and-rarity"].some((scope) => judgment.factsFingerprint ===
        buildEquipmentPolicyJudgmentFactsFingerprint({
            kind: "rarity-source-exception",
            actorId: input.policy.actorId,
            draftId: input.policy.draftId,
            targetLevel: input.policy.targetLevel,
            scope: scope,
            sourceUuid: input.sourceUuid,
            packId: input.packId,
            publicationSlug: input.publicationSlug,
            rarity: input.rarity,
        }));
}
function sourceEnabled(policy, slug) {
    if (policy.enabledSourceSlugs.length === 0)
        return true;
    if (slug === "")
        return policy.showEmptySources;
    if (slug === null || !policy.knownSourceSlugs.includes(slug)) {
        return policy.showUnknownSources;
    }
    return policy.enabledSourceSlugs.includes(slug);
}
function resolveRecipeChoice(world, selected, targetLevel) {
    if (targetLevel === 1)
        return world.defaultRecipe;
    if (world.recipeChoiceAuthority === "actor-owner" && selected && world.enabledRecipes.includes(selected)) {
        return selected;
    }
    return world.defaultRecipe;
}
function expandAllowances(entries) {
    return entries.flatMap((entry) => Array.from({ length: entry.count }, (_, index) => ({
        allowanceId: `level-${entry.itemLevel}-${index + 1}`,
        itemLevel: entry.itemLevel,
    })));
}
function buildExplanations(world, recipe) {
    return [
        recipe.kind === "level-1-equivalent"
            ? "Both official recipes resolve to 15 gp at level 1."
            : `Resolved ${recipe.kind} under the world recipe policy.`,
        `Blanket item rarity is ${world.blanketRarity} within approved equipment sources.`,
        world.higherLevelStartAuthority === "gm-confirmation"
            ? "Higher-level starts require a current GM confirmation."
            : "The world delegates higher-level start attestations to actor owners.",
    ];
}
function validateJudgmentFacts(facts) {
    if (!nonEmpty(facts.actorId) || !nonEmpty(facts.draftId) || !validTargetLevel(facts.targetLevel)) {
        throw new TypeError("Equipment judgment subject facts are invalid.");
    }
    if (facts.kind === "higher-level-start" && !isOneOf(facts.startKind, ["new-campaign", "replacement-character"])) {
        throw new TypeError("Higher-level start judgment facts are invalid.");
    }
    if (facts.kind === "custom-lump-sum" && !safeNonNegativeInteger(facts.amountCopper)) {
        throw new TypeError("Custom lump-sum judgment facts are invalid.");
    }
    if (facts.kind === "rarity-source-exception" &&
        (!nonEmpty(facts.sourceUuid) ||
            !nonEmpty(facts.packId) ||
            !isOneOf(facts.scope, ["source", "rarity", "source-and-rarity"]) ||
            (facts.publicationSlug !== null && typeof facts.publicationSlug !== "string") ||
            !isRarity(facts.rarity))) {
        throw new TypeError("Equipment exception facts are invalid.");
    }
}
function raritiesThrough(ceiling) {
    const order = ["common", "uncommon", "rare", "unique"];
    return order.slice(0, order.indexOf(ceiling) + 1);
}
function uniqueJudgments(values) {
    const byId = new Map(values.map((value) => [value.id, cloneData(value)]));
    if (byId.size !== values.length)
        throw new TypeError("Equipment judgment IDs must be unique.");
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
function cloneWorldPolicy(value) {
    return {
        ...cloneData(value),
        enabledRecipes: [...value.enabledRecipes],
        allowedEquipmentPackFamilies: [...value.allowedEquipmentPackFamilies],
    };
}
function fingerprint(value) {
    const text = canonicalJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `equipment-policy-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
    return JSON.stringify(value);
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function isRecipe(value) {
    return value === "permanent-items" || value === "lump-sum";
}
function isJudgmentKind(value) {
    return isOneOf(value, [
        "higher-level-start",
        "custom-lump-sum",
        "extra-current-level-allowance",
        "rarity-source-exception",
    ]);
}
function isRarity(value) {
    return isOneOf(value, ["common", "uncommon", "rare", "unique"]);
}
function validTargetLevel(value) {
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}
function validTimestamp(value) {
    return nonEmpty(value) && Number.isFinite(Date.parse(value));
}
function safeNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOneOf(value, values) {
    return typeof value === "string" && values.includes(value);
}
function same(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}
//# sourceMappingURL=equipment-policy.js.map