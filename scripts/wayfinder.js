import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSheetControls } from "./sheet-controls.js";
Hooks.once("init", () => {
    registerSettings();
    void loadTemplates([
        `modules/${MODULE_ID}/templates/wayfinder/manual-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/boost-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/skill-increase-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/skill-training-pane.hbs`,
        `modules/${MODULE_ID}/templates/wayfinder/pick-pane.hbs`,
    ]);
    registerSheetControls();
    console.log(`${MODULE_ID} | initialized`);
});
//# sourceMappingURL=wayfinder.js.map