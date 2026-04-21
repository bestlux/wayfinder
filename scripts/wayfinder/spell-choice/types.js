export function asSpellChoiceClassDocument(value) {
    return isRecord(value) ? value : null;
}
export function asSpellChoiceSchoolDocument(value) {
    return isRecord(value) ? value : null;
}
export function asSpellChoiceDeityDocument(value) {
    return isRecord(value) ? value : null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=types.js.map