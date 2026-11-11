import { createHash } from "node:crypto";
import { z } from "zod";
import { assistantActionProposalSchema, type AssistantActionOption } from "@ontomato/contracts/assistant-actions";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import { backendPost, buildBackendHeaders, checkBackendResponse } from "../../utils/backend-client";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AssistantOwner } from "./store";
import { assistantService } from "./service";

const storedActionSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().nullish(), status: z.string(), domainId: z.string(),
  modifyTimestamp: z.number().nullish(), codeHash: z.string().nullish(),
  businessMeaning: z.object({ operations: z.array(z.string()).optional() }).nullish(),
  function: z.object({ parameters: z.array(z.object({ name: z.string(), type: z.string(), description: z.string().nullish(), classNames: z.array(z.string()).optional() })) }),
});

export async function actionCatalogue(owner: AssistantOwner, credentials: AssistantCredentials): Promise<AssistantActionOption[]> {
  const response = await backendPost("assistant:action-catalogue", buildUrl(getApiConfig(), "/action/queryList"),
    { status: "PUBLISHED" }, { ...credentials, retries: 1 });
  const envelope = z.object({ success: z.boolean(), message: z.string().optional(), data: z.array(storedActionSchema).optional() }).parse(JSON.parse(response.text));
  if (!envelope.success) throw new HttpError(502, envelope.message || "Cannot read actions");
  return (envelope.data ?? []).filter((action) => action.status === "PUBLISHED" && action.domainId === owner.domainId).map((action) => ({
    id: action.id, name: action.name, description: action.description ?? "",
    version: createHash("sha256").update(JSON.stringify(action)).digest("hex"),
    parameters: action.function.parameters.map((parameter) => ({ ...parameter, description: parameter.description ?? "", required: true })),
    effects: action.businessMeaning?.operations ?? [],
  }));
}

export function validateActionParameters(action: AssistantActionOption, parameters: Record<string, unknown>) {
  const names = new Set(action.parameters.map((parameter) => parameter.name));
  if (Object.keys(parameters).some((name) => !names.has(name))) throw new HttpError(400, "Unknown action parameter", "INVALID_ACTION_PARAMETERS");
  for (const parameter of action.parameters) {
    if (!Object.hasOwn(parameters, parameter.name) || parameters[parameter.name] === undefined)
      throw new HttpError(400, `Missing parameter: ${parameter.name}`, "INVALID_ACTION_PARAMETERS");
    const value = parameters[parameter.name];
    if (value === null) continue;
    const type = parameter.type.replace(/^TYPE_/, "").toLowerCase();
    let valid = value !== undefined && value !== null;
    if (["string", "time", "date", "varchar", "text"].includes(type)) valid = typeof value === "string";
    else if (["number", "int", "integer", "long", "double", "float"].includes(type)) valid = typeof value === "number" && Number.isFinite(value) && (!["int", "integer", "long"].includes(type) || Number.isInteger(value));
    else if (type.endsWith("_array") || ["array", "dataset"].includes(type)) {
      valid = Array.isArray(value);
      if (valid && type === "number_array") valid = (value as unknown[]).every((item) => typeof item === "number" && Number.isFinite(item));
      if (valid && ["string_array", "time_array"].includes(type)) valid = (value as unknown[]).every((item) => typeof item === "string");
    } else if (["ontoobj", "object", "vector"].includes(type)) valid = Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (!valid) throw new HttpError(400, `Invalid parameter: ${parameter.name}`, "INVALID_ACTION_PARAMETERS");
  }
}

async function execution(artifactId: string, sessionId: string, owner: AssistantOwner) {
  return (await getPostgresPool().query(`SELECT status,parameters,result,error FROM ${t("assistant_action_executions")} WHERE artifact_id=$1 AND session_id=$2 AND domain_id=$3 AND owner_id=$4`,
    [artifactId, sessionId, owner.domainId, owner.userId])).rows[0] ?? null;
}

export async function actionCard(sessionId: string, artifactId: string, owner: AssistantOwner, credentials: AssistantCredentials) {
  const artifact = await assistantService.artifact(sessionId, artifactId, owner);
  if (!artifact.path.endsWith(".json") || artifact.size > 128 * 1024) throw new HttpError(400, "Invalid action proposal");
  const proposal = assistantActionProposalSchema.parse(JSON.parse((await assistantService.content(sessionId, artifactId, owner)).toString()));
  const action = (await actionCatalogue(owner, credentials)).find((item) => item.id === proposal.actionId);
  if (!action) throw new HttpError(404, "Action is no longer available", "ACTION_UNAVAILABLE");
  return { proposal, action, execution: await execution(artifactId, sessionId, owner) };
}

/** A durable claim precedes the write. Replays never issue another upstream execution. */
export async function confirmAction(sessionId: string, artifactId: string, owner: AssistantOwner, credentials: AssistantCredentials, parameters: Record<string, unknown>) {
  const card = await actionCard(sessionId, artifactId, owner, credentials);
  if (card.execution) return card.execution;
  if (card.proposal.version !== card.action.version) throw new HttpError(409, "Action changed; ask for a new proposal", "ACTION_CHANGED");
  validateActionParameters(card.action, parameters);
  const artifact = await assistantService.artifact(sessionId, artifactId, owner);
  const run = await assistantService.readRun(sessionId, artifact.runId, owner);
  if (run.run.status !== "stopped") throw new HttpError(409, "Wait for the answer to finish", "RUN_BUSY");
  const claim = await getPostgresPool().query(`INSERT INTO ${t("assistant_action_executions")} (artifact_id,session_id,domain_id,owner_id,action_id,action_version,parameters,status) VALUES($1,$2,$3,$4,$5,$6,$7,'executing') ON CONFLICT DO NOTHING`,
    [artifactId, sessionId, owner.domainId, owner.userId, card.action.id, card.action.version, JSON.stringify(parameters)]);
  if (!claim.rowCount) return execution(artifactId, sessionId, owner);
  let status = "unknown", result: unknown = null, error: string | null = null;
  try {
    const form = new FormData();
    form.set("id", card.action.id); form.set("param", JSON.stringify(parameters));
    const headers = buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey);
    delete headers["Content-Type"];
    // A write has no transport retry: an interrupted response cannot prove that no mutation happened.
    const response = await fetch(buildUrl(getApiConfig(), "/action/execute"), {
      method: "POST", headers, body: form, signal: AbortSignal.timeout(600_000),
    });
    await checkBackendResponse(response);
    const body = z.object({ success: z.boolean(), message: z.string().optional(), data: z.unknown().optional() }).parse(await response.json());
    status = body.success ? "succeeded" : "failed";
    result = body.data ?? null; error = body.success ? null : body.message ?? "Action execution failed";
  } catch {
    error = "The execution outcome could not be confirmed. Check the data before creating another proposal.";
  }
  await getPostgresPool().query(`UPDATE ${t("assistant_action_executions")} SET status=$2,result=$3,error=$4,finished_at=now() WHERE artifact_id=$1`,
    [artifactId, status, JSON.stringify(result), error]);
  return execution(artifactId, sessionId, owner);
}
