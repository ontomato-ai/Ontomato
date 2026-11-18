import type { RuntimeEnvironment } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { environment } from "../../config/environment";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { callbackCredential } from "../agent-runtime/callback-credential";
import type { AssistantOwner } from "./store";

/** Skills receive a run-scoped host callback, never the selected user's key. */
export function executionSkillEnvironment(_owner: AssistantOwner, initiatorCredentials: AssistantCredentials, runId: string): RuntimeEnvironment {
  const root = environment.agentRuntime().callbackUrl.replace(/\/$/, "");
  const pathPrefix = `/api/assistant/executions/${runId}/`;
  return {
    values: {
      ONTOMATO_WORKBENCH_URL: root + pathPrefix + "workbench",
      ONTOMATO_URL: root + pathPrefix + "workbench",
      ONTOMATO_ONTOLOGY_URL: root + pathPrefix + "ontology",
      ONTOMATO_RETRIEVAL_CALLBACK_URL: root + pathPrefix + "retrieval",
      ONTOMATO_SKILL_SCENARIO: "platform",
    },
    secrets: { ONTOMATO_EXECUTION_CALLBACK: callbackCredential({
      pathPrefix, runId, expiresAt: Date.now() + getQueryTimeoutMs(),
      token: initiatorCredentials.token ?? "", apiKey: initiatorCredentials.apiKey ?? "",
    }).value },
  };
}
