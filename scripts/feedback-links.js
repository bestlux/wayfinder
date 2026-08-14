const ISSUE_BASE = "https://github.com/bestlux/wayfinder/issues/new";
export const FEEDBACK_URLS = {
    bug: `${ISSUE_BASE}?template=bug-report.yml`,
    feature: `${ISSUE_BASE}?template=feature-request.yml`,
    chooser: `${ISSUE_BASE}/choose`,
    coverage: "https://github.com/bestlux/wayfinder/tree/master/docs/coverage",
};
export const DISCORD_HANDLE = "bestlux";
/**
 * GitHub issue forms accept prefilled values as query parameters keyed by field id,
 * so a reporter never has to hunt down version numbers Wayfinder already knows.
 */
export function buildBugReportUrl(versions) {
    const params = new URLSearchParams({ template: "bug-report.yml" });
    const prefill = [
        ["wayfinder-version", versions.wayfinder],
        ["foundry-version", versions.foundry],
        ["pf2e-version", versions.pf2e],
    ];
    for (const [field, value] of prefill) {
        if (value) {
            params.set(field, value);
        }
    }
    return `${ISSUE_BASE}?${params.toString()}`;
}
//# sourceMappingURL=feedback-links.js.map