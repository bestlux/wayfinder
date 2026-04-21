import type { ClassContributor } from "./types.js";

export const wizardContributor: ClassContributor = {
  slug: "wizard",
  async buildPlanSteps() {
    return [];
  },
};
