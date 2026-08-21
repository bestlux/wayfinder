import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;

const styles = ["tokens-base.css", "shell-layout.css", "footer-responsive.css", "starting-equipment.css"]
  .map((file) => readFileSync(resolve("styles/wayfinder", file), "utf8"))
  .join("\n");

browserIt(
  "keeps acquisition and ordinary panes reachable at every frozen app width",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      for (const width of [1240, 1180, 980, 760]) {
        await page.setContent(layoutFixture(width, "starting-equipment-pane", equipmentContent));
        const equipment = await page.evaluate(measureLayout);

        expect(equipment.rootOverflow, `root horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
        expect(equipment.stageOverflow, `stage horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
        expect(equipment.paneOverflow, `equipment horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
        expect(equipment.targetReachable, `review controls unreachable at ${width}px`).toBe(true);
        if (width <= 980) {
          expect(equipment.stageOverflowY).toBe("auto");
          expect(equipment.stageScrollHeight).toBeGreaterThan(equipment.stageClientHeight);
        }

        await page.setContent(layoutFixture(width, "ordinary-pane", ordinaryContent));
        const ordinary = await page.evaluate(measureLayout);
        expect(ordinary.rootOverflow, `ordinary root overflow at ${width}px`).toBeLessThanOrEqual(1);
        expect(ordinary.stageOverflow, `ordinary stage overflow at ${width}px`).toBeLessThanOrEqual(1);
        expect(ordinary.targetReachable, `ordinary controls unreachable at ${width}px`).toBe(true);
      }
    } finally {
      await browser.close();
    }
  },
  20_000
);

function layoutFixture(width: number, paneClass: string, content: string): string {
  const steps = '<div class="dummy-step">Step with a translated title</div>'.repeat(20);
  return `
    <style>
      html, body { margin: 0; }
      * { box-sizing: border-box; }
      .wayfinder-app { display: flex; width: ${width}px; height: 820px; }
      .wayfinder-app .window-content { width: 100%; height: 100%; }
      .dummy-step { height: 30px; flex: none; }
      .${paneClass} { min-width: 0; padding: 10px; }
      .ordinary-row { min-height: 56px; }
    </style>
    <style>${styles}</style>
    <div class="wayfinder-app">
      <div class="window-content">
        <section class="wayfinder-shell">
          <section class="wizard-frame">
            <aside class="wizard-rail">
              <header class="rail-header">Rail header</header>
              <div class="wizard-step-list">${steps}</div>
            </aside>
            <main class="wizard-stage">
              <header class="stage-bar">Stage heading</header>
              <section class="${paneClass}">${content}</section>
            </main>
          </section>
          <footer class="wayfinder-footer">
            <div class="footer-support">Support controls</div>
            <button class="footer-readiness"><span>A long translated blocker that must remain readable</span></button>
            <div class="footer-actions">Apply controls</div>
          </footer>
        </section>
      </div>
    </div>`;
}

const result = `
  <article class="equipment-result">
    <button class="equipment-result-main"><span><strong>A long translated equipment item name</strong><small>Funding and configuration details</small></span></button>
    <span class="equipment-result-price">100 gp</span>
    <div class="equipment-result-actions"><button>Buy with coin</button><button>Request Exception</button></div>
  </article>`;

const cartLine = `
  <article class="equipment-cart-line">
    <span><strong>A long translated cart item name</strong><small>Funding and configuration details</small></span>
    <div class="equipment-quantity">1</div><button>Remove</button>
  </article>`;

const equipmentContent = `
  <section class="equipment-policy-summary">
    ${"<article><span>Policy label</span><strong>A long translated policy value</strong></article>".repeat(6)}
  </section>
  <div class="equipment-workspace">
    <section class="equipment-catalogue"><div class="equipment-result-list">${result.repeat(8)}</div></section>
    <aside class="equipment-detail">Equipment detail</aside>
    <section class="equipment-cart">${cartLine.repeat(8)}<footer data-reachability-target><span>Review the complete acquisition</span><div><button>Keep all</button><button>Confirm</button></div></footer></section>
  </div>`;

const ordinaryContent = `${'<div class="ordinary-row">A translated non-equipment choice row</div>'.repeat(
  24
)}<button data-reachability-target>Continue ordinary workflow</button>`;

function measureLayout() {
  const root = document.querySelector<HTMLElement>(".wayfinder-shell")!;
  const stage = document.querySelector<HTMLElement>(".wizard-stage")!;
  const pane = stage.querySelector<HTMLElement>("section")!;
  const target = stage.querySelector<HTMLElement>("[data-reachability-target]")!;
  stage.scrollTop = stage.scrollHeight;
  const stageRect = stage.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return {
    rootOverflow: root.scrollWidth - root.clientWidth,
    stageOverflow: stage.scrollWidth - stage.clientWidth,
    paneOverflow: pane.scrollWidth - pane.clientWidth,
    stageOverflowY: getComputedStyle(stage).overflowY,
    stageClientHeight: stage.clientHeight,
    stageScrollHeight: stage.scrollHeight,
    targetReachable: targetRect.top < stageRect.bottom && targetRect.bottom > stageRect.top,
  };
}
