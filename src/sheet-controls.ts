import { canUseWayfinder } from "./permissions.js";
import { WayfinderApp } from "./wayfinder-app.js";

export function registerSheetControls(): void {
  const inject = (application: any, html: unknown) => {
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
    } else {
      nav.append(button);
    }
  };

  Hooks.on("renderActorSheet", inject);
}

function getRootElement(html: unknown, application: any): HTMLElement | null {
  if (html instanceof HTMLElement) {
    return html;
  }

  const possibleJQuery = html as { 0?: HTMLElement; length?: number } | null;
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
