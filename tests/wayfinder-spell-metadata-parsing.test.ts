import { describe, expect, it } from "vitest";
import { parseCurriculumSpells } from "../src/wayfinder/spell-choice/metadata-parsing";

describe("wizard curriculum metadata parsing", () => {
  it.each([
    {
      shape: "direct list rows",
      html: "<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Force Barrage]</li></ul>",
      expected: ["Force Barrage"],
    },
    {
      shape: "paragraph-wrapped list rows",
      html: "<p><strong>Curriculum</strong></p><ul><li><p><strong>1st</strong>: @UUID[Compendium.pf2e.spells-srd.Item.nPb8DDs4rZpBLWIb]{Cradle Aloft}, @UUID[Compendium.pf2e.spells-srd.Item.TTwOKGqmZeKSyNMH]{Gentle Landing}, @UUID[Compendium.pf2e.spells-srd.Item.Rn2LkoSq1XhLsODV]{Pummeling Rubble}</p></li></ul><p><strong>School Spells</strong> initial: @UUID[Compendium.pf2e.spells-srd.Item.Circle of Weakness]</p>",
      expected: ["Cradle Aloft", "Gentle Landing", "Pummeling Rubble"],
    },
    {
      shape: "standalone curriculum paragraphs",
      html: "<p><strong>Curriculum</strong></p><p><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Mending], @UUID[Compendium.pf2e.spells-srd.Item.Runic Weapon], @UUID[Compendium.pf2e.spells-srd.Item.Summon Construct]</p><p><strong>School Spells</strong> initial: @UUID[Compendium.pf2e.spells-srd.Item.Augmented Body]</p>",
      expected: ["Mending", "Runic Weapon", "Summon Construct"],
    },
  ])("parses $shape", ({ html, expected }) => {
    expect(parseCurriculumSpells(html)).toEqual({ 1: expected });
  });

  it("keeps standalone rank paragraphs scoped to an explicit curriculum section", () => {
    const html =
      "<p><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Outside Curriculum]</p>" +
      "<p><strong>Curriculum</strong></p>" +
      "<p><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Inside Curriculum]</p>" +
      "<p><strong>School Spells</strong> initial: @UUID[Compendium.pf2e.spells-srd.Item.Focus Spell]</p>" +
      "<p><strong>2nd:</strong> @UUID[Compendium.pf2e.spells-srd.Item.After Curriculum]</p>";

    expect(parseCurriculumSpells(html)).toEqual({ 1: ["Inside Curriculum"] });
  });

  it("does not treat nested non-curriculum spell lists as wizard curricula", () => {
    const html =
      "<p><strong>Apparition Spells</strong></p>" +
      "<ul>" +
      "<li><p><strong>Cantrip</strong> @UUID[Compendium.pf2e.spells-srd.Item.Guidance]</p></li>" +
      "<li><p><strong>1st</strong> @UUID[Compendium.pf2e.spells-srd.Item.Fear]</p></li>" +
      "</ul>";

    expect(parseCurriculumSpells(html)).toEqual({});
  });

  it("ends a standalone curriculum section at heading boundaries", () => {
    const html =
      "<p><strong>Curriculum</strong></p>" +
      "<p><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Inside Curriculum]</p>" +
      "<h2>Other spells</h2>" +
      "<p><strong>2nd:</strong> @UUID[Compendium.pf2e.spells-srd.Item.After Curriculum]</p>";

    expect(parseCurriculumSpells(html)).toEqual({ 1: ["Inside Curriculum"] });
  });

  it("preserves last-row-wins and per-row spell deduplication", () => {
    const html =
      "<p><strong>Curriculum</strong></p>" +
      "<p><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Old Spell]</p>" +
      "<ul>" +
      '<li><p><strong>1st</strong>: @UUID[Compendium.pf2e.spells-srd.Item.k34hDOfIIMAxNL4a]{New Spell}, <a data-uuid="Compendium.pf2e.spells-srd.Item.k34hDOfIIMAxNL4a">New Spell</a></p></li>' +
      "</ul>";

    expect(parseCurriculumSpells(html)).toEqual({ 1: ["New Spell"] });
  });
});
