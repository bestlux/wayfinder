import { CompendiumSourceConfigApp } from "./compendium-source-config-app.js";
import { MODULE_ID } from "./constants.js";
import { EquipmentPolicyConfigApp } from "./equipment-policy-config-app.js";
import { FeedbackSupportApp } from "./feedback-support-app.js";
import { invalidatePackSources, registerPackSourceCacheInvalidation } from "./pack/cache-invalidation.js";
import { registerSettings } from "./settings.js";
import { preloadHandlebarsTemplates } from "./shared/foundry-compat.js";
import { registerSheetControls, registerWayfinderActorRefresh, rerenderOpenWayfinderApps } from "./sheet-controls.js";
import { registerAcquisitionSmokeDriver } from "./wayfinder/application/acquisition-smoke-driver.js";
import { registerPersistedDraftWriteGuardHook } from "./wayfinder/application/draft-write-guard.js";
import { invalidateFoundryEquipmentCataloguePack, registerFoundryEquipmentAcquisitionRuntime, } from "./wayfinder/application/equipment-acquisition-runtime-service.js";
Hooks.once("init", () => {
    registerAcquisitionSmokeDriver();
    registerSettings({
        compendiumSourcesMenuType: CompendiumSourceConfigApp,
        equipmentPolicyMenuType: EquipmentPolicyConfigApp,
        feedbackMenuType: FeedbackSupportApp,
        onExtraPacksChange: () => invalidatePackSources(rerenderOpenWayfinderApps),
        onSpellRarityCeilingChange: rerenderOpenWayfinderApps,
    });
    void preloadHandlebarsTemplates([
        `modules/${MODULE_ID}/templates/equipment-policy-config.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/manual-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/boost-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/skill-increase-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/skill-training-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/singleton-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/language-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/class-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/spell-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/acquisition-receipt.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/pick-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/picker-result-count.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/pick-results.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/spell-choice-results.hbs`,
    ]);
    registerFoundryEquipmentAcquisitionRuntime();
    registerPersistedDraftWriteGuardHook();
    registerPackSourceCacheInvalidation((packId) => {
        invalidateFoundryEquipmentCataloguePack(packId);
        rerenderOpenWayfinderApps();
    });
    registerSheetControls();
    registerWayfinderActorRefresh();
    console.log(`${MODULE_ID} | initialized`);
});
//# sourceMappingURL=wayfinder.js.map