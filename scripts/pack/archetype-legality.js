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
        if (!candidate.bypassesExistingLockout &&
            dedications.some((dedication) => !dedication.hasUnverifiedLockoutException && isIncompleteDedication(dedication, projected))) {
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
    return {
        uuid: fallback.uuid ?? null,
        name,
        slug,
        traits,
        familyIds: resolveArchetypeFamilyIds(entry, packId, name, slug, traits),
        hasUnverifiedLockoutException: hasUnverifiedDedicationLockoutException(entry),
        bypassesExistingLockout: hasUnverifiedCandidateLockoutBypass(entry, name),
    };
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
function isIncompleteDedication(dedication, projected) {
    if (dedication.familyIds.length === 0) {
        return false;
    }
    const followUpCount = projected.filter((feat) => !feat.traits.includes("dedication") && sharesArchetypeFamily(feat, dedication)).length;
    return followUpCount < 2;
}
function sharesArchetypeFamily(left, right) {
    const rightFamilies = new Set(right.familyIds);
    return left.familyIds.some((familyId) => rightFamilies.has(familyId));
}
function hasUnverifiedDedicationLockoutException(entry) {
    return normalizedDescriptionSentences(entry).some((sentence) => permitsAnotherDedicationEarly(sentence) ||
        changesDedicationLockoutTarget(sentence) ||
        changesDedicationLockoutCount(sentence) ||
        sharesDedicationLockoutAcrossFamilies(sentence) ||
        excludesGrantedDedicationFeatsFromLockout(sentence));
}
function hasUnverifiedCandidateLockoutBypass(entry, name) {
    const normalizedName = normalize(name).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const familyName = normalize(name.replace(/\s+dedication$/iu, "")).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const candidate = `(?:this dedication(?: feat)?|${normalizedName}|the dedication feat for (?:the )?${familyName}(?: archetype)?)`;
    const permission = new RegExp(`\\b(?:(?:can|may)\\s+(?:take|select|gain)|allowing you to take)\\s+${candidate}\\b[^.!?]*\\b(?:even if|before|without)\\b`, "u");
    return normalizedDescriptionSentences(entry).some((sentence) => permission.test(sentence));
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
//# sourceMappingURL=archetype-legality.js.map