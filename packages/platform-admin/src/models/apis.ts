import type { ModelApi } from "@ontomato/contracts/model-settings";

/** Product names of the protocols the contract opens; they are not translated. */
export const modelApiLabels: Record<ModelApi, string> = {
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Gemini",
};

/** Example base URL of each protocol's own service, shown as the address placeholder. */
export const modelApiBaseUrls: Record<ModelApi, string> = {
  "openai-completions": "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  "anthropic-messages": "https://api.anthropic.com",
  "google-generative-ai": "https://generativelanguage.googleapis.com/v1beta",
};
