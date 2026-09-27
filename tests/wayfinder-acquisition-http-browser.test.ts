import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { acquisitionFixture } from "./fixtures/acquisition-fixture";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

(chromePath ? it : it.skip)(
  "preserves acquisition identities and plans across real HTTP and HTTPS browser capabilities",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const plans = [];
      for (const protocol of ["http", "https"]) {
        const page = await browser.newPage();
        const origin = `${protocol}://wayfinder-crypto.test`;
        await page.route(`${origin}/**`, async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/") {
            await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Equipment crypto</title>" });
          } else if (/^\/scripts\/[a-z0-9/.-]+\.js$/u.test(pathname) && !pathname.includes("..")) {
            await route.fulfill({
              contentType: "text/javascript",
              body: readFileSync(resolve(`.${pathname}`), "utf8"),
            });
          } else {
            await route.abort();
          }
        });
        await page.goto(origin);
        const result = await page.evaluate(async (draft) => {
          const base = "/scripts/wayfinder/domain/";
          // Keep Vitest's server-side import transform out of the browser callback.
          const importModule = new Function("path", "return import(path)");
          const identity = await importModule(`${base}acquisition-identity.js`);
          const grants = await importModule(`${base}class-grant-reconciliation.js`);
          const ledger = await importModule(`${base}acquisition-ledger.js`);
          const prepare = async (current: typeof draft) => {
            const classGrantPlan = grants.createPreparedClassGrantPlan({
              actorId: "actor-1",
              draftId: current.draftId,
              batchId: current.batchId,
              targetLevel: current.targetLevel,
              grants: current.plannedClassGrants,
            });
            return identity.prepareAcquisitionIdentityPlan({
              actorId: "actor-1",
              draft: current,
              classGrantPlan,
              ledger: ledger.evaluateAcquisitionLedger(current, classGrantPlan),
            });
          };
          const seed = identity.mintAcquisitionIdentitySeed();
          const lineId = identity.mintAcquisitionLineId();
          const plan = await prepare(draft);
          const reopened = await prepare(JSON.parse(JSON.stringify(draft)));
          return {
            secureContext: isSecureContext,
            randomUUID: typeof crypto.randomUUID,
            subtle: typeof crypto.subtle,
            getRandomValues: typeof crypto.getRandomValues,
            seed,
            lineId,
            plan,
            reopened,
          };
        }, acquisitionFixture().draft);
        expect(result.secureContext).toBe(protocol === "https");
        expect(result.randomUUID).toBe(protocol === "https" ? "function" : "undefined");
        expect(result.subtle).toBe(protocol === "https" ? "object" : "undefined");
        expect(result.getRandomValues).toBe("function");
        expect(new Set(Object.values(result.seed)).size).toBe(3);
        expect(result.lineId).toMatch(/^wf-line-[0-9a-f-]{36}$/u);
        expect(result.plan).toEqual(result.reopened);
        plans.push(result.plan);
        await page.close();
      }
      expect(plans[0]).toEqual(plans[1]);
    } finally {
      await browser.close();
    }
  },
  30_000
);
