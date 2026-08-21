import { cloneData } from "./cloning.js";

const EIDOLON_TRADITION_SELECTION = "{item|flags.system.rulesSelections.eidolonTradition.tradition}";
const EIDOLON_SKILL_SELECTION = "system.skills.{item|flags.system.rulesSelections.eidolonTradition.skill}.rank";
const EXPECTED_TRADITION_SKILLS = new Map([
  ["arcane", "arcana"],
  ["divine", "religion"],
  ["occult", "occultism"],
  ["primal", "nature"],
]);

export interface StructuredEidolonTraditionChoiceOption {
  readonly value: string;
  readonly label: string | undefined;
  readonly installedValue: Readonly<Record<string, unknown>>;
}

export function projectStructuredEidolonTraditionChoiceOptions(args: {
  readonly sourceItemType: string;
  readonly rules: readonly unknown[];
  readonly sourceRuleIndex: number;
}): readonly StructuredEidolonTraditionChoiceOption[] | null {
  if (args.sourceItemType !== "classfeature") return null;
  const rule = record(args.rules[args.sourceRuleIndex]);
  if (rule.key !== "ChoiceSet" || rule.flag !== "eidolonTradition") return null;
  if (!Array.isArray(rule.choices) || rule.choices.length !== EXPECTED_TRADITION_SKILLS.size) return null;
  if (!hasExactConsumerRules(args.rules)) return null;

  const seenTraditions = new Set<string>();
  const options: StructuredEidolonTraditionChoiceOption[] = [];
  for (const candidate of rule.choices) {
    const choice = record(candidate);
    const installedValue = record(choice.value);
    const tradition = installedValue.tradition;
    const skill = installedValue.skill;
    if (
      typeof tradition !== "string" ||
      typeof skill !== "string" ||
      seenTraditions.has(tradition) ||
      EXPECTED_TRADITION_SKILLS.get(tradition) !== skill ||
      !hasOnlyKeys(installedValue, ["skill", "tradition"])
    ) {
      return null;
    }
    seenTraditions.add(tradition);
    options.push({
      value: tradition,
      label: typeof choice.label === "string" ? choice.label : undefined,
      installedValue,
    });
  }

  return seenTraditions.size === EXPECTED_TRADITION_SKILLS.size ? options : null;
}

export function cloneStructuredEidolonTraditionValue(
  option: StructuredEidolonTraditionChoiceOption
): Record<string, unknown> {
  return cloneData(option.installedValue) as Record<string, unknown>;
}

function hasExactConsumerRules(rules: readonly unknown[]): boolean {
  const traditionConsumers = rules.filter((candidate) => {
    const rule = record(candidate);
    return rule.key === "ActiveEffectLike" && rule.path === "flags.system.eidolon.tradition";
  });
  const skillConsumers = rules.filter((candidate) => {
    const rule = record(candidate);
    return rule.key === "ActiveEffectLike" && rule.path === EIDOLON_SKILL_SELECTION;
  });
  return (
    traditionConsumers.length === 1 &&
    record(traditionConsumers[0]).mode === "override" &&
    record(traditionConsumers[0]).value === EIDOLON_TRADITION_SELECTION &&
    skillConsumers.length === 1 &&
    record(skillConsumers[0]).mode === "upgrade" &&
    record(skillConsumers[0]).value === 1
  );
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
