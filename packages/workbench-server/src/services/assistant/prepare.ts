import type { AgentInput } from "@ontomato/contracts/agent-channel";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import { ASSISTANT_INTERACTION_CONTEXT } from "./interaction-context";
import { prepareAssistantSkills } from "./skills";
import { assistantStore, type AgentRow, type AssistantOwner, type SessionRow, type TurnRow } from "./store";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runDefinition, userSkillEnvironment, type AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "./prompts";
import {assistantOntologyContext} from "./context";
import {executionSkillEnvironment} from "./execution-callback";
import {executionCallerCredentials} from "./execution";
import { resolveLocale } from "../../i18n";
import { recentUserMessages } from "./user-quotes";
import { OntologyRetrievalClient } from "./ontology-retrieval";
import { getQueryTimeoutMs } from "../../config/query-settings";
import {profileForSession} from '../product-assets/agent-profile';
import {profileRuntimeTools} from '../product-assets/runtime-tools';
import {callbackCredential} from '../agent-runtime/callback-credential';
import {environment} from '../../config/environment';

export interface AssistantPreparation {
  a: AgentRow; session: SessionRow; turn: TurnRow; message: string; input: AgentInput; inputId: string; ontologyContext: string | null;
  owner: AssistantOwner; credentials: AssistantCredentials;
  executionUserId: string | null; executionCredentials: AssistantCredentials;
}
export async function prepareAnalystRun({ a, session, turn, input, inputId, ontologyContext, owner, credentials, executionUserId, executionCredentials }: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const sessionId = session.id, id = turn.id;
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  const businessCredentials = executionCallerCredentials(executionCredentials,id);
  const skillsProjectionCredentials = credentials;

  const continuationIds = new Set<string>();
  for (const previous of await assistantStore.turns(sessionId)) {
    if (previous.id === id) continue;
    for (const link of await new OntologyRetrievalClient(owner, previous.retrieval_scope_id).links()) continuationIds.add(link.retrievalId);
  }
  const userMessages = recentUserMessages(
    (await client.session(sessionId)).messages, inputId,
  );
  await new OntologyRetrievalClient(owner, turn.retrieval_scope_id).open({
    classNames: turn.class_names,
    continuationIds: [...continuationIds].sort(),
    deadlineAt: new Date(new Date(turn.created_at).getTime() + getQueryTimeoutMs()).toISOString(),
    recentUserMessages: userMessages, executionUserId,
  }, credentials);
  const profile=await profileForSession(owner,credentials,session.id,session.agent_id,businessCredentials);
  const skillEnvironment = profile ? {values:{ONTOMATO_WORKBENCH_URL:environment.agentRuntime().callbackUrl.replace(/\/$/,'')},secrets:{}} : executionUserId === null ? userSkillEnvironment(credentials) : executionSkillEnvironment(owner,credentials,id);
  const skills = profile?[]:await prepareAssistantSkills(owner.domainId, a, skillsProjectionCredentials);
  if(!profile)ontologyContext=await assistantOntologyContext(a,businessCredentials);
  return {
    language: resolveLocale(credentials.locale),
    input,
    definition: { agentId: session.agent_id, ...runDefinition(
      (profile?profile.instructions+'\n\nProduct projection interfaces (not authorization):\n'+JSON.stringify({tools:profile.tools,contextViews:profile.contextViews,issues:profile.issues,...('objectContext' in profile?{objectContext:profile.objectContext}:{})}):effectiveSystemPrompt(a, resolveLocale(credentials.locale))+"\n\nInitial ontology context:\n"+ontologyContext) +
        "\n\n" + ARTIFACT_MARKDOWN_PROMPT + ASSISTANT_INTERACTION_CONTEXT,
      a.model_selection.modelId, skills, credentials.locale,
      profile?[]:a.enabled_mcp_service_ids.map((serviceId) => ({ id: serviceId })),
    ),...(profile?{productTools:profileRuntimeTools(profile,sessionId),toolSurface:'product' as const}:{}) },
    environment: {
      values: {
        ...skillEnvironment.values,
        ONTOMATO_ASSISTANT_SESSION_ID: sessionId,
        ONTOMATO_RETRIEVAL_CALLER_ID: turn.retrieval_scope_id,
      },
      secrets:{...skillEnvironment.secrets,...(profile?{ONTOMATO_PRODUCT_CALLBACK:callbackCredential({pathPrefix:`/api/product-assets/${encodeURIComponent(profile.id)}/releases/${profile.releaseId}/tools/`,runId:id,expiresAt:Date.now()+getQueryTimeoutMs(),token:credentials.token??'',apiKey:credentials.apiKey??''}).value}:{})},
    },
  };
}
