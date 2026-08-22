import { CompendiumSourceConfigApp } from "./compendium-source-config-app.js";
import { MODULE_ID } from "./constants.js";
import { EquipmentPolicyConfigApp } from "./equipment-policy-config-app.js";
import { FeedbackSupportApp } from "./feedback-support-app.js";
import { invalidatePackSources, registerPackSourceCacheInvalidation } from "./pack/cache-invalidation.js";
import { registerSettings } from "./settings.js";
import { registerSheetControls, registerWayfinderActorRefresh, rerenderOpenWayfinderApps } from "./sheet-controls.js";
import { registerAcquisitionSmokeDriver } from "./wayfinder/application/acquisition-smoke-driver.js";
import { registerPersistedDraftWriteGuardHook } from "./wayfinder/application/draft-write-guard.js";
import { invalidateFoundryEquipmentCataloguePack, registerFoundryEquipmentAcquisitionRuntime, } from "./wayfinder/application/equipment-acquisition-runtime-service.js";
import { registerEquipmentAuthorityCoordinator } from "./wayfinder/application/equipment-authority-coordinator.js";
import { warmWayfinderTemplates } from "./wayfinder/application/wayfinder-template-service.js";
Hooks.once("init", () => {
    registerAcquisitionSmokeDriver();
    registerSettings({
        compendiumSourcesMenuType: CompendiumSourceConfigApp,
        equipmentPolicyMenuType: EquipmentPolicyConfigApp,
        feedbackMenuType: FeedbackSupportApp,
        onExtraPacksChange: () => invalidatePackSources(rerenderOpenWayfinderApps),
        onSpellRarityCeilingChange: rerenderOpenWayfinderApps,
        onEquipmentPolicyChange: rerenderOpenWayfinderApps,
    });
    warmWayfinderTemplates();
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
Hooks.once("ready", () => {
    registerEquipmentAuthorityCoordinator();
});
//# sourceMappingURL=wayfinder.js.map