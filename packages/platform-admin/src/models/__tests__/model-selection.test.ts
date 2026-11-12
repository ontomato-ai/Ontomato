import { describe, expect, it } from "vitest";
import { modelLabel, modelSelectionView, selectedModelId, type ModelSelectionLabels } from "@ontomato/contracts/model-selection";

const labels: ModelSelectionLabels = {
  nullChoice: "Domain default (Qwen (gateway/qwen-main))",
  unavailable: (id) => `${id} (unavailable)`,
};
const models = [
  { ref: "gateway/qwen-main", name: "Qwen", type: "chat" as const },
  { ref: "deepseek/chat", name: "deepseek/chat", type: "chat" as const },
  { ref: "gateway/embed", name: "Embed", type: "embedding" as const },
];

describe("model selection", () => {
  it("names a model by its display name and ID, once when they match", () => {
    expect(modelLabel(models[0]!)).toBe("Qwen (gateway/qwen-main)");
    expect(modelLabel(models[1]!)).toBe("deepseek/chat");
  });

  it("offers the null choice first, then every chat model", () => {
    const view = modelSelectionView(null, models, labels);
    expect(view.value).toBe("");
    expect(view.options.map((option) => option.value)).toEqual(["", "gateway/qwen-main", "deepseek/chat"]);
    expect(view.options.every((option) => option.disabled === false)).toBe(true);
    expect(view.missingId).toBeNull();
    expect(view.disabled).toBe(false);
    expect(modelSelectionView("deepseek/chat", models, labels).value).toBe("deepseek/chat");
  });

  it("keeps a missing model ID selected as it is, as an unavailable option, and reports it", () => {
    const view = modelSelectionView("legacy/removed-model", models, labels);
    expect(view.value).toBe("legacy/removed-model");
    expect(view.missingId).toBe("legacy/removed-model");
    expect(view.options.at(-1)).toMatchObject({ value: "legacy/removed-model", disabled: true });
  });

  it("offers nothing and reports nothing missing while the models are unknown", () => {
    const view = modelSelectionView("legacy/removed-model", null, labels);
    expect(view.disabled).toBe(true);
    expect(view.missingId).toBeNull();
    expect(view.options.map((option) => option.value)).toEqual([""]);
  });

  it("stores the null choice as null and anything else as the model ID", () => {
    expect(selectedModelId("")).toBeNull();
    expect(selectedModelId("deepseek/chat")).toBe("deepseek/chat");
  });
});
