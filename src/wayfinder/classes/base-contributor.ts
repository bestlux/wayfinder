import type { ClassContributor } from "./types.js";

export const baseContributor: ClassContributor = {
  slug: "base",
  async buildPlanSteps() {
    return [];
  },
};
