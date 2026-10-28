import { datasetSchemaService } from "./ontology-context";
import {
  resolveAnalysisGraphClassNames,
  intersectAnalysisClassNames,
} from "./graph-scope";
import type { AgentRow, AssistantOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { getApiConfig } from "../../config/data-query-api";
/** Preserve the old distinction: graph scope selects starting context; classNames scopes retrieval. */
export async function assistantOntologyContext(
  agent: AgentRow,
  question: string,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
) {
  const graph = await resolveAnalysisGraphClassNames(
    agent.graph_scope,
    credentials.token,
    owner.userId,
    credentials.locale,
    credentials.apiKey,
  );
  const names = intersectAnalysisClassNames(agent.class_names, graph);
  if (graph && names?.length === 0)
    return "No classes are present in the configured initial ontology scope.";
  datasetSchemaService.setConfig(getApiConfig().baseUrl ?? "");
  return datasetSchemaService.getSchemaForQuestion(
    question,
    credentials.token,
    credentials.apiKey,
    names,
  );
}
