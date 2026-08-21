import { describe, expect, it } from "vitest";
import {
  EXEMPLAR_IKON_CHOICE_PATH,
  projectRegisteredDynamicChoices,
  resolveRegisteredDynamicChoices,
} from "../src/wayfinder/singleton-choice/dynamic-choice-registry";

describe("registered dynamic ChoiceSet paths", () => {
  it("projects only reviewed Exemplar ikon ActiveEffectLike values", () => {
    const projected = projectRegisteredDynamicChoices([
      ikonFeature("eye-catching-spot", "Eye Catching Spot", ["parent:tag:body-ikon-feat"]),
      {
        system: {
          rules: [
            {
              key: "ActiveEffectLike",
              mode: "add",
              path: "flags.system.unreviewed.values",
              value: { value: "unsafe", label: "Unsafe" },
            },
          ],
        },
      },
    ]);

    expect(projected).toEqual({
      [EXEMPLAR_IKON_CHOICE_PATH]: [
        {
          value: "eye-catching-spot",
          label: "Eye Catching Spot",
          predicate: ["parent:tag:body-ikon-feat"],
        },
      ],
    });
    expect(projected["flags.system.unreviewed.values"]).toBeUndefined();
  });

  it("filters projected ikons against the choosing feat's compatibility tags", () => {
    const projected = projectRegisteredDynamicChoices([
      ikonFeature("eye-catching-spot", "Eye Catching Spot", ["parent:tag:body-ikon-feat"]),
      ikonFeature("gleaming-blade", "Gleaming Blade", ["parent:tag:weapon-ikon-feat"]),
    ]);

    expect(
      resolveRegisteredDynamicChoices({
        path: EXEMPLAR_IKON_CHOICE_PATH,
        projectedChoices: projected,
        sourceDocument: { system: { traits: { otherTags: ["body-ikon-feat"] } } },
      })?.map((choice) => choice.value)
    ).toEqual(["eye-catching-spot"]);
  });

  it("refuses arbitrary flags.system paths", () => {
    expect(
      resolveRegisteredDynamicChoices({
        path: "flags.system.unreviewed.values",
        projectedChoices: {},
        sourceDocument: null,
      })
    ).toBeNull();
  });
});

function ikonFeature(value: string, label: string, predicate: unknown[]) {
  return {
    system: {
      rules: [
        {
          key: "ActiveEffectLike",
          mode: "add",
          path: EXEMPLAR_IKON_CHOICE_PATH,
          value: { value, label, predicate },
        },
      ],
    },
  };
}
