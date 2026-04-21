import { ABILITY_KEYS } from "../constants.js";
export function projectAbilities({ ancestryBoosts, ancestryFlaws, backgroundBoosts, classBoost, levelBoosts, }) {
    return Object.fromEntries(ABILITY_KEYS.map((key) => {
        const boostCount = countOccurrences(ancestryBoosts, key) +
            countOccurrences(backgroundBoosts, key) +
            (classBoost === key ? 1 : 0) +
            countOccurrences(levelBoosts[1], key) +
            countOccurrences(levelBoosts[5], key) +
            countOccurrences(levelBoosts[10], key) +
            countOccurrences(levelBoosts[15], key) +
            countOccurrences(levelBoosts[20], key);
        const flawCount = countOccurrences(ancestryFlaws, key);
        const netBoosts = boostCount - flawCount;
        const modifier = netBoosts <= 4 ? netBoosts : 4 + Math.floor((netBoosts - 4) / 2);
        const partial = netBoosts >= 5 && netBoosts % 2 === 1;
        return [
            key,
            {
                key,
                modifier,
                partial,
                boostCount,
                flawCount,
            },
        ];
    }));
}
function countOccurrences(list, ability) {
    return list.filter((entry) => entry === ability).length;
}
//# sourceMappingURL=ability-projection.js.map