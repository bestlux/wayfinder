import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSheetControls } from "./sheet-controls.js";

Hooks.once("init", () => {
  registerSettings();
  registerSheetControls();
  console.log(`${MODULE_ID} | initialized`);
});
