import { MODULE_ID, SETTINGS } from "../../constants.js";
import { assertCanUseWayfinder } from "../../permissions.js";
import { getEquipmentPolicyJudgmentStoreSetting, getEquipmentWorldPolicySetting } from "../../settings.js";
import { buildEquipmentPolicyJudgmentFactsFingerprint, createEquipmentPolicyResolver, normalizeEquipmentWorldPolicy, } from "../domain/equipment-policy.js";
import { requireCurrentGmPrincipal } from "./gm-command-authority.js";
export function normalizePf2eEquipmentSources(input) {
    const packRoot = record(input.compendiumBrowserPacks);
    const equipment = record(packRoot.equipment);
    const families = new Set(input.allowedPackFamilies.map((value) => value.trim().toLowerCase()));
    const effectivePackIds = [...new Set(input.availablePackIds)]
        .filter((packId) => families.has(packFamily(packId)))
        .filter((packId) => record(equipment[packId]).load !== false)
        .sort((left, right) => left.localeCompare(right));
    const sourceRoot = record(input.compendiumBrowserSources);
    const sources = record(sourceRoot.sources);
    const knownSourceSlugs = Object.keys(sources).sort((left, right) => left.localeCompare(right));
    const enabledSourceSlugs = Object.entries(sources)
        .filter(([, value]) => record(value).load !== false)
        .map(([slug]) => slug)
        .sort((left, right) => left.localeCompare(right));
    return {
        effectivePackIds,
        enabledSourceSlugs,
        knownSourceSlugs,
        showEmptySources: sourceRoot.showEmptySources === true,
        showUnknownSources: sourceRoot.showUnknownSources === true,
    };
}
export function resolveActorAbpSnapshot(actor, pf2e = game.pf2e) {
    const system = record(pf2e);
    const settings = record(record(system.settings).variants);
    const mode = typeof settings.abp === "string" ? settings.abp : null;
    const variantRules = record(system.variantRules);
    const abp = record(variantRules.AutomaticBonusProgression);
    const isEnabled = abp.isEnabled;
    const enabled = typeof isEnabled === "function"
        ? isEnabled(actor) === true
        : mode !== null && mode !== "noABP";
    const actorRecord = record(actor);
    const flags = record(record(actorRecord.flags).pf2e);
    return { enabled, mode, actorOverrideDisabled: flags.disableABP === true };
}
export function resolveEquipmentPolicyForActor(input) {
    const actorId = actorIdentity(input.actor);
    const worldPolicy = getEquipmentWorldPolicySetting();
    const sources = normalizePf2eEquipmentSources({
        availablePackIds: input.availableEquipmentPackIds ?? discoverItemPackIds(),
        allowedPackFamilies: worldPolicy.allowedEquipmentPackFamilies,
        compendiumBrowserPacks: game.settings.get("pf2e", "compendiumBrowserPacks"),
        compendiumBrowserSources: game.settings.get("pf2e", "compendiumBrowserSources"),
    });
    const store = getEquipmentPolicyJudgmentStoreSetting();
    const byId = new Map(store.judgments.map((judgment) => [judgment.id, judgment]));
    const resolver = createEquipmentPolicyResolver({
        resolveGmJudgment: (id) => byId.get(id) ?? null,
        verifyOwnerStartAttestation: (attestation) => verifyCurrentOwnerAttestation(input.actor, attestation),
    });
    return resolver.resolve({
        actorId,
        draftId: input.draftId,
        targetLevel: input.targetLevel,
        worldPolicy,
        selectedRecipe: input.selectedRecipe,
        ...sources,
        abp: resolveActorAbpSnapshot(input.actor),
        higherLevelStartClaim: input.higherLevelStartClaim,
        customLumpSum: input.customLumpSum,
        extraCurrentLevelAllowanceIds: input.extraCurrentLevelAllowanceIds,
        exceptionJudgmentIds: input.exceptionJudgmentIds,
    });
}
export function assertEquipmentApplyAuthority(input) {
    const policy = input.acquisition.policySnapshot?.material;
    if (!policy ||
        policy.subject.actorId !== actorIdentity(input.actor) ||
        policy.subject.draftId !== input.acquisition.draftId ||
        policy.subject.targetLevel !== input.acquisition.targetLevel) {
        throw new TypeError("Starting-equipment Apply authority does not match the current actor and draft.");
    }
    const currentApplyAuthority = getEquipmentWorldPolicySetting().applyAuthority;
    if (policy.authorityPolicy.apply !== currentApplyAuthority) {
        throw new TypeError("Starting-equipment Apply authority changed after this draft was reviewed.");
    }
    if (policy.authorityPolicy.apply === "gm-review") {
        requireCurrentGmPrincipal(input.user ?? game.user);
        return;
    }
    assertCanUseWayfinder(input.actor);
}
export async function saveEquipmentWorldPolicy(raw, user = game.user) {
    requireCurrentGmPrincipal(user);
    const normalized = normalizeEquipmentWorldPolicy(raw);
    await game.settings.set(MODULE_ID, SETTINGS.equipmentPolicy, normalized);
    return normalized;
}
export async function saveTrustedEquipmentPolicyJudgment(input) {
    const user = record(input.user ?? game.user);
    const principal = requireCurrentGmPrincipal(user);
    if (!nonEmpty(input.id) || !nonEmpty(input.reason) || !validTimestamp(input.recordedAt)) {
        throw new TypeError("Equipment judgment identity, time, and reason are required.");
    }
    const judgment = {
        id: input.id,
        kind: input.facts.kind,
        actorId: input.facts.actorId,
        draftId: input.facts.draftId,
        targetLevel: input.facts.targetLevel,
        factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(input.facts),
        authorUserId: principal.userId,
        authorName: nonEmpty(user.name) ? user.name : principal.userId,
        recordedAt: input.recordedAt,
        reason: input.reason.trim(),
    };
    const current = getEquipmentPolicyJudgmentStoreSetting();
    const existing = current.judgments.find((candidate) => candidate.id === judgment.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(judgment)) {
        throw new TypeError("Equipment judgment ID already belongs to different facts.");
    }
    if (!existing) {
        await game.settings.set(MODULE_ID, SETTINGS.equipmentPolicyJudgments, {
            version: 1,
            judgments: [...current.judgments, judgment].sort((left, right) => left.id.localeCompare(right.id)),
        });
    }
    return judgment;
}
export function createOwnerStartAttestation(input) {
    assertCanUseWayfinder(input.actor);
    const user = record(input.user ?? game.user);
    if (!nonEmpty(user.id) ||
        !nonEmpty(input.draftId) ||
        !Number.isSafeInteger(input.targetLevel) ||
        input.targetLevel < 2 ||
        input.targetLevel > 20 ||
        !["new-campaign", "replacement-character"].includes(input.startKind) ||
        !nonEmpty(input.reason) ||
        !validTimestamp(input.recordedAt)) {
        throw new TypeError("Owner start attestation facts, time, and reason are required.");
    }
    return {
        kind: "actor-owner-attestation",
        startKind: input.startKind,
        actorId: actorIdentity(input.actor),
        draftId: input.draftId,
        targetLevel: input.targetLevel,
        authorUserId: user.id,
        authorName: nonEmpty(user.name) ? user.name : user.id,
        recordedAt: input.recordedAt,
        reason: input.reason.trim(),
    };
}
function verifyCurrentOwnerAttestation(actor, attestation) {
    const user = record(game.user);
    if (!nonEmpty(user.id) || attestation.actorId !== actorIdentity(actor))
        return false;
    if (attestation.authorUserId === user.id) {
        try {
            assertCanUseWayfinder(actor);
            return true;
        }
        catch {
            return false;
        }
    }
    if (user.isGM !== true)
        return false;
    const users = game.users;
    const author = typeof users?.get === "function" ? users.get(attestation.authorUserId) : null;
    const actorRecord = record(actor);
    const testUserPermission = actorRecord.testUserPermission;
    const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    return (author != null &&
        typeof testUserPermission === "function" &&
        testUserPermission.call(actor, author, ownerLevel) === true);
}
function actorIdentity(actor) {
    const id = record(actor).id;
    if (!nonEmpty(id))
        throw new TypeError("Equipment policy requires a bound actor ID.");
    return id;
}
function discoverItemPackIds() {
    const packs = game.packs;
    const values = typeof packs?.values === "function" ? [...packs.values()] : Array.isArray(packs) ? packs : [];
    return values
        .filter((pack) => record(record(pack).metadata).type === "Item" || record(pack).documentName === "Item")
        .map((pack) => {
        const normalized = record(pack);
        return String(normalized.collection ?? record(normalized.metadata).id ?? "");
    })
        .filter(nonEmpty);
}
function packFamily(packId) {
    return (packId.split(".")[0] ?? packId).trim().toLowerCase();
}
function validTimestamp(value) {
    return nonEmpty(value) && Number.isFinite(Date.parse(value));
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
//# sourceMappingURL=equipment-policy-service.js.map