import { bardContributor } from "./bard-contributor.js";
import { baseContributor } from "./base-contributor.js";
import { animistContributor, druidContributor, magusContributor, oracleContributor, psychicContributor, sorcererContributor, summonerContributor, witchContributor, } from "./caster-contributors.js";
import { clericContributor } from "./cleric-contributor.js";
import { wizardContributor } from "./wizard-contributor.js";
const CONTRIBUTORS = [
    wizardContributor,
    clericContributor,
    bardContributor,
    animistContributor,
    druidContributor,
    magusContributor,
    oracleContributor,
    psychicContributor,
    sorcererContributor,
    summonerContributor,
    witchContributor,
];
const CONTRIBUTORS_BY_SLUG = new Map(CONTRIBUTORS.map((contributor) => [contributor.slug, contributor]));
export function getClassContributor(classSlug) {
    if (!classSlug) {
        return baseContributor;
    }
    return CONTRIBUTORS_BY_SLUG.get(classSlug) ?? baseContributor;
}
//# sourceMappingURL=registry.js.map