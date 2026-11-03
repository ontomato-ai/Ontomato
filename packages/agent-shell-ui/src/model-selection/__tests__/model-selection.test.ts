import { describe, expect, it } from "vitest";
import { modelLabel, modelSelectionView, selectedModelId, type ModelSelectionLabels } from "..";

const labels: ModelSelectionLabels = {
  nullChoice: "Domain default (Qwen (qwen-main))",
  unavailable: (id) => `${id} (unavailable)`,
};
const models = [
  { name: "qwen-main", displayName: "Qwen" },
  { name: "deepseek", displayName: "deepseek" },
];

describe("model selection", () => {
  it("names a model by its display name and ID, once when they match", () => {
    expect(modelLabel(models[0]!)).toBe("Qwen (qwen-main)");
    expect(modelLabel(models[1]!)).toBe("deepseek");
  });

  it("offers the null choice first, then every model", () => {
    const view = modelSelectionView(null, models, labels);
    expect(view.value).toBe("");
    expect(view.options).toEqual([
      { value: "", label: labels.nullChoice, disabled: false },
      { value: "qwen-main", label: "Qwen (qwen-main)", disabled: false },
      { value: "deepseek", label: "deepseek", disabled: false },
    ]);
    expect(view.missingId).toBeNull();
    expect(view.disabled).toBe(false);
    expect(modelSelectionView("deepseek", models, labels).value).toBe("deepseek");
  });

  it("keeps a missing model ID selected as it is, as an unavailable option, and reports it", () => {
    const view = modelSelectionView("removed-model", models, labels);
    expect(view.value).toBe("removed-model");
    expect(view.missingId).toBe("removed-model");
    expect(view.options.at(-1)).toEqual({ value: "removed-model", label: "removed-model (unavailable)", disabled: true });
  });

  it("offers nothing and reports nothing missing while the models are unknown", () => {
    const view = modelSelectionView("removed-model", null, labels);
    expect(view.disabled).toBe(true);
    expect(view.missingId).toBeNull();
    expect(view.options).toEqual([{ value: "", label: labels.nullChoice, disabled: false }]);
  });

  it("stores the null choice as null and anything else as the model ID", () => {
    expect(selectedModelId("")).toBeNull();
    expect(selectedModelId("deepseek")).toBe("deepseek");
  });
});
