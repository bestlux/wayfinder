import { buildSpontaneousRepertoireSpellChoiceSteps } from "../spell-choice/spontaneous-step-builder.js";
import type { ClassContributor } from "./types.js";

export const bardContributor: ClassContributor = {
  slug: "bard",
  async buildSpellChoiceSteps(args) {
    return buildSpontaneousRepertoireSpellChoiceSteps({
      ...args,
      classSlug: "bard",
      spellcastingFeatureName: "Occult Spellcasting",
      tradition: "occult",
      ability: "cha",
      cantripCount: 5,
      initialRankOneCount: 2,
      rankIncreaseCount: 2,
      rankMaintenanceCount: 1,
    });
  },
};
