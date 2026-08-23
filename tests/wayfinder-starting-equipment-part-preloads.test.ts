import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const templateService = read("src/wayfinder/application/wayfinder-template-service.ts");
const templatePaths = [
  "templates/wayfinder-app.hbs",
  "templates/wayfinder/starting-equipment-pane.hbs",
  "templates/wayfinder/starting-equipment-policy.hbs",
];

describe("starting-equipment template registration", () => {
  it("preloads every nested partial required by a full Foundry render", () => {
    const partialPaths = templatePaths.flatMap((path) =>
      [...read(path).matchAll(/\{\{>\s+"modules\/wayfinder-pf2e\/(templates\/wayfinder\/[^"]+\.hbs)"\s*\}\}/gu)].map(
        (match) => match[1]
      )
    );

    const startingEquipmentPartials = [
      "templates/wayfinder/starting-equipment-status.hbs",
      "templates/wayfinder/starting-equipment-policy.hbs",
      "templates/wayfinder/starting-equipment-state.hbs",
      "templates/wayfinder/starting-equipment-catalogue.hbs",
      "templates/wayfinder/starting-equipment-catalogue-host.hbs",
      "templates/wayfinder/starting-equipment-detail.hbs",
      "templates/wayfinder/starting-equipment-cart.hbs",
    ];
    expect(partialPaths).toEqual(expect.arrayContaining(startingEquipmentPartials));
    for (const path of new Set(partialPaths)) {
      expect(templateService).toContain(`modules/\${MODULE_ID}/${path}`);
    }
  });
});

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}
