import { cloneData } from "./cloning.js";

const CREATURE_SIZE_SELECTION = "{item|flags.system.rulesSelections.choice.size}";
const ANCESTRY_HP_SELECTION = "{item|flags.system.rulesSelections.choice.hitPoints}";
const EXPECTED_SIZE_HIT_POINTS = new Map([
  ["large", 10],
  ["medium", 8],
  ["small", 6],
  ["tiny", 6],
]);

interface StructuredCreatureSizeChoiceOption {
  readonly value: string;
  readonly label: string | undefined;
  readonly installedValue: Readonly<Record<string, unknown>>;
}

export function projectStructuredCreatureSizeChoiceOptions(args: {
  readonly sourceItemType: string;
  readonly rules: readonly unknown[];
  readonly sourceRuleIndex: number;
}): readonly StructuredCreatureSizeChoiceOption[] | null {
  if (args.sourceItemType !== "ancestry") return null;
  const rule = record(args.rules[args.sourceRuleIndex]);
  if (!isCreatureSizeChoiceCandidate(rule, args.rules)) return null;
  if (rule.flag !== "choice" || !Array.isArray(rule.choices) || rule.choices.length !== 4) return null;
  if (!hasExactConsumerRules(args.rules)) return null;

  const seenSizes = new Set<string>();
  const options: StructuredCreatureSizeChoiceOption[] = [];
  for (const candidate of rule.choices) {
    const choice = record(candidate);
    const installedValue = record(choice.value);
    const size = installedValue.size;
    const hitPoints = installedValue.hitPoints;
    if (
      typeof size !== "string" ||
      seenSizes.has(size) ||
      !EXPECTED_SIZE_HIT_POINTS.has(size) ||
      EXPECTED_SIZE_HIT_POINTS.get(size) !== hitPoints ||
      !hasOnlyKeys(installedValue, ["hitPoints", "size"])
    ) {
      return null;
    }
    seenSizes.add(size);
    options.push({
      value: size,
      label: typeof choice.label === "string" ? choice.label : undefined,
      installedValue,
    });
  }

  return seenSizes.size === EXPECTED_SIZE_HIT_POINTS.size ? options : null;
}

export function materializeStructuredCreatureSizeChoice(args: {
  readonly sourceItemType: string;
  readonly rules: readonly unknown[];
  readonly sourceRuleIndex: number;
  readonly selectedValue: string;
}): string | Record<string, unknown> {
  if (args.sourceItemType !== "ancestry") return args.selectedValue;
  const rule = record(args.rules[args.sourceRuleIndex]);
  if (!isCreatureSizeChoiceCandidate(rule, args.rules)) return args.selectedValue;
  const options = projectStructuredCreatureSizeChoiceOptions(args);
  const selected = options?.find((option) => option.value === args.selectedValue);
  if (!selected) {
    throw new TypeError("The structured ancestry size choice is not an installed PF2E profile Wayfinder supports.");
  }
  return cloneData(selected.installedValue) as Record<string, unknown>;
}

function isCreatureSizeChoiceCandidate(rule: Record<string, unknown>, rules: readonly unknown[]): boolean {
  if (rule.key !== "ChoiceSet" || !Array.isArray(rule.choices)) return false;
  const flag = typeof rule.flag === "string" ? rule.flag : null;
  if (!flag || !rule.choices.some((choice) => Object.keys(record(record(choice).value)).length > 0)) return false;
  return rules.some((candidate) => {
    const consumer = record(candidate);
    return consumer.key === "CreatureSize" && consumer.value === `{item|flags.system.rulesSelections.${flag}.size}`;
  });
}

function hasExactConsumerRules(rules: readonly unknown[]): boolean {
  const creatureSizeRules = rules.filter((candidate) => record(candidate).key === "CreatureSize");
  const ancestryHpRules = rules.filter(
    (candidate) =>
      record(candidate).key === "ActiveEffectLike" && record(candidate).path === "system.attributes.ancestryhp"
  );
  return (
    creatureSizeRules.length === 1 &&
    record(creatureSizeRules[0]).value === CREATURE_SIZE_SELECTION &&
    ancestryHpRules.length === 1 &&
    record(ancestryHpRules[0]).mode === "upgrade" &&
    record(ancestryHpRules[0]).priority === 51 &&
    record(ancestryHpRules[0]).value === ANCESTRY_HP_SELECTION
  );
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
