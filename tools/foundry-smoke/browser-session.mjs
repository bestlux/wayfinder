import { existsSync } from "node:fs";

const defaultChromePaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

export function resolveFoundryChromePath(configuredPath = process.env.FOUNDRY_CHROME_PATH) {
  if (configuredPath) {
    return configuredPath;
  }
  return defaultChromePaths.find((entry) => existsSync(entry)) ?? "";
}

export async function loginToFoundryWorld(page, { foundryUrl, password, user }) {
  await page.goto(`${foundryUrl.replace(/\/$/u, "")}/join`, { waitUntil: "networkidle" });
  if (page.url().includes("/join")) {
    if (!user) {
      throw new Error("FOUNDRY_USER is required when the browser is not already logged in.");
    }

    const legacyUserSelect = page.locator('select[name="userid"]');
    if ((await legacyUserSelect.count()) > 0) {
      await legacyUserSelect.selectOption({ label: user });
    } else {
      await page.locator('input[name="username"]').fill(user);
    }
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[name="join"]').click();
  }

  await page.waitForURL(/\/game/u, { timeout: 30000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
}

export async function closeFoundryBrowser(context, browser) {
  await Promise.race([
    (async () => {
      await context.close();
      await browser.close();
    })(),
    new Promise((resolve) => {
      setTimeout(resolve, 5000);
    }),
  ]);
}
