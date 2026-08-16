import { MODULE_ID } from "./constants.js";
import { FeedbackSupportApp } from "./feedback-support-app.js";
import { registerSettings } from "./settings.js";
import { preloadHandlebarsTemplates } from "./shared/foundry-compat.js";
import { registerSheetControls, rerenderOpenWayfinderApps } from "./sheet-controls.js";
Hooks.once("init", () => {
    registerSettings({
        feedbackMenuType: FeedbackSupportApp,
        onSpellRarityCeilingChange: rerenderOpenWayfinderApps,
    });
    void preloadHandlebarsTemplates([
        `modules/${MODULE_ID}/templates/wayfinder/manual-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/boost-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/skill-increase-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/skill-training-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/singleton-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/language-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/class-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/spell-choice-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/pick-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/picker-result-count.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/pick-results.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/spell-choice-results.hbs`,
    ]);
    registerSheetControls();
    console.log(`${MODULE_ID} | initialized`);
});
//# sourceMappingURL=wayfinder.js.map