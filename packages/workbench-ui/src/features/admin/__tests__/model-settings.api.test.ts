import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: unknown }> }));

vi.mock("../../../utils/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn((path: string, body?: unknown) => {
    calls.posts.push({ path, body });
    return Promise.resolve({ success: true });
  }),
  nodeApiDelete: vi.fn(),
  nodeApiFetch: vi.fn(),
  nodeApiGet: vi.fn(),
  nodeApiPatch: vi.fn(),
  nodeApiPost: vi.fn(),
}));

import { adminApi } from "../api";

describe("model settings api", () => {
  beforeEach(() => {
    calls.posts.length = 0;
  });
  it("saves the model list and the domain default in one request", async () => {
    const payload = {
      models: [
        {
          name: "qwen-main",
          displayName: "Qwen",
          baseUrl: "https://example/v1",
          apiKeys: ["sk-fake-ab12", "sk-fake-cd34"],
          modelName: "qwen3",
          maxTokens: 50000,
          contextWindow: 256000,
          timeout: "PT300S",
        },
      ],
      defaultModelId: "qwen-main",
    };
    await adminApi.saveModelSettings(payload);

    expect(calls.posts).toEqual([{ path: "/model-settings/save", body: payload }]);
  });

  it("tests a draft model with the contract field names", async () => {
    const model = {
      name: "qwen-main",
      displayName: "Qwen",
      baseUrl: "https://example/v1",
      apiKeys: ["sk-fake-ab12"],
      modelName: "qwen3",
      maxTokens: null,
      contextWindow: null,
    };
    await adminApi.testModel(model, "hello");

    expect(calls.posts).toEqual([
      { path: "/model-settings/test", body: { model, prompt: "hello" } },
    ]);
  });
});
