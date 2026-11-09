import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import { assistantOntologyContext } from "./context";
import { actionCatalogue } from "./actions";
import { assistantActionContext } from "./action-context";
import { ASSISTANT_INTERACTION_CONTEXT } from "./interaction-context";
import { prepareAssistantSkills } from "./skills";
import { assistantStore, type AgentRow, type AssistantOwner, type SessionRow, type TurnRow } from "./store";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runDefinition, userSkillEnvironment, type AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "./prompts";
import { resolveLocale } from "../../i18n";
import { recentUserMessages } from "./user-quotes";
import { OntologyRetrievalClient } from "./ontology-retrieval";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { getPostgresPool as db, qualifiedTable as table } from "../../infrastructure/postgres";
import { createLogger } from "../../logging/logger";
const logger = createLogger("assistant");

export interface AssistantPreparation {
  a: AgentRow; session: SessionRow; turn: TurnRow; message: string;
  owner: AssistantOwner; credentials: AssistantCredentials;
}
export async function prepareAnalystRun({ a, session, turn, message, owner, credentials }: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const sessionId = session.id, id = turn.id;
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  const ontologyContext = await assistantOntologyContext(a, credentials);
  let actionContext = "";
  try {
    const actions = await actionCatalogue(owner, credentials);
    const executions = (await db().query(`SELECT action_id,status,parameters,result,error FROM ${table("assistant_action_executions")} WHERE session_id=$1 AND domain_id=$2 AND owner_id=$3 ORDER BY created_at DESC LIMIT 20`,
      [sessionId, owner.domainId, owner.userId])).rows;
    actionContext = assistantActionContext(actions, executions);
  } catch (error) {
    logger.warn("Action discovery unavailable for assistant turn", error);
  }
  const skills = await prepareAssistantSkills(owner.domainId, a.skills);
  const skillEnvironment = userSkillEnvironment(credentials);
  const continuationIds = new Set<string>();
  for (const previous of await assistantStore.turns(sessionId)) {
    if (previous.id === id) continue;
    for (const link of await new OntologyRetrievalClient(owner, previous.retrieval_scope_id).links()) continuationIds.add(link.retrievalId);
  }
  const userMessages = recentUserMessages(
    (await client.session(sessionId)).messages, id, message, new Date(turn.created_at).getTime(),
  );
  await new OntologyRetrievalClient(owner, turn.retrieval_scope_id).open({
    classNames: turn.class_names,
    continuationIds: [...continuationIds].sort(),
    deadlineAt: new Date(new Date(turn.created_at).getTime() + getQueryTimeoutMs()).toISOString(),
    recentUserMessages: userMessages,
  }, credentials);
  return {
    language: resolveLocale(credentials.locale),
    input: { role: "user", content: message, timestamp: new Date(turn.created_at).getTime() },
    definition: { agentId: session.agent_id, ...runDefinition(
      effectiveSystemPrompt(a, resolveLocale(credentials.locale)) + "\n\nInitial ontology context:\n" + ontologyContext +
        "\n\n" + ARTIFACT_MARKDOWN_PROMPT + actionContext + ASSISTANT_INTERACTION_CONTEXT,
      a.model_selection.modelId, skills, credentials.locale,
      a.enabled_mcp_service_ids.map((serviceId) => ({ id: serviceId })),
    ) },
    environment: {
      values: {
        ...skillEnvironment.values,
        ONTOMATO_ASSISTANT_SESSION_ID: sessionId,
        ONTOMATO_RETRIEVAL_CALLER_ID: turn.retrieval_scope_id,
      },
      secrets: skillEnvironment.secrets,
    },
  };
}
