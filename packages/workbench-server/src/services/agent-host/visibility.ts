import { DELEGATED_VISIBILITY_PROMPT, USER_VISIBILITY_PROMPT } from "@ontomato/contracts/agent-visibility";

const prompts = {
  user: USER_VISIBILITY_PROMPT,
  delegated: DELEGATED_VISIBILITY_PROMPT,
};

export type AgentVisibilityReader = keyof typeof prompts;

export function agentVisibilityPrompt(reader: AgentVisibilityReader): string {
  return prompts[reader];
}
