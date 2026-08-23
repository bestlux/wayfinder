import { MODULE_ID } from "../../constants.js";
import { preloadHandlebarsTemplates } from "../../shared/foundry-compat.js";
export const WAYFINDER_TEMPLATE_PATHS = [
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
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-policy.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-state.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-catalogue.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-catalogue-host.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-detail.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-cart.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/starting-equipment-status.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/acquisition-receipt.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/pick-pane.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/picker-result-count.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/picker-filter-bar.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/pick-results.hbs`,
    `modules/${MODULE_ID}/templates/wayfinder/spell-choice-results.hbs`,
];
let templatePreload = null;
export function ensureWayfinderTemplatesLoaded() {
    templatePreload ??= preloadHandlebarsTemplates([...WAYFINDER_TEMPLATE_PATHS])
        .then(() => undefined)
        .catch((error) => {
        templatePreload = null;
        throw error;
    });
    return templatePreload;
}
export function warmWayfinderTemplates() {
    void ensureWayfinderTemplatesLoaded().catch((error) => {
        console.error(`${MODULE_ID} | template preload failed; the first app render will retry`, error);
    });
}
//# sourceMappingURL=wayfinder-template-service.js.map