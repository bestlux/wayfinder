import { MODULE_ID } from "./constants.js";
import { buildBugReportUrl, DISCORD_HANDLE, FEEDBACK_URLS, type FeedbackVersions } from "./feedback-links.js";

export { FEEDBACK_URLS } from "./feedback-links.js";

function readVersions(): Partial<FeedbackVersions> {
  if (typeof game === "undefined") {
    return {};
  }
  return {
    wayfinder: game.modules?.get?.(MODULE_ID)?.version,
    foundry: game.version,
    pf2e: game.system?.id === "pf2e" ? game.system?.version : undefined,
  };
}

export class FeedbackSupportApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-feedback`,
    tag: "section",
    classes: ["wayfinder-feedback"],
    position: {
      width: 540,
      height: "auto",
    },
    window: {
      icon: "fa-solid fa-comment-dots",
      title: "wayfinder-pf2e.Feedback.Title",
      contentClasses: ["standard-form"],
      resizable: false,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/feedback-support.hbs`,
    },
  };

  static open(): void {
    new FeedbackSupportApp().render(true);
  }

  protected async _prepareContext(): Promise<Record<string, unknown>> {
    const versions = readVersions();
    return {
      urls: {
        ...FEEDBACK_URLS,
        bug: buildBugReportUrl(versions),
      },
      discordHandle: DISCORD_HANDLE,
      hasPrefill: Boolean(versions.wayfinder || versions.foundry || versions.pf2e),
    };
  }
}
