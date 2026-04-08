import { canUseWayfinder } from "./permissions.js";
import { WayfinderApp } from "./wayfinder-app.js";
export function registerSheetControls() {
    const inject = (application, html) => {
        const actor = application?.actor ?? application?.document ?? null;
        if (!actor || actor.type !== "character" || !canUseWayfinder(actor)) {
            return;
        }
        const root = getRootElement(html, application);
        if (!root) {
            return;
        }
        const nav = root.querySelector("nav.sheet-navigation");
        if (!nav || nav.querySelector(".wayfinder-launch")) {
            return;
        }
        const button = document.createElement("a");
        button.className = "item wayfinder-launch";
        button.setAttribute("data-tooltip", "Wayfinder");
        button.setAttribute("aria-label", "Wayfinder");
        button.setAttribute("role", "button");
        button.innerHTML = '<i class="fa-solid fa-compass"></i>';
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            WayfinderApp.open(actor);
        });
        const manageTabs = nav.querySelector(".manage-tabs");
        if (manageTabs?.parentElement === nav) {
            nav.insertBefore(button, manageTabs);
        }
        else {
            nav.append(button);
        }
    };
    Hooks.on("renderActorSheet", inject);
    Hooks.on("renderCharacterSheetPF2e", inject);
}
function getRootElement(html, application) {
    if (html instanceof HTMLElement) {
        return html;
    }
    const possibleJQuery = html;
    if (possibleJQuery?.[0] instanceof HTMLElement) {
        return possibleJQuery[0];
    }
    const appElement = application?.element;
    if (appElement instanceof HTMLElement) {
        return appElement;
    }
    if (appElement?.[0] instanceof HTMLElement) {
        return appElement[0];
    }
    return null;
}
//# sourceMappingURL=sheet-controls.js.map