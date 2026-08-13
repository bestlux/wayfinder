import { MODULE_ID } from "./constants.js";

export const FEEDBACK_URLS = {
  bug: "https://github.com/bestlux/wayfinder/issues/new?template=bug-report.yml",
  feature: "https://github.com/bestlux/wayfinder/issues/new?template=feature-request.yml",
  chooser: "https://github.com/bestlux/wayfinder/issues/new/choose",
} as const;

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
    return {
      urls: FEEDBACK_URLS,
    };
  }
}
