import { afterEach, expect, it, vi } from "vitest";
import { createChatCompletionsOverrideFetch } from "../chat-completions-body-override";

afterEach(() => { vi.unstubAllGlobals(); });

it("sends whole top-level overrides, including null, without losing unconfigured request fields", async () => {
  const sent: Request[] = [];
  const transport: typeof fetch = async (input, init) => {
    sent.push(new Request(input, init));
    return new Response("{}", { headers: { "content-type": "application/json" } });
  };
  vi.stubGlobal("fetch", transport);
  const sdkBody = { model: "model-a", temperature: 0, stream: true, max_tokens: 1024,
    response_format: { type: "json_schema", json_schema: { name: "old" } },
    messages: [{ role: "assistant", content: "old", reasoning_content: "old reasoning" }], stop: ["old"] };
  const overrides = { temperature: 0.7, response_format: { type: "json_object" },
    messages: [{ role: "user", content: "replacement" }], stop: null };
  await createChatCompletionsOverrideFetch(overrides)!("https://model.invalid/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sdkBody),
  });
  expect(await sent[0].json()).toEqual({ model: "model-a", temperature: 0.7, stream: true, max_tokens: 1024,
    response_format: { type: "json_object" }, messages: [{ role: "user", content: "replacement" }], stop: null });
});
