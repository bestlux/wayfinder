/* global Actor, CONFIG, CONST, document, game */

globalThis.__runWayfinderSmokeSuite = async function runWayfinderSmokeSuite({
  cases,
  allowDestructive = false,
  expectedWorldId = "",
  fixturePrefix,
  incrementalCases = [],
  keepActors,
  moduleId,
}) {
  const startedAt = new Date().toISOString();
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) {
    throw new Error(`${moduleId} is not active in this world.`);
  }
  if (!keepActors && !String(expectedWorldId ?? "").trim()) {
    throw new Error("Foundry smoke cleanup/deletion requires an expected world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!keepActors && !allowDestructive) {
    throw new Error("Foundry smoke cleanup/deletion requires destructive opt-in.");
  }

  if (!keepActors) {
    await cleanupActors(fixturePrefix);
  }
  const modules = await loadWayfinderModules(moduleId);
  const results = [];

  for (const smokeCase of cases) {
    console.log(`WFSMOKE case start ${smokeCase.id}`);
    const result = await runSmokeCase(smokeCase, modules, { keepActors, moduleId, prefix: fixturePrefix });
    console.log(`WFSMOKE case ${result.status} ${smokeCase.id}`);
    results.push(result);
  }

  for (const smokeCase of incrementalCases) {
    console.log(`WFSMOKE incremental case start ${smokeCase.id}`);
    const result = await runIncrementalExistingCase(smokeCase, modules, {
      keepActors,
      moduleId,
      prefix: fixturePrefix,
    });
    console.log(`WFSMOKE incremental case ${result.status} ${smokeCase.id}`);
    results.push(result);
  }

  const summary = {
    classified: results.filter((entry) => entry.status === "classified").length,
    failed: results.filter((entry) => entry.status === "fail").length,
    passed: results.filter((entry) => entry.status === "pass").length,
  };

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    foundryVersion: game.version ?? null,
    moduleActive: true,
    moduleId,
    moduleVersion: moduleRecord.version ?? moduleRecord.manifest?.version ?? null,
    pf2eVersion: game.system?.version ?? null,
    summary,
    user: game.user?.name ?? null,
    world: game.world?.id ?? null,
    cases: results,
  };
};

async function loadWayfinderModules(moduleId) {
  const [
    draftService,
    actorInspector,
    planBuilder,
    buildState,
    packAccess,
    packOptions,
    pickerState,
    optionContext,
    planService,
    actorUpdater,
    draftLifecycle,
    slotIds,
    slug,
    sourceId,
  ] = await Promise.all([
    import(`/modules/${moduleId}/scripts/draft-service.js`),
    import(`/modules/${moduleId}/scripts/actor-inspector.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/wayfinder-plan-builder-service.js`),
    import(`/modules/${moduleId}/scripts/build-state.js`),
    import(`/modules/${moduleId}/scripts/pack/access.js`),
    import(`/modules/${moduleId}/scripts/pack/options.js`),
    import(`/modules/${moduleId}/scripts/pack/picker-state.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/option-context-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/plan-service.js`),
    import(`/modules/${moduleId}/scripts/actor-updater.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/draft-lifecycle-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/slot-ids.js`),
    import(`/modules/${moduleId}/scripts/shared/slug.js`),
    import(`/modules/${moduleId}/scripts/shared/source-id.js`),
  ]);

  return {
    applyDraftLifecycle: draftLifecycle.applyDraftLifecycle,
    applyDraftToActor: actorUpdater.applyDraftToActor,
    buildOptionContext: optionContext.buildOptionContext,
    buildWayfinderAppPlan: planBuilder.buildWayfinderAppPlan,
    createEmptyDraft: draftService.createEmptyDraft,
    extractDocumentSlug: slug.extractDocumentSlug,
    fetchSelectionDocument: packAccess.fetchSelectionDocument,
    getEffectiveBuildState: buildState.getEffectiveBuildState,
    getEffectiveSingletonDocument: buildState.getEffectiveSingletonDocument,
    getOptionsForStep: packOptions.getOptionsForStep,
    getPickerBlockedState: pickerState.getPickerBlockedState,
    inspectActor: actorInspector.inspectActor,
    isWayfinderStepComplete: planService.isWayfinderStepComplete,
    isWizardArcaneSchoolSlotId: slotIds.isWizardArcaneSchoolSlotId,
    listActorItems: buildState.listActorItems,
    resolveSelection: packOptions.resolveSelection,
    sourceIdOf: sourceId.sourceIdOf,
  };
}

async function runSmokeCase(smokeCase, modules, { keepActors, moduleId, prefix }) {
  let actor = null;
  const warnings = [];
  const classifications = [];
  const failures = [];

  try {
    actor = await Actor.create({
      name: `${prefix} - ${smokeCase.id}`,
      type: "character",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      system: { details: { level: { value: 1 } } },
    });
    await seedActorSkillRanks(actor, smokeCase);
    await seedActorItems(actor, smokeCase, failures);

    const draft = modules.createEmptyDraft(smokeCase.targetLevel);
    await seedCreationDraft(draft, smokeCase);
    console.log(`WFSMOKE ${smokeCase.id} fill start`);
    const fillResult = await completeDraft(actor, draft, smokeCase, modules);
    warnings.push(...fillResult.warnings);
    classifications.push(...fillResult.classifications);

    console.log(`WFSMOKE ${smokeCase.id} plan/apply start`);
    const plan = await buildPlan(actor, draft, modules);
    const incompleteBeforeApply = await incompleteSteps(actor, draft, plan.steps, modules);
    if (incompleteBeforeApply.length > 0) {
      failures.push(`Incomplete before apply: ${incompleteBeforeApply.map((step) => step.slotId).join(", ")}`);
    }

    const dialogsBefore = dialogCount();
    await actor.setFlag(moduleId, "draft", draft);
    const lifecycleResult = failures.length
      ? { kind: "warning", warning: "missing-selections" }
      : await withTimeout(
          modules.applyDraftLifecycle({
            actorName: actor.name,
            currentLevel: 1,
            draft,
            steps: plan.steps,
            isStepComplete: (step) => isStepComplete(actor, draft, step, modules),
            confirmApply: () => true,
            applyDraftToActor: () =>
              modules.applyDraftToActor(actor, draft, plan.steps, {
                deferActorUpdate: true,
              }),
            updateActor: (update) => actor.update(update),
            now: () => new Date().toISOString(),
          }),
          45000,
          `${smokeCase.id} apply timed out`,
        );

    await wait(1500);
    console.log(`WFSMOKE ${smokeCase.id} rerun check`);
    const dialogsAfter = dialogCount();
    const rerunDraft = modules.createEmptyDraft(smokeCase.targetLevel);
    const rerunPlan = await buildPlan(actor, rerunDraft, modules);
    const actorEvidence = collectActorEvidence(actor, modules, moduleId);
    validateAppliedCase({
      actorEvidence,
      classifications,
      dialogsAfter,
      dialogsBefore,
      failures,
      lifecycleResult,
      preStepIds: plan.steps.map((step) => step.slotId),
      rerunPlan,
      smokeCase,
    });

    return {
      id: smokeCase.id,
      label: smokeCase.label,
      status: statusFor(failures, classifications),
      actor: actorEvidence,
      classifications,
      evidence: {
        dialogsAfter,
        dialogsBefore,
        fillIterations: fillResult.iterations,
        incompleteBeforeApply: incompleteBeforeApply.map(stepSummary),
        preStepIds: plan.steps.map((step) => step.slotId),
        rerunStepIds: rerunPlan.steps.map((step) => step.slotId),
        warnings,
      },
      failures,
      warnings,
    };
  } catch (error) {
    return {
      id: smokeCase.id,
      label: smokeCase.label,
      status: "fail",
      actor: actor ? collectActorEvidence(actor, modules, moduleId) : null,
      classifications,
      evidence: {},
      failures: [errorToString(error)],
      warnings,
    };
  } finally {
    if (actor && !keepActors) {
      await actor.delete();
    }
  }
}

async function runIncrementalExistingCase(smokeCase, modules, { keepActors, moduleId, prefix }) {
  let actor = null;
  const warnings = [];
  const classifications = [];
  const failures = [];

  try {
    actor = await Actor.create({
      name: `${prefix} - incremental - ${smokeCase.id}`,
      type: "character",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      system: { details: { level: { value: 1 } } },
    });

    const initialCase = { ...smokeCase, targetLevel: 1 };
    const initialDraft = modules.createEmptyDraft(initialCase.targetLevel);
    await seedCreationDraft(initialDraft, initialCase);
    const initialFill = await completeDraft(actor, initialDraft, initialCase, modules);
    warnings.push(...initialFill.warnings.map((entry) => `initial: ${entry}`));
    classifications.push(...initialFill.classifications.map((entry) => `initial: ${entry}`));

    const initialPlan = await buildPlan(actor, initialDraft, modules);
    const initialIncomplete = await incompleteSteps(actor, initialDraft, initialPlan.steps, modules);
    if (initialIncomplete.length > 0) {
      failures.push(`Initial incomplete before apply: ${initialIncomplete.map((step) => step.slotId).join(", ")}`);
    }

    const dialogsBefore = dialogCount();
    await actor.setFlag(moduleId, "draft", initialDraft);
    const initialLifecycleResult = failures.length
      ? { kind: "warning", warning: "missing-selections" }
      : await applyCompletedDraft(actor, initialDraft, initialPlan.steps, modules, moduleId);
    if (initialLifecycleResult.kind !== "applied") {
      failures.push(`Initial apply lifecycle returned ${initialLifecycleResult.kind}`);
    }

    const incrementalDraft = modules.createEmptyDraft(smokeCase.targetLevel);
    const incrementalFill = await completeDraft(actor, incrementalDraft, smokeCase, modules);
    warnings.push(...incrementalFill.warnings.map((entry) => `incremental: ${entry}`));
    classifications.push(...incrementalFill.classifications.map((entry) => `incremental: ${entry}`));

    const incrementalPlan = await buildPlan(actor, incrementalDraft, modules);
    console.log(
      `WFSMOKE ${smokeCase.id} incremental plan ${incrementalPlan.steps.map((step) => step.slotId).join(",")}`,
    );
    const incrementalIncomplete = await incompleteSteps(actor, incrementalDraft, incrementalPlan.steps, modules);
    if (incrementalIncomplete.length > 0) {
      failures.push(
        `Incremental incomplete before apply: ${incrementalIncomplete.map((step) => step.slotId).join(", ")}`,
      );
    }
    if (incrementalPlan.steps.length === 0) {
      failures.push("Incremental rerun produced no level-up steps.");
    }

    await actor.setFlag(moduleId, "draft", incrementalDraft);
    const incrementalLifecycleResult = failures.length
      ? { kind: "warning", warning: "missing-selections" }
      : await applyCompletedDraft(actor, incrementalDraft, incrementalPlan.steps, modules, moduleId);

    await wait(1500);
    const dialogsAfter = dialogCount();
    const rerunDraft = modules.createEmptyDraft(smokeCase.targetLevel);
    const rerunPlan = await buildPlan(actor, rerunDraft, modules);
    const actorEvidence = collectActorEvidence(actor, modules, moduleId);
    validateIncrementalCase({
      actorEvidence,
      classifications,
      dialogsAfter,
      dialogsBefore,
      failures,
      initialLifecycleResult,
      initialStepIds: initialPlan.steps.map((step) => step.slotId),
      incrementalLifecycleResult,
      incrementalStepIds: incrementalPlan.steps.map((step) => step.slotId),
      rerunPlan,
      smokeCase,
    });

    return {
      id: `${smokeCase.id}-incremental-existing`,
      label: `${smokeCase.label} incremental existing-character rerun`,
      status: statusFor(failures, classifications),
      actor: actorEvidence,
      classifications,
      evidence: {
        dialogsAfter,
        dialogsBefore,
        incrementalIncompleteBeforeApply: incrementalIncomplete.map(stepSummary),
        incrementalStepIds: incrementalPlan.steps.map((step) => step.slotId),
        initialIncompleteBeforeApply: initialIncomplete.map(stepSummary),
        initialStepIds: initialPlan.steps.map((step) => step.slotId),
        rerunStepIds: rerunPlan.steps.map((step) => step.slotId),
        warnings,
      },
      failures,
      warnings,
    };
  } catch (error) {
    return {
      id: `${smokeCase.id}-incremental-existing`,
      label: `${smokeCase.label} incremental existing-character rerun`,
      status: "fail",
      actor: actor ? collectActorEvidence(actor, modules, moduleId) : null,
      classifications,
      evidence: {},
      failures: [errorToString(error)],
      warnings,
    };
  } finally {
    if (actor && !keepActors) {
      await actor.delete();
    }
  }
}

async function seedCreationDraft(draft, smokeCase) {
  draft.selections["ancestry-level-1"] = await selectionRef(
    "pf2e.ancestries",
    smokeCase.ancestryName ?? "Human",
    "ancestry-level-1",
  );
  draft.selections["heritage-level-1"] = await selectionRef(
    "pf2e.heritages",
    smokeCase.heritageName ?? "Wintertouched Human",
    "heritage-level-1",
  );
  draft.selections["background-level-1"] = await selectionRef(
    "pf2e.backgrounds",
    smokeCase.backgroundName ?? "Acolyte",
    "background-level-1",
  );
  draft.selections["class-level-1"] = await selectionRef("pf2e.classes", smokeCase.className, "class-level-1");
  if (smokeCase.deityName) {
    draft.selections["deity-level-1"] = await selectionRef("pf2e.deities", smokeCase.deityName, "deity-level-1");
  }

  const ancestryBoosts = uniqueAbilities([smokeCase.keyAbility, "dex", "con"]);
  draft.boosts.ancestry.modeTouched = true;
  draft.boosts.ancestry.selectedBoosts = smokeCase.ancestryBoosts ?? {
    "0": ancestryBoosts[0],
    "1": ancestryBoosts[1],
  };
  draft.boosts.background.selectedBoosts = smokeCase.backgroundBoosts ?? {
    "0": "wis",
    "1": "con",
  };
  draft.boosts.class.keyAbility = smokeCase.keyAbility;
  draft.boosts.levels["1"] = levelBoosts(smokeCase.keyAbility);
  if (draft.targetLevel >= 5) {
    draft.boosts.levels["5"] = levelBoosts(smokeCase.keyAbility);
  }
}

async function completeDraft(actor, draft, smokeCase, modules) {
  const warnings = [];
  const classifications = [];
  let iterations = 0;

  for (; iterations < 12; iterations += 1) {
    const plan = await buildPlan(actor, draft, modules);
    let changed = false;

    for (const step of plan.steps) {
      if (await isStepComplete(actor, draft, step, modules)) {
        continue;
      }

      const before = JSON.stringify(draft);
      await fillStep(actor, draft, step, plan.steps, smokeCase, modules, { classifications, warnings });
      changed = changed || before !== JSON.stringify(draft);
    }

    const nextPlan = await buildPlan(actor, draft, modules);
    const remaining = await incompleteSteps(actor, draft, nextPlan.steps, modules);
    if (remaining.length === 0) {
      return { classifications, iterations: iterations + 1, warnings };
    }

    if (!changed) {
      warnings.push(`Could not auto-complete: ${remaining.map((step) => step.slotId).join(", ")}`);
      return { classifications, iterations: iterations + 1, warnings };
    }
  }

  warnings.push("Draft fill reached iteration limit.");
  return { classifications, iterations, warnings };
}

async function fillStep(actor, draft, step, planSteps, smokeCase, modules, notes) {
  switch (step.kind) {
    case "pick-item":
    case "class-branch": {
      const optionContext = await buildPickerContext(actor, draft, planSteps, modules);
      const blocked = modules.getPickerBlockedState(step, optionContext);
      if (blocked) {
        notes.classifications.push(`${step.slotId}: picker blocked: ${blocked.title}`);
        return;
      }
      const options = await modules.getOptionsForStep(step, optionContext);
      const option = pickOption(options, step, smokeCase);
      if (!option) {
        notes.classifications.push(`${step.slotId}: no live compendium option matched supported filters`);
        return;
      }

      const resolved = await modules.resolveSelection(option.value, step, optionContext);
      if (!resolved) {
        notes.warnings.push(`${step.slotId}: option ${option.name} could not resolve`);
        return;
      }

      if (step.kind === "class-branch") {
        draft.branchSelections[step.slotId] = resolved;
      } else {
        draft.selections[step.slotId] = resolved;
      }
      return;
    }
    case "class-choice": {
      const option = pickInlineOption(step.classChoice.options, step, smokeCase);
      if (option) {
        draft.classChoices[step.slotId] = option.value;
      }
      return;
    }
    case "class-archetype": {
      const option = pickInlineOption(step.classArchetype.options, step, smokeCase);
      if (option) {
        draft.classArchetypeChoices[step.slotId] = option.value;
      }
      return;
    }
    case "singleton-choice": {
      const option = pickInlineOption(step.singletonChoice.options, step, smokeCase);
      if (option) {
        draft.singletonChoices[step.slotId] = option.value;
      }
      return;
    }
    case "language-choice": {
      const values = step.languageChoice.options.map((option) => option.value).slice(0, step.languageChoice.count);
      if (values.length === step.languageChoice.count) {
        draft.languageChoices[step.slotId] = values;
      }
      return;
    }
    case "spell-choice": {
      const optionContext = await buildPickerContext(actor, draft, planSteps, modules);
      const blocked = modules.getPickerBlockedState(step, optionContext);
      if (blocked) {
        notes.classifications.push(`${step.slotId}: picker blocked: ${blocked.title}`);
        return;
      }
      const options = await modules.getOptionsForStep(step, optionContext);
      if (options.length === 0) {
        notes.classifications.push(`${step.slotId}: spell progression is PF2E-native/manual for this live data shape`);
        return;
      }

      const selectedOptions = pickOptions(options, step, smokeCase, step.spellChoice.count);
      const selections = (
        await Promise.all(
          selectedOptions.map((option) => modules.resolveSelection(option.value, step, optionContext)),
        )
      ).filter(Boolean);
      if (selections.length === step.spellChoice.count) {
        draft.spellChoices[step.slotId] = selections;
      } else {
        notes.warnings.push(`${step.slotId}: only ${selections.length} of ${step.spellChoice.count} spells resolved`);
      }
      return;
    }
    case "skill-training":
      fillSkillTraining(draft, step, smokeCase);
      return;
    case "skill-increase":
      fillSkillIncrease(draft, step, smokeCase);
      return;
    case "boost":
      draft.boosts.levels[String(step.level)] = levelBoosts(smokeCase.keyAbility);
      return;
    case "manual":
      notes.classifications.push(`${step.slotId}: manual PF2E-native checkpoint`);
      return;
  }
}

async function buildPlan(actor, draft, modules) {
  const snapshot = modules.inspectActor(actor);
  return modules.buildWayfinderAppPlan({
    actor,
    snapshot,
    draft,
    resolveArcaneSchoolDocument: () => resolveArcaneSchoolDocument(actor, draft, modules),
    resolveDocument: (itemType) => modules.getEffectiveSingletonDocument(actor, draft, itemType),
    localize: (value) => game.i18n.localize(value),
  });
}

async function resolveArcaneSchoolDocument(actor, draft, modules) {
  const draftSelection = Object.values(draft.branchSelections).find((selection) =>
    modules.isWizardArcaneSchoolSlotId(selection.slotId),
  );
  if (draftSelection) {
    return modules.fetchSelectionDocument(draftSelection);
  }

  return (
    modules.listActorItems(actor).find((item) => {
      const tags = Array.isArray(item?.system?.traits?.otherTags) ? item.system.traits.otherTags : [];
      return tags.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "wizard-arcane-school");
    }) ?? null
  );
}

async function buildPickerContext(actor, draft, planSteps, modules) {
  const snapshot = modules.inspectActor(actor);
  return modules.buildOptionContext({
    draft,
    steps: planSteps,
    skillRanks: snapshot.skillRanks,
    resolveDocument: (itemType) => modules.getEffectiveSingletonDocument(actor, draft, itemType),
    listActorItems: () => modules.listActorItems(actor),
    fetchSelectionDocument: modules.fetchSelectionDocument,
    extractDocumentSlug: modules.extractDocumentSlug,
  });
}

async function isStepComplete(actor, draft, step, modules) {
  const effectiveBuildState = await modules.getEffectiveBuildState(actor, draft);
  return modules.isWayfinderStepComplete(step, draft, effectiveBuildState, {
    isTrainingStepComplete: (trainingStep) => isTrainingComplete(draft, trainingStep),
  });
}

async function incompleteSteps(actor, draft, steps, modules) {
  const results = [];
  for (const step of steps) {
    if (!(await isStepComplete(actor, draft, step, modules))) {
      results.push(step);
    }
  }
  return results;
}

async function applyCompletedDraft(actor, draft, steps, modules, moduleId) {
  const snapshot = modules.inspectActor(actor);
  return withTimeout(
    modules.applyDraftLifecycle({
      actorName: actor.name,
      currentLevel: snapshot.level,
      draft,
      existingCompletedStepIds: readActorCompletedStepIds(actor, moduleId),
      steps,
      isStepComplete: (step) => isStepComplete(actor, draft, step, modules),
      confirmApply: () => true,
      applyDraftToActor: () =>
        modules.applyDraftToActor(actor, draft, steps, {
          deferActorUpdate: true,
        }),
      updateActor: (update) => actor.update(update),
      now: () => new Date().toISOString(),
    }),
    45000,
    `${actor.name} apply timed out`,
  );
}

function readActorCompletedStepIds(actor, moduleId) {
  const completedStepIds = actor.getFlag(moduleId, "state")?.completedStepIds;
  return Array.isArray(completedStepIds)
    ? completedStepIds.filter((stepId) => typeof stepId === "string")
    : [];
}

function fillSkillTraining(draft, step, smokeCase) {
  const preferred = smokeCase.preferredSkills ?? [];
  const used = new Set([...step.training.fixedSkills]);
  const ruleChoices = {};
  const loreChoices = {};
  const additional = [];

  for (const choice of step.training.choiceRules) {
    const options = [...choice.options, ...(choice.fallbackOptions ?? [])].map((option) => option.slug);
    const explicitSelection =
      smokeCase.preferredRuleChoices?.[choice.key] ?? smokeCase.preferredRuleChoices?.[choice.flag];
    const selection =
      (options.includes(explicitSelection) && !used.has(explicitSelection) ? explicitSelection : null) ??
      preferred.find((skill) => options.includes(skill) && !used.has(skill)) ??
      options[0];
    if (selection) {
      ruleChoices[choice.key] = selection;
      used.add(selection);
    }
  }

  for (const choice of step.training.loreChoices) {
    loreChoices[choice.key] = "Wayfinding Lore";
  }

  for (const skill of preferred) {
    if (additional.length >= step.training.additionalCount) {
      break;
    }

    if (!used.has(skill)) {
      additional.push(skill);
      used.add(skill);
    }
  }

  for (const option of Object.keys(CONFIG.PF2E?.skills ?? {})) {
    if (additional.length >= step.training.additionalCount) {
      break;
    }

    if (!used.has(option)) {
      additional.push(option);
      used.add(option);
    }
  }

  draft.skillTrainings[step.slotId] = { additional, loreChoices, ruleChoices };
}

function fillSkillIncrease(draft, step, smokeCase) {
  const preferred = smokeCase.preferredSkills ?? [];
  const existing = new Set(Object.values(draft.skillIncreases));
  const selection = preferred.find((skill) => !existing.has(skill)) ?? preferred[0] ?? "athletics";
  draft.skillIncreases[step.slotId] = selection;
}

function isTrainingComplete(draft, step) {
  const training = draft.skillTrainings[step.slotId];
  if (!training) {
    return false;
  }

  return (
    step.training.choiceRules.every((rule) => typeof training.ruleChoices[rule.key] === "string") &&
    training.additional.length === step.training.additionalCount &&
    step.training.loreChoices.every((choice) => typeof training.loreChoices[choice.key] === "string")
  );
}

function pickOption(options, step, smokeCase) {
  const preferred = [
    ...(smokeCase.preferredSelections?.[step.slotId] ?? []),
    ...(smokeCase.preferredSelections?.[step.slotKind] ?? []),
  ];
  for (const name of preferred) {
    const found = options.find((option) => namesMatch(option.name, name));
    if (found) {
      return found;
    }
  }

  if (step.slotKind === "class-feat") {
    const classOption = options.find((option) => option.traits.includes(smokeCase.classSlug));
    if (classOption) {
      return classOption;
    }
  }

  if (step.slotKind === "deity" && smokeCase.deityName) {
    const deity = options.find((option) => namesMatch(option.name, smokeCase.deityName));
    if (deity) {
      return deity;
    }
  }

  return options[0] ?? null;
}

function pickOptions(options, step, smokeCase, count) {
  const preferred = [
    ...(smokeCase.preferredSelections?.[step.slotId] ?? []),
    ...(smokeCase.preferredSelections?.[step.slotKind] ?? []),
  ];
  const selected = [];
  for (const name of preferred) {
    const found = options.find(
      (option) => namesMatch(option.name, name) && !selected.some((entry) => entry.uuid === option.uuid),
    );
    if (found) {
      selected.push(found);
    }
    if (selected.length >= count) {
      return selected;
    }
  }

  for (const option of options) {
    if (!selected.some((entry) => entry.uuid === option.uuid)) {
      selected.push(option);
    }
    if (selected.length >= count) {
      break;
    }
  }
  return selected;
}

function pickInlineOption(options, step, smokeCase) {
  const preferred = [
    ...(smokeCase.preferredSelections?.[step.slotId] ?? []),
    ...(smokeCase.preferredSelections?.[step.slotKind] ?? []),
  ];
  for (const name of preferred) {
    const found = options.find((option) => namesMatch(option.label, name));
    if (found) {
      return found;
    }
  }

  return options[0] ?? null;
}

function collectActorEvidence(actor, modules, moduleId) {
  const items = modules.listActorItems(actor).map((item) => ({
    id: item.id,
    name: item.name,
    slotId: item.flags?.[moduleId]?.slotId ?? null,
    destinationKey: item.flags?.[moduleId]?.destinationKey ?? null,
    grantedById: item.flags?.pf2e?.grantedBy?.id ?? null,
    grantRules: (Array.isArray(item.system?.rules) ? item.system.rules : []).flatMap((rule) =>
      rule?.key === "GrantItem"
        ? [
            {
              allowDuplicate: rule.allowDuplicate ?? null,
              flag: rule.flag ?? null,
              uuid: rule.uuid ?? null,
            },
          ]
        : [],
    ),
    location:
      typeof item.system?.location === "string" ? item.system.location : (item.system?.location?.value ?? null),
    ruleSelections: item.flags?.pf2e?.rulesSelections ?? {},
    sourceId: modules.sourceIdOf(item),
    spellcasting:
      item.type === "spellcastingEntry"
        ? {
            ability: item.system?.ability?.value ?? null,
            prepared: item.system?.prepared?.value ?? null,
            proficiencySlug: item.system?.proficiency?.slug ?? null,
            slots: Object.fromEntries(
              Object.entries(item.system?.slots ?? {}).map(([slotKey, group]) => [
                slotKey,
                {
                  max: Number(group?.max ?? 0),
                  prepared: Array.isArray(group?.prepared)
                    ? group.prepared.map((slot) => slot?.id ?? null)
                    : [],
                },
              ]),
            ),
            tradition: item.system?.tradition?.value ?? null,
          }
        : null,
    trainingKey: item.flags?.[moduleId]?.trainingKey ?? null,
    type: item.type,
  }));
  // Lore items are identified by slotId + trainingKey in the apply-side
  // reconciler, so multiple lores may legitimately share one training slot.
  const slotIds = items
    .map((item) => (item.trainingKey ? `${item.slotId}:${item.trainingKey}` : item.slotId))
    .filter(Boolean);
  const sourceIds = items
    .map((item) =>
      item.sourceId ? (item.type === "spell" ? `${item.sourceId}@${item.location ?? "unplaced"}` : item.sourceId) : null,
    )
    .filter(Boolean);

  return {
    id: actor.id,
    duplicateSlotIds: duplicates(slotIds),
    duplicateSourceIds: duplicates(sourceIds),
    itemCount: items.length,
    items: items.sort((left, right) =>
      `${left.slotId ?? ""}:${left.name}`.localeCompare(`${right.slotId ?? ""}:${right.name}`),
    ),
    levelAfterApply: Number(actor.system?.details?.level?.value ?? 0),
    moduleDraftAfterApply: actor.getFlag(moduleId, "draft") ?? null,
    moduleStateAfterApply: actor.getFlag(moduleId, "state") ?? null,
    skillRanks: Object.fromEntries(
      Object.entries(actor.system?.skills ?? {}).map(([slug, value]) => [slug, value?.rank ?? 0]),
    ),
  };
}

function validateAppliedCase({
  actorEvidence,
  classifications,
  dialogsAfter,
  dialogsBefore,
  failures,
  lifecycleResult,
  preStepIds,
  rerunPlan,
  smokeCase,
}) {
  const expectedStepIds = Array.isArray(smokeCase.expectedStepIds) ? smokeCase.expectedStepIds : [];
  const missingExpectedStepIds = expectedStepIds.filter((slotId) => !preStepIds.includes(slotId));
  if (missingExpectedStepIds.length > 0) {
    failures.push(`Expected steps did not render: ${missingExpectedStepIds.join(", ")}`);
  }

  const forbiddenStepIds = Array.isArray(smokeCase.forbiddenStepIds) ? smokeCase.forbiddenStepIds : [];
  const renderedForbiddenStepIds = forbiddenStepIds.filter((slotId) => preStepIds.includes(slotId));
  if (renderedForbiddenStepIds.length > 0) {
    failures.push(`Forbidden steps rendered: ${renderedForbiddenStepIds.join(", ")}`);
  }

  validateActorExpectations(actorEvidence, smokeCase, failures);

  if (lifecycleResult.kind !== "applied") {
    failures.push(`Apply lifecycle returned ${lifecycleResult.kind}`);
  }

  if (actorEvidence.levelAfterApply !== smokeCase.targetLevel) {
    failures.push(`Actor level is ${actorEvidence.levelAfterApply}, expected ${smokeCase.targetLevel}`);
  }

  if (actorEvidence.moduleDraftAfterApply !== null) {
    failures.push("Draft flag was not cleared after apply.");
  }

  const unexpectedDuplicateSlotIds = actorEvidence.duplicateSlotIds.filter(
    (slotId) =>
      !slotId.startsWith("class-archetype-") &&
      !slotId.startsWith("class-branch-") &&
      !slotId.startsWith("deity-level-") &&
      !slotId.startsWith("grant-choice-") &&
      !slotId.startsWith("spell-choice-"),
  );
  if (unexpectedDuplicateSlotIds.length > 0) {
    failures.push(`Duplicate Wayfinder slot ids: ${unexpectedDuplicateSlotIds.join(", ")}`);
  }

  if (actorEvidence.duplicateSourceIds.length > 0) {
    failures.push(`Duplicate source ids: ${actorEvidence.duplicateSourceIds.join(", ")}`);
  }

  if (dialogsAfter > dialogsBefore) {
    failures.push(`Native dialog count increased from ${dialogsBefore} to ${dialogsAfter}`);
  }

  if (rerunPlan.steps.length > 0) {
    failures.push(`Rerun still has pending steps: ${rerunPlan.steps.map((step) => step.slotId).join(", ")}`);
  }

  if (classifications.length > 0) {
    failures.push("Case has unsupported/manual classifications; apply should not have proceeded.");
  }
}

function validateIncrementalCase({
  actorEvidence,
  classifications,
  dialogsAfter,
  dialogsBefore,
  failures,
  initialLifecycleResult,
  initialStepIds,
  incrementalLifecycleResult,
  incrementalStepIds,
  rerunPlan,
  smokeCase,
}) {
  if (initialLifecycleResult.kind !== "applied") {
    failures.push(`Initial apply lifecycle returned ${initialLifecycleResult.kind}`);
  }

  if (incrementalLifecycleResult.kind !== "applied") {
    failures.push(`Incremental apply lifecycle returned ${incrementalLifecycleResult.kind}`);
  }

  if (initialStepIds.length === 0) {
    failures.push("Initial creation produced no Wayfinder steps.");
  }

  if (incrementalStepIds.length === 0) {
    failures.push("Incremental level-up produced no Wayfinder steps.");
  }

  const expectedStepIds = Array.isArray(smokeCase.expectedStepIds) ? smokeCase.expectedStepIds : [];
  const plannedStepIds = new Set([...initialStepIds, ...incrementalStepIds]);
  const missingExpectedStepIds = expectedStepIds.filter((slotId) => !plannedStepIds.has(slotId));
  if (missingExpectedStepIds.length > 0) {
    failures.push(`Expected steps did not render: ${missingExpectedStepIds.join(", ")}`);
  }

  const forbiddenStepIds = Array.isArray(smokeCase.forbiddenStepIds) ? smokeCase.forbiddenStepIds : [];
  const renderedForbiddenStepIds = forbiddenStepIds.filter((slotId) => plannedStepIds.has(slotId));
  if (renderedForbiddenStepIds.length > 0) {
    failures.push(`Forbidden steps rendered: ${renderedForbiddenStepIds.join(", ")}`);
  }

  validateActorExpectations(actorEvidence, smokeCase, failures);

  if (actorEvidence.levelAfterApply !== smokeCase.targetLevel) {
    failures.push(`Actor level is ${actorEvidence.levelAfterApply}, expected ${smokeCase.targetLevel}`);
  }

  if (actorEvidence.moduleDraftAfterApply !== null) {
    failures.push("Draft flag was not cleared after incremental apply.");
  }

  const unexpectedDuplicateSlotIds = actorEvidence.duplicateSlotIds.filter(
    (slotId) =>
      !slotId.startsWith("class-archetype-") &&
      !slotId.startsWith("class-branch-") &&
      !slotId.startsWith("deity-level-") &&
      !slotId.startsWith("grant-choice-") &&
      !slotId.startsWith("spell-choice-"),
  );
  if (unexpectedDuplicateSlotIds.length > 0) {
    failures.push(`Duplicate Wayfinder slot ids: ${unexpectedDuplicateSlotIds.join(", ")}`);
  }

  if (actorEvidence.duplicateSourceIds.length > 0) {
    failures.push(`Duplicate source ids: ${actorEvidence.duplicateSourceIds.join(", ")}`);
  }

  if (dialogsAfter > dialogsBefore) {
    failures.push(`Native dialog count increased from ${dialogsBefore} to ${dialogsAfter}`);
  }

  if (rerunPlan.steps.length > 0) {
    failures.push(`Rerun still has pending steps: ${rerunPlan.steps.map((step) => step.slotId).join(", ")}`);
  }

  if (classifications.length > 0) {
    failures.push("Case has unsupported/manual classifications; incremental apply should not have proceeded.");
  }
}

function validateActorExpectations(actorEvidence, smokeCase, failures) {
  const expectedItemNames = Array.isArray(smokeCase.expectedItemNames) ? smokeCase.expectedItemNames : [];
  const missingItemNames = expectedItemNames.filter(
    (name) => !actorEvidence.items.some((item) => item.name === name),
  );
  if (missingItemNames.length > 0) {
    failures.push(`Expected actor items are missing: ${missingItemNames.join(", ")}`);
  }

  const forbiddenItemNames = Array.isArray(smokeCase.forbiddenItemNames) ? smokeCase.forbiddenItemNames : [];
  const presentForbiddenItemNames = forbiddenItemNames.filter((name) =>
    actorEvidence.items.some((item) => item.name === name),
  );
  if (presentForbiddenItemNames.length > 0) {
    failures.push(`Forbidden actor items are present: ${presentForbiddenItemNames.join(", ")}`);
  }

  for (const [name, expectedCount] of Object.entries(smokeCase.expectedItemNameCounts ?? {})) {
    const actualCount = actorEvidence.items.filter((item) => item.name === name).length;
    if (actualCount !== expectedCount) {
      failures.push(`Actor item count for ${name} is ${actualCount}, expected ${expectedCount}`);
    }
  }

  for (const [slug, expectedRank] of Object.entries(smokeCase.expectedSkillRanks ?? {})) {
    const actualRank = actorEvidence.skillRanks[slug] ?? 0;
    if (actualRank !== expectedRank) {
      failures.push(`Actor skill rank for ${slug} is ${actualRank}, expected ${expectedRank}`);
    }
  }

  for (const [itemName, expectedSelections] of Object.entries(smokeCase.expectedItemRuleSelections ?? {})) {
    const item = actorEvidence.items.find((candidate) => candidate.name === itemName);
    for (const [flag, expectedValue] of Object.entries(expectedSelections)) {
      const actualValue = item?.ruleSelections?.[flag];
      if (actualValue !== expectedValue) {
        failures.push(`${itemName} rule selection ${flag} is ${actualValue ?? "missing"}, expected ${expectedValue}`);
      }
    }
  }

  for (const [itemName, expectedLocation] of Object.entries(smokeCase.expectedItemLocations ?? {})) {
    const item = actorEvidence.items.find((candidate) => candidate.name === itemName);
    if (!item || item.location !== expectedLocation) {
      failures.push(`${itemName} location is ${item?.location ?? "missing"}, expected ${expectedLocation}`);
    }
  }

  for (const expectation of smokeCase.expectedGrantReplacements ?? []) {
    const source = actorEvidence.items.find((item) => item.name === expectation.sourceItemName);
    const rule = source?.grantRules?.find((candidate) => candidate.flag === expectation.flag);
    if (!source?.id || !rule?.uuid || expectation.originalUuids.includes(rule.uuid)) {
      failures.push(`${expectation.sourceItemName} did not replace the ${expectation.flag} GrantItem rule`);
      continue;
    }

    const grantedItem = actorEvidence.items.find(
      (item) => item.sourceId === rule.uuid && item.grantedById === source.id,
    );
    if (!grantedItem) {
      failures.push(`${expectation.sourceItemName} did not natively grant its ${expectation.flag} replacement`);
    }
  }

  for (const [destinationKey, expectation] of Object.entries(smokeCase.expectedSpellcastingEntries ?? {})) {
    const entry = actorEvidence.items.find(
      (item) => item.type === "spellcastingEntry" && item.destinationKey === destinationKey,
    );
    if (!entry?.spellcasting) {
      failures.push(`Expected spellcasting entry is missing: ${destinationKey}`);
      continue;
    }

    for (const [slotKey, expectedMax] of Object.entries(expectation.slots ?? {})) {
      const actualMax = entry.spellcasting.slots?.[slotKey]?.max;
      if (actualMax !== expectedMax) {
        failures.push(`${destinationKey} ${slotKey} max is ${actualMax ?? "missing"}, expected ${expectedMax}`);
      }
    }
    for (const [slotKey, expectedPrepared] of Object.entries(expectation.preparedSlots ?? {})) {
      const actualPrepared = entry.spellcasting.slots?.[slotKey]?.prepared ?? null;
      if (JSON.stringify(actualPrepared) !== JSON.stringify(expectedPrepared)) {
        failures.push(
          `${destinationKey} ${slotKey} prepared slots are ${JSON.stringify(actualPrepared)}, expected ${JSON.stringify(expectedPrepared)}`,
        );
      }
    }
    for (const slotKey of expectation.forbiddenSlots ?? []) {
      if (entry.spellcasting.slots?.[slotKey]) {
        failures.push(`${destinationKey} unexpectedly contains ${slotKey}`);
      }
    }
    if (expectation.proficiencySlug !== undefined && entry.spellcasting.proficiencySlug !== expectation.proficiencySlug) {
      failures.push(
        `${destinationKey} proficiency slug is ${entry.spellcasting.proficiencySlug ?? "missing"}, expected ${expectation.proficiencySlug}`,
      );
    }
    for (const field of ["ability", "prepared", "tradition"]) {
      if (expectation[field] !== undefined && entry.spellcasting[field] !== expectation[field]) {
        failures.push(
          `${destinationKey} ${field} is ${entry.spellcasting[field] ?? "missing"}, expected ${expectation[field]}`,
        );
      }
    }
  }

  for (const [itemName, expectedDestinations] of Object.entries(smokeCase.expectedItemDestinations ?? {})) {
    const destinationKeys = Array.isArray(expectedDestinations) ? expectedDestinations : [expectedDestinations];
    for (const destinationKey of destinationKeys) {
      const entry = actorEvidence.items.find(
        (item) => item.type === "spellcastingEntry" && item.destinationKey === destinationKey,
      );
      const item = actorEvidence.items.find(
        (candidate) => candidate.name === itemName && candidate.type === "spell" && candidate.location === entry?.id,
      );
      if (!entry?.id || !item) {
        failures.push(`${itemName} is not located in ${destinationKey}`);
      }
    }
  }
}

async function seedActorItems(actor, smokeCase, failures) {
  const uuids = Array.isArray(smokeCase.preseedItemUuids) ? smokeCase.preseedItemUuids : [];
  for (const uuid of uuids) {
    const document = await globalThis.fromUuid(uuid);
    if (!document?.toObject) {
      failures.push(`Could not preseed actor item: ${uuid}`);
      continue;
    }
    await actor.createEmbeddedDocuments("Item", [document.toObject()]);
  }
}

async function seedActorSkillRanks(actor, smokeCase) {
  const ranks = smokeCase.preseedSkillRanks ?? {};
  const updates = Object.fromEntries(
    Object.entries(ranks).map(([slug, rank]) => [`system.skills.${slug}.rank`, rank]),
  );
  if (Object.keys(updates).length > 0) {
    await actor.update(updates);
  }
}

function statusFor(failures, classifications) {
  if (failures.length > 0) {
    return "fail";
  }

  return classifications.length > 0 ? "classified" : "pass";
}

function assertExpectedWorldId(actualWorldId, expectedWorldId) {
  const expected = String(expectedWorldId ?? "").trim();
  if (!expected) {
    return;
  }

  const actual = String(actualWorldId ?? "").trim();
  if (actual !== expected) {
    throw new Error(`Foundry smoke expected world ${expected}, but connected to ${actual || "<unknown>"}.`);
  }
}

async function cleanupActors(prefix) {
  const actors = game.actors.filter((actor) => actor.name.startsWith(prefix));
  for (const actor of actors) {
    await actor.delete();
  }
}

async function selectionRef(packId, name, slotId) {
  const entry = await findPackEntry(packId, name);
  return {
    slotId,
    packId,
    documentId: entry._id,
    featType: entry.system?.featType?.value ?? entry.system?.category ?? null,
    itemType: entry.type,
    level: entry.system?.level?.value ?? null,
    name: entry.name,
    uuid: entry.uuid ?? `Compendium.${packId}.Item.${entry._id}`,
  };
}

async function findPackEntry(packId, name) {
  const pack = game.packs.get(packId);
  if (!pack) {
    throw new Error(`Missing compendium pack ${packId}`);
  }

  const index = await pack.getIndex({
    fields: ["name", "type", "system.category", "system.featType.value", "system.level.value"],
  });
  const found = index.find((entry) => namesMatch(entry.name, name));
  if (!found) {
    throw new Error(`Missing ${name} in ${packId}`);
  }

  return found;
}

function levelBoosts(primary) {
  return uniqueAbilities([primary, "dex", "con", "wis", "int", "cha", "str"]).slice(0, 4);
}

function uniqueAbilities(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    } else {
      seen.add(value);
    }
  }
  return Array.from(duplicateValues).sort();
}

function dialogCount() {
  return document.querySelectorAll('.application.dialog, [role="dialog"]').length;
}

function stepSummary(step) {
  return {
    id: step.id,
    kind: step.kind,
    level: step.level,
    slotId: step.slotId,
    slotKind: step.slotKind,
    title: step.title,
  };
}

function namesMatch(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "accent" }) === 0;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

function errorToString(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}
