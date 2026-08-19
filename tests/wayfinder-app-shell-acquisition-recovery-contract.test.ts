import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Wayfinder app-shell acquisition recovery contract", () => {
  it("durably enriches the exact guarded Apply candidate before execution can cross currency-after", () => {
    const source = readFileSync(new URL("../src/wayfinder/app-shell.ts", import.meta.url), "utf8");
    const persistenceStart = source.indexOf("persistAcquisitionCurrencyConvergenceWitness: async (witness) => {");
    const persistenceEnd = source.indexOf("spellRarityCeiling,", persistenceStart);
    const persistenceBlock = source.slice(persistenceStart, persistenceEnd);

    expect(persistenceStart).toBeGreaterThan(-1);
    expect(persistenceEnd).toBeGreaterThan(persistenceStart);
    expect(persistenceBlock).toContain("const lockedApplyCandidate = applyCandidate.value;");
    expect(persistenceBlock).toContain("this.#draftWriteGuard.assertCurrent(currentCandidate);");
    expect(persistenceBlock).toContain("recordAcquisitionCurrencyConvergenceWitness(");
    expect(persistenceBlock).toContain("await saveDraftWithWriteGuard(");
    expect(persistenceBlock).toContain("applyCandidate.value = cloneData(persistedEnrichedCandidate);");
    expect(persistenceBlock).not.toContain("this.#draftPersistence");
    expect(persistenceBlock.indexOf("await saveDraftWithWriteGuard(")).toBeLessThan(
      persistenceBlock.indexOf("applyCandidate.value = cloneData(persistedEnrichedCandidate);")
    );
  });

  it("persists typed currency convergence evidence through the locked failed-Apply draft path", () => {
    const source = readFileSync(new URL("../src/wayfinder/app-shell.ts", import.meta.url), "utf8");
    const recoveryStart = source.indexOf("let recoverableDraft = cloneData(persistedApplyCandidate);");
    const persistenceEnd = source.indexOf("await this.#draftPersistence.flush();", recoveryStart);
    const recoveryBlock = source.slice(recoveryStart, persistenceEnd);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(persistenceEnd).toBeGreaterThan(recoveryStart);
    expect(recoveryBlock).toContain("error instanceof DraftApplyPhaseError");
    expect(recoveryBlock).toContain("error.acquisitionCurrencyConvergenceWitness");
    expect(recoveryBlock).toContain("recordAcquisitionCurrencyConvergenceWitness(");
    expect(recoveryBlock.indexOf("recordAcquisitionCurrencyConvergenceWitness(")).toBeLessThan(
      recoveryBlock.indexOf("this.#draftPersistence.schedule(recoverableDraft, { force: true })")
    );
  });
});
