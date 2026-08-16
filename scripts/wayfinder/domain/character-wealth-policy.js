import { GENERATED_CHARACTER_WEALTH_POLICY } from "./character-wealth-policy.generated.js";
export const CHARACTER_WEALTH_POLICY_REF = Object.freeze({
    policyId: GENERATED_CHARACTER_WEALTH_POLICY.policyId,
    policyVersion: GENERATED_CHARACTER_WEALTH_POLICY.policyVersion,
    dataDigest: GENERATED_CHARACTER_WEALTH_POLICY.dataDigest,
});
const characterWealthRows = Object.freeze(GENERATED_CHARACTER_WEALTH_POLICY.rows.map((row) => Object.freeze({
    ...row,
    permanentItemAllowances: Object.freeze(row.permanentItemAllowances.map((allowance) => Object.freeze({ ...allowance }))),
})));
export function getCharacterWealthRow(characterLevel) {
    if (!Number.isInteger(characterLevel) || characterLevel < 1 || characterLevel > 20) {
        throw new RangeError("Character Wealth level must be an integer from 1 through 20.");
    }
    const row = characterWealthRows[characterLevel - 1];
    if (!row || row.characterLevel !== characterLevel) {
        throw new Error(`Character Wealth policy is missing level ${characterLevel}.`);
    }
    return row;
}
//# sourceMappingURL=character-wealth-policy.js.map