import { MODULE_ID } from "./constants.js";
import { getEquipmentWorldPolicySetting } from "./settings.js";
import { saveEquipmentWorldPolicy } from "./wayfinder/application/equipment-policy-service.js";
import {
  requireCurrentGmPrincipal,
  WayfinderGmCommandAuthorityError,
} from "./wayfinder/application/gm-command-authority.js";

interface EquipmentPolicyContext {
  policy: ReturnType<typeof getEquipmentWorldPolicySetting>;
  permanentEnabled: boolean;
  lumpSumEnabled: boolean;
  families: Array<{ id: string; label: string; selected: boolean; packCount: number }>;
}

export class EquipmentPolicyConfigApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-equipment-policy`,
    tag: "form",
    classes: ["wayfinder-equipment-policy-config"],
    position: { width: 720, height: 760 },
    form: { closeOnSubmit: false, handler: EquipmentPolicyConfigApp.#handleSubmit },
    window: {
      icon: "fa-solid fa-coins",
      title: "wayfinder-pf2e.EquipmentPolicy.Title",
      contentClasses: ["standard-form"],
      resizable: true,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/equipment-policy-config.hbs` },
  };

  static open(): void {
    try {
      requireCurrentGmPrincipal(game.user);
      new EquipmentPolicyConfigApp().render(true);
    } catch (error) {
      if (!(error instanceof WayfinderGmCommandAuthorityError)) throw error;
      ui.notifications.error(game.i18n.localize("wayfinder-pf2e.EquipmentPolicy.GmOnly"));
    }
  }

  protected async _prepareContext(): Promise<EquipmentPolicyContext> {
    const policy = getEquipmentWorldPolicySetting();
    return {
      policy,
      permanentEnabled: policy.enabledRecipes.includes("permanent-items"),
      lumpSumEnabled: policy.enabledRecipes.includes("lump-sum"),
      families: discoverEquipmentPackFamilies(policy.allowedEquipmentPackFamilies),
    };
  }

  static async #handleSubmit(
    this: EquipmentPolicyConfigApp,
    _event: SubmitEvent,
    form: HTMLFormElement
  ): Promise<void> {
    try {
      requireCurrentGmPrincipal(game.user);
      const data = new FormData(form);
      const enabledRecipes = data.getAll("enabledRecipes").map(String);
      if (enabledRecipes.length === 0) {
        ui.notifications.error(game.i18n.localize("wayfinder-pf2e.EquipmentPolicy.RecipeRequired"));
        return;
      }
      await saveEquipmentWorldPolicy({
        version: 1,
        enabledRecipes,
        defaultRecipe: String(data.get("defaultRecipe") ?? ""),
        recipeChoiceAuthority: String(data.get("recipeChoiceAuthority") ?? ""),
        higherLevelStartAuthority: String(data.get("higherLevelStartAuthority") ?? ""),
        blanketRarity: String(data.get("blanketRarity") ?? ""),
        allowedEquipmentPackFamilies: data.getAll("allowedEquipmentPackFamilies").map(String),
        applyAuthority: String(data.get("applyAuthority") ?? ""),
      });
      ui.notifications.info(game.i18n.localize("wayfinder-pf2e.EquipmentPolicy.Saved"));
      await this.close();
    } catch (error) {
      if (!(error instanceof WayfinderGmCommandAuthorityError)) throw error;
      ui.notifications.error(game.i18n.localize("wayfinder-pf2e.EquipmentPolicy.GmOnly"));
    }
  }
}

function discoverEquipmentPackFamilies(selectedFamilies: readonly string[]) {
  const selected = new Set(selectedFamilies);
  const packs = game.packs;
  const values = typeof packs?.values === "function" ? [...packs.values()] : Array.isArray(packs) ? packs : [];
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of values) {
    const pack = record(raw);
    const metadata = record(pack.metadata);
    if (metadata.type !== "Item" && pack.documentName !== "Item") continue;
    const id = String(pack.collection ?? metadata.id ?? "");
    const family = id.split(".")[0]?.trim().toLowerCase();
    if (!family) continue;
    const packageTitle = String(record(pack.metadata).packageName ?? record(pack).packageName ?? family);
    const current = counts.get(family);
    counts.set(family, { label: current?.label ?? packageTitle, count: (current?.count ?? 0) + 1 });
  }
  for (const family of selected) {
    if (!counts.has(family)) counts.set(family, { label: family, count: 0 });
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, label: value.label, packCount: value.count, selected: selected.has(id) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
