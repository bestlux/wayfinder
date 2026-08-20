import { cloneData } from "../../shared/cloning.js";
import type {
  AppliedSpellRarityAttestation,
  AttestedSpellRarityAccess,
  DraftState,
  PendingStep,
  SelectionRef,
  SpellRarityAttestation,
  SpellRarityAttestationBasis,
  SpellRarityAttestationSubject,
} from "../../types.js";
import {
  canGrantRestrictedSpellRarityAccess,
  SPELL_RARITY_CEILINGS,
  type SpellRarityCeiling,
  spellChoiceRarityCeiling,
} from "./rarity-access.js";

const MAX_REASON_LENGTH = 500;
const MAX_IDENTITY_LENGTH = 200;

export type SpellRarityAttestationState = "none" | "unresolved" | "stale" | "attested" | "unused";

export interface SpellRarityAttestationEvaluation {
  state: SpellRarityAttestationState;
  granted: boolean;
  attestation: SpellRarityAttestation | null;
}

export interface SpellRarityAttestationProblem {
  slotId: string;
  stepId: string;
  title: string;
  message: string;
}

export interface CreateSpellRarityAttestationArgs {
  actorId: string;
  step: PendingStep;
  targetLevel: number;
  worldRarityCeiling: SpellRarityCeiling;
  claimedBasis: SpellRarityAttestationBasis;
  reason: string;
  authorUserId: string;
  authorName: string;
  attestedAt: string;
}

export function createSpellRarityAttestation(args: CreateSpellRarityAttestationArgs): AttestedSpellRarityAccess {
  const subject = buildSpellRarityAttestationSubject(
    args.actorId,
    args.step,
    args.targetLevel,
    args.worldRarityCeiling
  );
  const reason = normalizeRequiredText(args.reason, MAX_REASON_LENGTH);
  const authorUserId = normalizeRequiredText(args.authorUserId, MAX_IDENTITY_LENGTH);
  const authorName = normalizeRequiredText(args.authorName, MAX_IDENTITY_LENGTH);
  if (!subject || !reason || !authorUserId || !authorName || !validTimestamp(args.attestedAt)) {
    throw new Error("Wayfinder could not record a complete restricted-spell player attestation.");
  }
  if (args.claimedBasis !== "rules-access" && args.claimedBasis !== "reported-gm-permission") {
    throw new Error("Wayfinder could not record the selected restricted-spell access basis.");
  }

  return {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "attested",
    subject,
    claimedBasis: args.claimedBasis,
    reason,
    authorUserId,
    authorName,
    attestedAt: args.attestedAt,
  };
}

export function migrateLegacySpellRarityAccess(slotId: string): SpellRarityAttestation {
  return {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "unresolved",
    slotId,
    migratedFrom: "legacy-boolean",
  };
}

export function normalizeSpellRarityAttestation(slotId: string, raw: unknown): SpellRarityAttestation | null {
  if (!slotId) return null;
  if (raw === true) return migrateLegacySpellRarityAccess(slotId);
  if (!isRecord(raw) || raw.version !== 1 || raw.kind !== "spell-rarity-access") {
    return null;
  }
  if (raw.trust !== "player-attestation") {
    return null;
  }
  if (raw.status === "unresolved") {
    return raw.slotId === slotId && raw.migratedFrom === "legacy-boolean"
      ? migrateLegacySpellRarityAccess(slotId)
      : null;
  }
  if (raw.status !== "attested") {
    return null;
  }

  const subject = normalizeSubject(raw.subject, slotId);
  const reason = normalizeRequiredText(raw.reason, MAX_REASON_LENGTH);
  const authorUserId = normalizeRequiredText(raw.authorUserId, MAX_IDENTITY_LENGTH);
  const authorName = normalizeRequiredText(raw.authorName, MAX_IDENTITY_LENGTH);
  const claimedBasis = raw.claimedBasis;
  const attestedAt = raw.attestedAt;
  if (
    !subject ||
    !reason ||
    !authorUserId ||
    !authorName ||
    (claimedBasis !== "rules-access" && claimedBasis !== "reported-gm-permission") ||
    typeof attestedAt !== "string" ||
    !validTimestamp(attestedAt)
  ) {
    return null;
  }

  return {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "attested",
    subject,
    claimedBasis,
    reason,
    authorUserId,
    authorName,
    attestedAt,
  };
}

export function normalizeAppliedSpellRarityAttestation(raw: unknown): AppliedSpellRarityAttestation | null {
  if (!isRecord(raw) || !isRecord(raw.subject) || typeof raw.subject.slotId !== "string") {
    return null;
  }
  const attestation = normalizeSpellRarityAttestation(raw.subject.slotId, raw);
  const subjectLabel = normalizeRequiredText(raw.subjectLabel, MAX_IDENTITY_LENGTH);
  if (attestation?.status !== "attested" || !subjectLabel || !Array.isArray(raw.selectedSpells)) {
    return null;
  }
  const selectedSpells = raw.selectedSpells.flatMap((selection): SelectionRef[] => {
    const normalized = normalizeSelectionRef(selection, attestation.subject.slotId);
    return normalized ? [normalized] : [];
  });
  if (selectedSpells.length !== raw.selectedSpells.length) {
    return null;
  }
  return { ...attestation, subjectLabel, selectedSpells };
}

export function evaluateSpellRarityAttestation(
  actorId: string,
  draft: DraftState,
  step: PendingStep,
  worldRarityCeiling: SpellRarityCeiling
): SpellRarityAttestationEvaluation {
  const attestation = draft.spellRarityAttestations[step.slotId] ?? null;
  if (!attestation) {
    return { state: "none", granted: false, attestation: null };
  }
  if (!canGrantRestrictedSpellRarityAccess(step, worldRarityCeiling)) {
    return { state: "unused", granted: false, attestation };
  }
  if (attestation.status === "unresolved") {
    return { state: "unresolved", granted: false, attestation };
  }
  const currentSubject = buildSpellRarityAttestationSubject(actorId, step, draft.targetLevel, worldRarityCeiling);
  if (!currentSubject || !subjectsMatch(currentSubject, attestation.subject)) {
    return { state: "stale", granted: false, attestation };
  }
  return { state: "attested", granted: true, attestation };
}

export function listSpellRarityAttestationProblems(
  actorId: string,
  draft: DraftState,
  steps: readonly PendingStep[],
  worldRarityCeiling: SpellRarityCeiling
): SpellRarityAttestationProblem[] {
  const stepBySlotId = new Map(steps.map((step) => [step.slotId, step]));
  return Object.entries(draft.spellRarityAttestations).flatMap(([slotId, attestation]) => {
    const step = stepBySlotId.get(slotId);
    if (!step) {
      return [
        {
          slotId,
          stepId: attestation.status === "attested" ? attestation.subject.stepId : slotId,
          title: "Restricted spell access",
          message:
            "A restricted-spell player attestation no longer matches this character plan. Clear or rebuild the draft.",
        },
      ];
    }
    const evaluation = evaluateSpellRarityAttestation(actorId, draft, step, worldRarityCeiling);
    if (evaluation.state === "unresolved") {
      return [
        {
          slotId,
          stepId: step.id,
          title: step.title,
          message: `${step.title}: review the migrated restricted-spell player attestation before Apply.`,
        },
      ];
    }
    if (evaluation.state === "stale") {
      return [
        {
          slotId,
          stepId: step.id,
          title: step.title,
          message: `${step.title}: re-record or remove the stale restricted-spell player attestation.`,
        },
      ];
    }
    return [];
  });
}

export function listSpellRarityRecoveryProblems(actorId: string, draft: DraftState): SpellRarityAttestationProblem[] {
  const frozenBySlotId = new Map(
    draft.applySpellRarityAttestations.map((attestation) => [attestation.subject.slotId, attestation])
  );
  const problems: SpellRarityAttestationProblem[] = [];
  for (const [slotId, attestation] of Object.entries(draft.spellRarityAttestations)) {
    const frozen = frozenBySlotId.get(slotId);
    if (
      attestation.status !== "attested" ||
      frozen === undefined ||
      !appliedAttestationMatchesDraft(actorId, draft, attestation, frozen)
    ) {
      problems.push({
        slotId,
        stepId: attestation.status === "attested" ? attestation.subject.stepId : slotId,
        title: "Restricted spell access",
        message:
          "The partial-Apply spell attestation receipt no longer matches the retained draft. Reopen Wayfinder or recover the actor manually.",
      });
    }
  }
  for (const frozen of draft.applySpellRarityAttestations) {
    if (!draft.spellRarityAttestations[frozen.subject.slotId]) {
      problems.push({
        slotId: frozen.subject.slotId,
        stepId: frozen.subject.stepId,
        title: frozen.subjectLabel,
        message:
          "The partial-Apply spell attestation receipt has no matching retained claim. Reopen Wayfinder or recover the actor manually.",
      });
    }
  }
  return problems;
}

export function frozenSpellRarityAttestationForStep(
  actorId: string,
  draft: DraftState,
  step: PendingStep
): AppliedSpellRarityAttestation | null {
  const attestation = draft.spellRarityAttestations[step.slotId];
  if (attestation?.status !== "attested") return null;
  const frozen = draft.applySpellRarityAttestations.find(
    (candidate) => candidate.subject.slotId === step.slotId && candidate.subject.stepId === step.id
  );
  return frozen && appliedAttestationMatchesDraft(actorId, draft, attestation, frozen) ? frozen : null;
}

export function buildAppliedSpellRarityAttestations(
  actorId: string,
  draft: DraftState,
  steps?: readonly PendingStep[],
  worldRarityCeiling?: SpellRarityCeiling
): AppliedSpellRarityAttestation[] {
  const stepBySlotId = steps ? new Map(steps.map((step) => [step.slotId, step])) : null;
  return Object.values(draft.spellRarityAttestations).flatMap((attestation) => {
    if (
      attestation.status !== "attested" ||
      attestation.subject.actorId !== actorId ||
      attestation.subject.targetLevel !== draft.targetLevel
    ) {
      return [];
    }
    const step = stepBySlotId?.get(attestation.subject.slotId);
    if (stepBySlotId && worldRarityCeiling) {
      if (!step || evaluateSpellRarityAttestation(actorId, draft, step, worldRarityCeiling).state !== "attested") {
        return [];
      }
    }
    return [
      {
        ...cloneData(attestation),
        subjectLabel: step?.title ?? attestation.subject.stepId,
        selectedSpells: cloneData(draft.spellChoices[attestation.subject.slotId] ?? []),
      },
    ];
  });
}

function appliedAttestationMatchesDraft(
  actorId: string,
  draft: DraftState,
  attestation: AttestedSpellRarityAccess,
  frozen: AppliedSpellRarityAttestation
): boolean {
  const frozenAttestation = normalizeSpellRarityAttestation(attestation.subject.slotId, frozen);
  return (
    frozenAttestation?.status === "attested" &&
    frozen.subject.actorId === actorId &&
    frozen.subject.targetLevel === draft.targetLevel &&
    JSON.stringify(frozenAttestation) === JSON.stringify(attestation) &&
    JSON.stringify(frozen.selectedSpells.map((selection) => selection.uuid)) ===
      JSON.stringify((draft.spellChoices[attestation.subject.slotId] ?? []).map((selection) => selection.uuid))
  );
}

export function removeOrphanedSpellRarityAttestations(draft: DraftState, steps: readonly PendingStep[]): string[] {
  const activeSpellSlotIds = new Set(steps.flatMap((step) => (step.kind === "spell-choice" ? [step.slotId] : [])));
  const removed: string[] = [];
  for (const slotId of Object.keys(draft.spellRarityAttestations)) {
    if (!activeSpellSlotIds.has(slotId)) {
      delete draft.spellRarityAttestations[slotId];
      removed.push(slotId);
    }
  }
  return removed;
}

export function buildSpellRarityAttestationSubject(
  actorId: string,
  step: PendingStep,
  targetLevel: number,
  worldRarityCeiling: SpellRarityCeiling
): SpellRarityAttestationSubject | null {
  const normalizedActorId = normalizeRequiredText(actorId, MAX_IDENTITY_LENGTH);
  if (
    !normalizedActorId ||
    step.kind !== "spell-choice" ||
    !canGrantRestrictedSpellRarityAccess(step, worldRarityCeiling)
  ) {
    return null;
  }
  return {
    actorId: normalizedActorId,
    slotId: step.slotId,
    stepId: step.id,
    targetLevel,
    stepLevel: step.level,
    destinationKey: step.spellChoice.destination.key,
    stepRarityCeiling: spellChoiceRarityCeiling(step.spellChoice),
    worldRarityCeiling,
  };
}

export function spellRarityAttestationBasisLabel(basis: SpellRarityAttestationBasis): string {
  return basis === "rules-access" ? "A character or rules Access" : "GM said yes, per the player";
}

export function buildSpellRarityAttestationReviewLines(
  attestations: readonly AppliedSpellRarityAttestation[]
): string[] {
  return attestations.map((attestation) => {
    const spells = attestation.selectedSpells.map((spell) => spell.name).join(", ") || "no selected spells";
    return `Access note, the player's word and not a Wayfinder check: ${attestation.subjectLabel}; ${spellRarityAttestationBasisLabel(attestation.claimedBasis)}; ${spells}; written by ${attestation.authorName} at ${attestation.attestedAt}; reason: ${attestation.reason}`;
  });
}

function subjectsMatch(left: SpellRarityAttestationSubject, right: SpellRarityAttestationSubject): boolean {
  return (
    left.actorId === right.actorId &&
    left.slotId === right.slotId &&
    left.stepId === right.stepId &&
    left.targetLevel === right.targetLevel &&
    left.stepLevel === right.stepLevel &&
    left.destinationKey === right.destinationKey &&
    left.stepRarityCeiling === right.stepRarityCeiling &&
    left.worldRarityCeiling === right.worldRarityCeiling
  );
}

function normalizeSubject(raw: unknown, slotId: string): SpellRarityAttestationSubject | null {
  if (!isRecord(raw)) return null;
  const actorId = normalizeRequiredText(raw.actorId, MAX_IDENTITY_LENGTH);
  const stepId = normalizeRequiredText(raw.stepId, MAX_IDENTITY_LENGTH);
  const destinationKey = normalizeRequiredText(raw.destinationKey, MAX_IDENTITY_LENGTH);
  if (
    !actorId ||
    raw.slotId !== slotId ||
    !stepId ||
    !Number.isInteger(raw.targetLevel) ||
    Number(raw.targetLevel) < 1 ||
    Number(raw.targetLevel) > 20 ||
    !Number.isInteger(raw.stepLevel) ||
    Number(raw.stepLevel) < 1 ||
    Number(raw.stepLevel) > 20 ||
    !destinationKey ||
    !isSpellRarityCeiling(raw.stepRarityCeiling) ||
    !isSpellRarityCeiling(raw.worldRarityCeiling)
  ) {
    return null;
  }
  return {
    actorId,
    slotId,
    stepId,
    targetLevel: Number(raw.targetLevel),
    stepLevel: Number(raw.stepLevel),
    destinationKey,
    stepRarityCeiling: raw.stepRarityCeiling,
    worldRarityCeiling: raw.worldRarityCeiling,
  };
}

function normalizeSelectionRef(raw: unknown, slotId: string): SelectionRef | null {
  if (!isRecord(raw) || raw.slotId !== slotId) return null;
  const packId = normalizeRequiredText(raw.packId, MAX_IDENTITY_LENGTH);
  const documentId = normalizeRequiredText(raw.documentId, MAX_IDENTITY_LENGTH);
  const uuid = normalizeRequiredText(raw.uuid, 500);
  const itemType = normalizeRequiredText(raw.itemType, MAX_IDENTITY_LENGTH);
  const name = normalizeRequiredText(raw.name, MAX_IDENTITY_LENGTH);
  if (!packId || !documentId || !uuid || !itemType || !name) return null;
  if (raw.level !== null && !Number.isInteger(raw.level)) return null;
  const slug: string | null | undefined =
    typeof raw.slug === "string" ? raw.slug : raw.slug === null ? null : undefined;
  return {
    slotId,
    packId,
    documentId,
    uuid,
    itemType,
    featType: typeof raw.featType === "string" ? raw.featType : null,
    name,
    level: raw.level as number | null,
    ...(slug !== undefined ? { slug } : {}),
  };
}

function isSpellRarityCeiling(value: unknown): value is SpellRarityCeiling {
  return SPELL_RARITY_CEILINGS.includes(value as SpellRarityCeiling);
}

function normalizeRequiredText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
