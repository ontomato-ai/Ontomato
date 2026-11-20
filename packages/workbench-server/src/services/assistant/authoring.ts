import { getQueryTimeoutMs } from "../../config/query-settings";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { APP_BUILDER_SKILL } from "../app-builder/definition";
import { restoreAgentCaller } from "../agent-host/caller";
import { WorkspaceBuildTests } from "../app-builder/build-tests";
import type { PageSkillEntrance, PageSkillSource } from "@ontomato/contracts/page-skills";
import { authoringAdoptionResponseSchema, type AuthoringKind, type AuthoringHostRun, type AuthoringHistoricalRun, type authoringOperations } from "@ontomato/contracts/authoring";
import { loadedPageSkillVersion, readAssistantSkillView, resolvePageSkillSource } from "./skills";
import { agentExecutionCredentials, ownedRun } from "./execution";
import { assistantStore, type AssistantOwner } from "./store";

const AUTHORING_PATH = "/ontology/ai/generation/platform";
export type AuthoringOperation = keyof typeof authoringOperations.action;

const draftKinds = new Map<string, AuthoringKind>([
  ["action.create", "action"],
  ["action.update", "action"],
  ["metric-view.create", "metric-view"],
  ["metric-view.update", "metric-view"],
]);

export function authoringDraftKind(operation: string) {
  return draftKinds.get(operation);
}

function java(path: string, domainId: string, body: unknown, credentials: AssistantCredentials = {}) {
  return backendPost("ontology-authoring", config.dataQuery.baseUrl.replace(/\/$/u, "") + AUTHORING_PATH + path, body, {
    headers: {
      ...buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey),
      "X-Domain-Id": domainId,
      "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken,
    },
    retries: 1,
    errorDetailLimit: 4096,
  });
}

// Authoring follows these product-owned uses, including when a locator has several members.
const authoringSources = {
  action: {
    entrance: { permissionCode: "action-management", pageKey: "actions" },
    source: { kind: "application-use", applicationId: "ontology", useId: "ontology-actions" },
  },
  "metric-view": {
    entrance: { permissionCode: "ontology-modeling", pageKey: "metric-views" },
    source: { kind: "application-use", applicationId: "ontology", useId: "ontology-metric-views" },
  },
} satisfies Record<AuthoringKind, { entrance: PageSkillEntrance; source: PageSkillSource }>;

async function authoringRun(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  runId: string,
  kind: AuthoringKind,
  sessionId?: string,
  appBuilderOnly = false,
) {
  const { run, turn } = await ownedRun(owner, runId);
  const channel = run.channel;
  if (!channel || channel.agent.providerId !== "workbench" || run.sessionId !== turn.session_id ||
      (sessionId && run.sessionId !== sessionId) || !turn.admitted) {
    throw new HttpError(404, "Authoring run not found", "NOT_FOUND");
  }
  if (!loadedPageSkillVersion(APP_BUILDER_SKILL, run.resolvedSkills)) {
    if (appBuilderOnly) throw new HttpError(403, "The App Builder skill is required", "FORBIDDEN");
    const { entrance, source } = authoringSources[kind];
    const view = await readAssistantSkillView(owner.domainId, credentials);
    const member = await resolvePageSkillSource(view, entrance, source);
    if (!member || !loadedPageSkillVersion(member, run.resolvedSkills)) {
      throw new HttpError(403, "The required authoring skill is not loaded in this run", "FORBIDDEN");
    }
  }
  return {
    run,
    turn,
    authority: channel.authority,
    actor: channel.actor,
    agentId: channel.agent.agentId,
    binding: {
      hostId: "workbench" as const,
      sessionId: turn.session_id,
      runId,
      ownerId: owner.userId,
      executionUserId: run.executionUserId ?? owner.userId,
      domainId: owner.domainId,
      classNames: turn.class_names,
      expiresAt: new Date(turn.created_at).getTime() + getQueryTimeoutMs(),
    },
  };
}

function requireActiveAuthoring({ run, turn, binding }: Awaited<ReturnType<typeof authoringRun>>) {
  if (run.status !== "running" || turn.settled || binding.expiresAt <= Date.now()) {
    throw new HttpError(409, "Authoring run is closed", "RUN_CLOSED");
  }
}

export async function executeAuthoring(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  runId: string,
  kind: AuthoringKind,
  operation: AuthoringOperation,
  input: unknown,
  sessionId?: string,
) {
  const authoring = await authoringRun(owner, credentials, runId, kind, sessionId);
  const { run, binding, authority, actor, agentId } = authoring;
  if (operation === "read-test") {
    const result = await java(`/${kind}/read-test`, owner.domainId, { run: binding, input }, { locale: credentials.locale });
    return JSON.parse(result.text);
  }
  requireActiveAuthoring(authoring);
  const caller = await restoreAgentCaller(actor, owner.domainId, false, credentials);
  const expiresAt = Math.min(binding.expiresAt, caller.expiresAt);
  const executor = await agentExecutionCredentials(agentId, run.executionUserId ?? null, owner, credentials);
  let target: AuthoringHostRun["target"] = { kind: "live" };
  if (authority.executionKind === "build-test") {
    const session = await assistantStore.session(binding.sessionId, owner);
    if (!session.workspace_id) throw new HttpError(422, "Build-test requires the run's workspace", "BUILD_TEST_WORKSPACE_REQUIRED");
    const context = await new WorkspaceBuildTests(owner, credentials, session.workspace_id).current();
    if (!context) throw new HttpError(422, "Start a build-test for this workspace", "BUILD_TEST_CONTEXT_REQUIRED");
    target = { kind: "build-test", contextId: context.contextId };
  }
  const result = await java(`/${kind}/${operation}`, owner.domainId, { run: { ...binding, expiresAt, target }, input }, executor);
  return JSON.parse(result.text);
}

/** The accepting host supplies the original run and either its immutable draft or the actual save input. */
export async function adoptAuthoringDefinition(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  input: { sessionId: string; runId: string; kind: AuthoringKind; definition: Record<string, unknown> },
) {
  const { run, binding } = await authoringRun(owner, credentials, input.runId, input.kind, input.sessionId);
  if (run.status === "stopped" && (run.stopReason !== "stop" || run.errorMessage)) {
    throw new HttpError(409, "Authoring run did not complete", "RUN_CLOSED");
  }
  return adoptDefinition(binding, input.kind, input.definition, credentials.locale);
}

/** App Builder submits the exact definition it is about to deliver from its current callback. */
export async function adoptAppBuilderDefinition(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  runId: string,
  kind: AuthoringKind,
  definition: Record<string, unknown>,
) {
  const authoring = await authoringRun(owner, credentials, runId, kind, undefined, true);
  requireActiveAuthoring(authoring);
  return adoptDefinition(authoring.binding, kind, definition, credentials.locale);
}

async function adoptDefinition(
  binding: AuthoringHistoricalRun,
  kind: AuthoringKind,
  definition: Record<string, unknown>,
  locale?: string,
) {
  const result = await java(`/${kind}/adopt`, binding.domainId, {
    run: binding,
    input: { definition },
  }, { locale });
  return authoringAdoptionResponseSchema.parse(JSON.parse(result.text));
}

export async function closeAuthoringRun(
  runId: string,
  sessionId: string,
  owner: AssistantOwner,
  outcome: "cancelled" | "terminal",
) {
  await java(`/${runId}/close`, owner.domainId, { sessionId, domainId: owner.domainId, ownerId: owner.userId, outcome });
}
