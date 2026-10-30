import type { AgentRow } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import { backendGet } from "../../utils/backend-client";
/** Initial context and retrieval share classNames; Java owns the authorized class catalogue. */
export async function assistantOntologyContext(
  agent: AgentRow,
  credentials: AssistantCredentials,
) {
  const response = await backendGet("assistant:ontology-overview",
    buildUrl(getApiConfig(), "/ontology/query/overview"), credentials);
  const overview = JSON.parse(response.text);
  if (agent.class_names.length)
    overview.classes = overview.classes.filter((cls: { name: string }) => agent.class_names.includes(cls.name));
  return JSON.stringify(overview);
}
