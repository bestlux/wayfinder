import { cloneData } from "../../shared/cloning.js";
export function materializeClassChoiceSelection(choice, selectedValue) {
    const option = choice.options.find((candidate) => candidate.value === selectedValue);
    if (!option) {
        if (choice.options.some((candidate) => candidate.ruleValue !== undefined)) {
            throw new TypeError("The structured class choice is not an installed PF2E profile Wayfinder supports.");
        }
        return selectedValue;
    }
    if (option.ruleValue === undefined)
        return selectedValue;
    return cloneData(option.ruleValue);
}
export function projectStoredClassChoiceSelection(choice, storedValue) {
    if (typeof storedValue === "string" && storedValue.length > 0) {
        return storedValue;
    }
    const stored = canonicalJson(storedValue);
    return (choice.options.find((option) => option.ruleValue !== undefined && canonicalJson(option.ruleValue) === stored)
        ?.value ?? null);
}
function canonicalJson(value) {
    if (value === undefined)
        return "undefined";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
        .join(",")}}`;
}
//# sourceMappingURL=selection-value.js.map