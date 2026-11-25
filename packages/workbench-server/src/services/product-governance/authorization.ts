import { z } from "zod";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { productDefinitionOwnerHeaders } from "./grants";

export type ObjectKind = "AGENT" | "PANEL" | "PROJECTION" | "COMPONENT" | "METRIC" | "READ_FUNCTION";
export type ObjectVerb = "USE" | "VIEW" | "EDIT";
export interface ObjectDefinition {
  target: { domainId: string; kind: ObjectKind; id: string };
  ownerFacts: { ownerId: string | null; state: "DRAFT" | "PUBLISHED" };
}
export type ObjectDecisionRequest = (ObjectDefinition & { verb: ObjectVerb }) | { create: ObjectKind };

const decisionSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }),
  z.object({ allowed: z.literal(false), code: z.string(), reason: z.string() }),
]);
type Decision = z.infer<typeof decisionSchema>;

async function post(path: string, body: unknown, credentials: AssistantCredentials): Promise<unknown> {
  const result = await backendPost(
    `object-authorization-${path}`, `${config.dataQuery.baseUrl}/authorization/objects/${path}`,
    body, { headers: productDefinitionOwnerHeaders(credentials), retries: 1 },
  );
  if (result.text.length) return JSON.parse(result.text);
}

export async function decideObjects(requests: readonly ObjectDecisionRequest[], credentials: AssistantCredentials): Promise<Decision[]> {
  const decisions: Decision[] = [];
  for (let offset = 0; offset < requests.length; offset += 200) {
    const batch = requests.slice(offset, offset + 200);
    const result = z.object({ decisions: z.array(decisionSchema).length(batch.length) })
      .parse(await post("decide-batch", { requests: batch }, credentials));
    decisions.push(...result.decisions);
  }
  return decisions;
}

export async function decideObject(request: ObjectDecisionRequest, credentials: AssistantCredentials): Promise<Decision> {
  const [decision] = await decideObjects([request], credentials);
  return decision;
}

export function requireAllowed(decision: Decision) {
  if (!decision.allowed) throw new HttpError(403, decision.reason, decision.code);
}

export async function requireObject(request: ObjectDecisionRequest, credentials: AssistantCredentials) {
  requireAllowed(await decideObject(request, credentials));
}

export type PublicationAccess = { kind: "domain" } | { kind: "policy"; policyId: string };
export async function writeFirstPublication(
  definition: ObjectDefinition, access: PublicationAccess, credentials: AssistantCredentials,
) {
  return z.object({ status: z.enum(["granted", "pending"]) })
    .parse(await post("first-publication", { ...definition, access }, credentials));
}

const agentPolicyGrantSchema = z.object({ policyId: z.string(), name: z.string(), level: z.enum(["USE", "VIEW", "EDIT"]) });
export async function readAgentAccess(definition: ObjectDefinition, credentials: AssistantCredentials) {
  return z.object({ shared: z.boolean(), grants: z.array(agentPolicyGrantSchema) })
    .parse(await post("agent-access", definition, credentials));
}

export async function replaceAgentLevel(
  definition: ObjectDefinition, policyId: string, level: ObjectVerb | null, credentials: AssistantCredentials,
) {
  await post("agent-level", { ...definition, policyId, level }, credentials);
}

export async function setAgentDomainUse(definition: ObjectDefinition, shared: boolean, credentials: AssistantCredentials) {
  await post("domain-use", { ...definition, shared }, credentials);
}

export async function retireObject(definition: ObjectDefinition, credentials: AssistantCredentials) {
  await post("retire", definition, credentials);
}
