import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { agentVisibilityPrompt } from "../visibility";

test("the Node reader delivers both shared prompt sections verbatim", async () => {
  const resource = new URL("../../../../../contracts/src/agent-visibility-prompt.json", import.meta.url);
  const prompts = JSON.parse(await readFile(resource, "utf8"));
  expect(agentVisibilityPrompt("user")).toBe(prompts.user);
  expect(agentVisibilityPrompt("delegated")).toBe(prompts.delegated);
});
