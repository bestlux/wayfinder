/**
 * Foundry 14.366 / PF2E 8.4.1 production-preparation witness.
 *
 * The canonical PF2E Dagger source was adapted in memory to the minimum tactical
 * tech-weapon facts (level 2, 1 gp source price), embedded in a temporary character,
 * and read back after PF2E actor/item preparation. No world document was written.
 */
export const PF2E_841_TACTICAL_WEAPON_PRICE_WITNESS = Object.freeze({
  environment: Object.freeze({ foundryVersion: "14.366", pf2eVersion: "8.4.1" }),
  source: Object.freeze({
    _id: "pf2e841-tactical",
    name: "PF2E 8.4.1 tactical weapon witness",
    img: "icons/weapons/daggers/dagger-straight-blue.webp",
    type: "weapon",
    system: Object.freeze({
      level: Object.freeze({ value: 2 }),
      category: "simple",
      range: null,
      traits: Object.freeze({
        otherTags: Object.freeze([]),
        value: Object.freeze(["agile", "finesse", "tech"]),
        rarity: "common",
      }),
      publication: Object.freeze({ title: "Pathfinder Player Core" }),
      price: Object.freeze({ value: Object.freeze({ gp: 1 }) }),
      quantity: 1,
      temporary: false,
      rules: Object.freeze([]),
      size: "med",
      baseItem: "dagger",
      runes: Object.freeze({ potency: 0, striking: 0, property: Object.freeze([]) }),
      material: Object.freeze({ type: null, grade: null }),
      grade: "tactical",
      specific: null,
      subitems: Object.freeze([]),
    }),
  }),
  prepared: Object.freeze({
    type: "weapon",
    system: Object.freeze({
      level: Object.freeze({ value: 2 }),
      traits: Object.freeze({
        otherTags: Object.freeze([]),
        value: Object.freeze(["agile", "finesse", "tech", "tracking-1"]),
        rarity: "common",
      }),
      price: Object.freeze({
        value: Object.freeze({ pp: 0, gp: 36, sp: 0, cp: 0, credits: 0, upb: 0 }),
        per: 1,
        sizeSensitive: false,
      }),
      quantity: 1,
      temporary: false,
      runes: Object.freeze({ potency: 0, striking: 0, property: Object.freeze([]), effects: Object.freeze([]) }),
      material: Object.freeze({ type: null, grade: null, effects: Object.freeze([]) }),
      grade: "tactical",
      specific: null,
    }),
  }),
  expected: Object.freeze({ level: 2, sourceCopper: 100, preparedCopper: 3_600, gradeCopper: 3_500 }),
});
