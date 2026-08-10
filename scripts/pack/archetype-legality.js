import { resolvePackFamilyId } from "./access.js";
import { extractEntrySlug, extractEntryTraits, stringOrNull } from "./entry.js";
import { matchesCurrentClassMulticlassDedication } from "./predicates.js";
export function matchesArchetypeLegality(entry, packId, context, matchesSkillRankPrerequisites) {
    const traits = extractEntryTraits(entry);
    const isDedication = traits.includes("dedication");
    const projected = context.projectedArchetypeFeats;
    if (isDedication && matchesCurrentClassMulticlassDedication(entry, null, context)) {
        return false;
    }
    if (!matchesSkillRankPrerequisites(entry, context)) {
        return false;
    }
    if (!projected) {
        return isDedication ? !context.hasDedicationFeat : context.hasDedicationFeat;
    }
    const candidate = projectedArchetypeFeat(entry, packId);
    const dedications = projected.filter((feat) => feat.traits.includes("dedication"));
    if (isDedication) {
        if (dedications.some((dedication) => isDuplicateDedication(candidate, dedication))) {
            return false;
        }
        if (dedications.some((dedication) => blocksDedication(dedication, candidate, projected))) {
            return false;
        }
        return true;
    }
    if (dedications.length === 0) {
        return false;
    }
    if (candidate.familyIds.length === 0 || dedications.some((dedication) => dedication.familyIds.length === 0)) {
        return true;
    }
    return dedications.some((dedication) => sharesArchetypeFamily(candidate, dedication));
}
export function projectedArchetypeFeat(document, packId, fallback = {}) {
    const entry = document;
    const name = stringOrNull(entry?.name) ?? fallback.name ?? "Unknown Feat";
    const slug = extractEntrySlug(entry) ?? fallback.slug ?? null;
    const traits = extractEntryTraits(entry ?? {});
    const familyIds = resolveArchetypeFamilyIds(entry, packId, name, slug, traits);
    return {
        uuid: fallback.uuid ?? null,
        name,
        slug,
        traits,
        familyIds,
        ...resolveDedicationLockout(entry, traits, familyIds),
    };
}
export function mergeActorAndDraftArchetypeFeats(actorFeats, draftedFeats) {
    const remainingActorOccurrences = new Map();
    for (const feat of actorFeats) {
        const key = projectedIdentityKey(feat);
        if (key) {
            remainingActorOccurrences.set(key, (remainingActorOccurrences.get(key) ?? 0) + 1);
        }
    }
    return [
        ...actorFeats,
        ...draftedFeats.filter((feat) => {
            const key = projectedIdentityKey(feat);
            const remaining = key ? (remainingActorOccurrences.get(key) ?? 0) : 0;
            if (!key || remaining === 0) {
                return true;
            }
            remainingActorOccurrences.set(key, remaining - 1);
            return false;
        }),
    ];
}
function resolveArchetypeFamilyIds(entry, packId, name, slug, traits) {
    const familyIds = new Set();
    const folderFamilyId = packId && entry ? resolvePackFamilyId(packId, entry.folder) : null;
    if (folderFamilyId) {
        familyIds.add(folderFamilyId);
    }
    if (traits.includes("dedication")) {
        const familyId = dedicationFamilyId(slug ?? name);
        if (familyId) {
            familyIds.add(familyId);
        }
    }
    for (const prerequisite of extractPrerequisiteText(entry)) {
        if (/^[\p{L}\p{N}'’ -]+ dedication$/iu.test(prerequisite.trim())) {
            const familyId = dedicationFamilyId(prerequisite);
            if (familyId) {
                familyIds.add(familyId);
            }
        }
    }
    return Array.from(familyIds);
}
function dedicationFamilyId(value) {
    const family = value
        .trim()
        .toLowerCase()
        .replace(/(?:-| )dedication$/u, "")
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return family ? `dedication:${family}` : null;
}
function isDuplicateDedication(candidate, projected) {
    if (candidate.uuid && projected.uuid && normalize(candidate.uuid) === normalize(projected.uuid)) {
        return true;
    }
    if (candidate.slug && projected.slug && normalize(candidate.slug) === normalize(projected.slug)) {
        return true;
    }
    return false;
}
function blocksDedication(dedication, candidate, projected) {
    const lockout = dedication.dedicationLockout;
    if (!lockout) {
        return false;
    }
    if (lockout.allowedDedicationFamilyIds.some((familyId) => candidate.familyIds.includes(familyId))) {
        return false;
    }
    if (dedication.unresolvedLockoutException === "follow-up-qualification") {
        return true;
    }
    const countingFamilyIds = expandedCountingFamilyIds(lockout.countingFamilyIds, projected);
    const followUpCount = projected.filter((feat) => !feat.traits.includes("dedication") && feat.familyIds.some((familyId) => countingFamilyIds.has(familyId))).length;
    return followUpCount < lockout.requiredFollowUpCount;
}
function expandedCountingFamilyIds(familyIds, projected) {
    const expanded = new Set(familyIds);
    let changed = true;
    while (changed) {
        changed = false;
        for (const dedication of projected.filter((feat) => feat.traits.includes("dedication"))) {
            if (!dedication.familyIds.some((familyId) => expanded.has(familyId))) {
                continue;
            }
            for (const familyId of dedication.familyIds) {
                if (!expanded.has(familyId)) {
                    expanded.add(familyId);
                    changed = true;
                }
            }
        }
    }
    return expanded;
}
function sharesArchetypeFamily(left, right) {
    const rightFamilies = new Set(right.familyIds);
    return left.familyIds.some((familyId) => rightFamilies.has(familyId));
}
function resolveDedicationLockout(entry, traits, defaultFamilyIds) {
    if (!traits.includes("dedication")) {
        return { dedicationLockout: null, unresolvedLockoutException: null };
    }
    const sentences = normalizedDescriptionSentences(entry);
    let requiredFollowUpCount = 2;
    const countingFamilyIds = new Set(defaultFamilyIds);
    const allowedDedicationFamilyIds = new Set();
    for (const sentence of sentences) {
        if (isDedicationLockoutSentence(sentence)) {
            const count = extractRequiredFollowUpCount(sentence);
            const families = extractCountingFamilyIds(sentence);
            const allowedFamily = extractNamedAllowedDedicationFamilyId(sentence);
            if (count !== null) {
                requiredFollowUpCount = count;
            }
            for (const familyId of families) {
                countingFamilyIds.add(familyId);
            }
            if (allowedFamily) {
                allowedDedicationFamilyIds.add(allowedFamily);
            }
            continue;
        }
        const targetedPermission = extractTargetedEarlyDedicationPermission(sentence);
        if (targetedPermission) {
            allowedDedicationFamilyIds.add(targetedPermission.allowedFamilyId);
            requiredFollowUpCount = targetedPermission.requiredFollowUpCount;
            for (const familyId of targetedPermission.countingFamilyIds) {
                countingFamilyIds.add(familyId);
            }
        }
    }
    const unresolvedLockoutException = unresolvedLockoutExceptionKind(sentences, {
        hasNamedAllowedDedication: allowedDedicationFamilyIds.size > 0,
        hasNonstandardCount: requiredFollowUpCount !== 2,
        hasAdditionalCountingFamily: Array.from(countingFamilyIds).some((familyId) => !defaultFamilyIds.includes(familyId)),
    });
    return {
        dedicationLockout: {
            requiredFollowUpCount,
            countingFamilyIds: Array.from(countingFamilyIds),
            allowedDedicationFamilyIds: Array.from(allowedDedicationFamilyIds),
        },
        unresolvedLockoutException,
    };
}
function unresolvedLockoutExceptionKind(sentences, resolved) {
    if (sentences.some(excludesGrantedDedicationFeatsFromLockout)) {
        return "follow-up-qualification";
    }
    if (!resolved.hasNamedAllowedDedication &&
        sentences.some((sentence) => permitsAnotherDedicationEarly(sentence) || changesDedicationLockoutTarget(sentence))) {
        return "allowed-dedication";
    }
    return sentences.some((sentence) => (changesDedicationLockoutCount(sentence) && !resolved.hasNonstandardCount) ||
        (sharesDedicationLockoutAcrossFamilies(sentence) && !resolved.hasAdditionalCountingFamily))
        ? "follow-up-qualification"
        : null;
}
function extractRequiredFollowUpCount(sentence) {
    const value = sentence.match(/\b(one|two|three|[123])\s+(?:additional\s+|other\s+)?feats?\b/u)?.[1];
    return value ? ({ one: 1, two: 2, three: 3 }[value] ?? Number(value)) : null;
}
function extractCountingFamilyIds(sentence) {
    const value = sentence.match(/\bfrom (?:the )?([^.!?]+?) archetypes?\b/u)?.[1];
    if (!value) {
        return [];
    }
    return value
        .split(/\s+(?:or|and)\s+|,\s*/u)
        .map((family) => family.replace(/^(?:the|an?)\s+/u, "").trim())
        .map((family) => dedicationFamilyId(`${family} dedication`))
        .filter((familyId) => familyId !== null);
}
function extractNamedAllowedDedicationFamilyId(sentence) {
    const name = sentence.match(/\bother than\s+(?:the\s+)?([^.!?]+? dedication)(?: feat)?\b[^.!?]*\buntil\b/u)?.[1];
    return name ? dedicationFamilyId(name) : null;
}
function extractTargetedEarlyDedicationPermission(sentence) {
    const name = sentence.match(/\b(?:can|may)\s+(?:take|select|gain)\s+(?:the\s+)?([^.!?]+? dedication)(?: feat)?\b[^.!?]*\bbefore\b/u)?.[1];
    const allowedFamilyId = name && !/^(?:a\s+)?(?:another|second|this) dedication$/u.test(name) ? dedicationFamilyId(name) : null;
    const requiredFollowUpCount = extractRequiredFollowUpCount(sentence);
    const countingFamilyIds = extractCountingFamilyIds(sentence);
    return allowedFamilyId && requiredFollowUpCount !== null && countingFamilyIds.length > 0
        ? { allowedFamilyId, requiredFollowUpCount, countingFamilyIds }
        : null;
}
function permitsAnotherDedicationEarly(sentence) {
    return (/\b(?:can|may)\s+(?:take|select|gain)\s+(?:a\s+)?(?:another|second)\s+dedication feat\b[^.!?]*\b(?:even if|before|without)\b/u.test(sentence) ||
        /\b(?:can|may)\s+(?:take|select|gain)\b[^.!?]*\bdedication feat\b[^.!?]*\bbefore\b[^.!?]*\b(?:one|two|three)\s+other feats?\b/u.test(sentence));
}
function changesDedicationLockoutTarget(sentence) {
    return isDedicationLockoutSentence(sentence) && /\bother than\b[^.!?]*\buntil\b/u.test(sentence);
}
function changesDedicationLockoutCount(sentence) {
    return isDedicationLockoutSentence(sentence) && /\buntil\b[^.!?]*\b(?:one|three)\s+other feats?\b/u.test(sentence);
}
function sharesDedicationLockoutAcrossFamilies(sentence) {
    return (isDedicationLockoutSentence(sentence) &&
        /\buntil\b[^.!?]*\bfeats?\b[^.!?]*\bfrom\b[^.!?]*\bor\b[^.!?]*\barchetypes?\b/u.test(sentence));
}
function excludesGrantedDedicationFeatsFromLockout(sentence) {
    return /\b(?:one|two|three|these|those)\s+feats?\b[^.!?]*\bdedication\b[^.!?]*\b(?:do not|does not|don't|doesn't)\s+count toward (?:this|the) total\b/u.test(sentence);
}
function isDedicationLockoutSentence(sentence) {
    return /\b(?:can't|cannot|can not|may not)\s+select another dedication feat\b[^.!?]*\buntil\b/u.test(sentence);
}
function normalizedDescriptionSentences(entry) {
    const description = stringOrNull(entry?.system?.description?.value);
    if (!description) {
        return [];
    }
    return description
        .replace(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/giu, (_match, uuid, label) => {
        const uuidName = uuid.split(".").at(-1);
        return label ?? uuidName ?? "";
    })
        .replace(/<\/(?:div|h[1-6]|li|p)>/giu, ". ")
        .replace(/<br\s*\/?>/giu, ". ")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase()
        .split(/(?<=[.!?])\s+/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
}
function extractPrerequisiteText(entry) {
    const values = entry?.system?.prerequisites?.value;
    return Array.isArray(values)
        ? values.flatMap((value) => {
            if (typeof value === "string") {
                return [value];
            }
            const text = value?.value;
            return typeof text === "string" ? [text] : [];
        })
        : [];
}
function normalize(value) {
    return value.trim().toLowerCase();
}
function projectedIdentityKey(feat) {
    if (feat.uuid) {
        return `uuid:${normalize(feat.uuid)}`;
    }
    if (feat.slug) {
        return `slug:${normalize(feat.slug)}`;
    }
    if (feat.name.trim()) {
        return `name:${normalize(feat.name)}`;
    }
    return null;
}
//# sourceMappingURL=archetype-legality.js.map