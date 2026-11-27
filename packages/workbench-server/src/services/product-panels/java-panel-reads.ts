import { z } from "zod";
import type { ProductPanelReadSource } from "@ontomato/contracts/panel-host";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { applicationEntryResolutionSchema, panelApplicationEntryUseSchema, type ApplicationEntryResolutionQuery, type ApplicationPanelUse, type PanelUseRef } from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { objectVisibilityRangeSchema, type ObjectDefinition, type ObjectKind, type ObjectVerb } from "../product-governance/authorization";
import { productGovernanceServiceHeaders } from "../product-governance/service-authentication";

type RegisteredSource = Extract<ProductPanelReadSource, { kind: "registered" | "frame" }>;

export type PanelReadVisibility = { kind: ObjectKind; verbs: readonly ObjectVerb[] };

export interface JavaPanelRead {
  source: RegisteredSource;
  registration: { panelId: string | null; framePanelId: string | null; inputs: ApplicationPanelUse["inputs"] };
  uses: readonly ObjectDefinition[];
  visibleKinds?: readonly PanelReadVisibility[];
  call?: {
    type: string;
    name: string;
    parameters: Record<string, RuntimeJsonValue>;
  };
  timeoutMs?: number;
}

const viewerSchema = z.object({ userId: z.string().min(1), domainId: z.string().min(1), userName: z.string().nullish() });
export type JavaPanelViewer = z.infer<typeof viewerSchema>;
const registeredEntrySchema = applicationEntryResolutionSchema.pick({ applicationId: true, framePanelId: true })
  .extend({ use: panelApplicationEntryUseSchema });
export type JavaRegisteredPanelEntry = z.infer<typeof registeredEntrySchema>;
export type JavaPanelLocateRef = PanelUseRef & { kind?: "registered" | "frame" };
const registeredResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), entry: registeredEntrySchema }),
  z.object({ kind: z.literal("error"), status: z.number().int(), code: z.string().optional(), error: z.string() }),
]);
const visibilitySchema = z.record(z.record(objectVisibilityRangeSchema));
export type PanelReadRanges = z.infer<typeof visibilitySchema>;
const openReplySchema = z.object({
  viewer: viewerSchema,
  entry: applicationEntryResolutionSchema.omit({ pageSkillContext: true }).extend({
    allowStandalone: z.boolean(),
  }),
  visibility: visibilitySchema,
});

export const javaPanelReadResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), payload: z.unknown().optional(), visibility: visibilitySchema.optional() }),
  z.object({ status: z.literal("empty") }),
  z.object({ status: z.literal("forbidden"), code: z.string().nullish(), error: z.string() }),
  z.object({ status: z.literal("error"), code: z.string().nullish(), error: z.string() }),
]);
export type JavaPanelReadResult = z.infer<typeof javaPanelReadResultSchema>;

export interface PreparedOwnerReadFacts {
  facts: readonly Pick<JavaPanelRead, "call" | "visibleKinds">[];
  present(viewer: JavaPanelViewer, facts: readonly JavaPanelReadResult[]): unknown | Promise<unknown>;
}

async function requestJavaPanelReads<T>(
  payload: object, credentials: AssistantCredentials, reply: z.ZodType<T, z.ZodTypeDef, unknown>, retrievalScopeId?: string,
) {
  const { token, apiKey, locale } = credentials;
  const headers = buildBackendHeaders(token, undefined, locale, token ? undefined : apiKey, {
    ...productGovernanceServiceHeaders(),
    ...(retrievalScopeId !== undefined && { "X-Ontomato-Retrieval-Caller-Id": retrievalScopeId }),
  });
  const response = await backendPost("workbench-panel-reads", `${config.dataQuery.baseUrl.replace(/\/$/u, "")}/internal/workbench-panel-reads`,
    payload, { headers, retries: 1 });
  const parsed = reply.safeParse(JSON.parse(response.text));
  if (!parsed.success) throw new HttpError(502, "Invalid response from the panel read owner", "PANEL_READ_OWNER_RESPONSE_INVALID");
  return parsed.data;
}

export function openViaJava(entry: ApplicationEntryResolutionQuery, visibleKinds: readonly PanelReadVisibility[], credentials: AssistantCredentials) {
  return requestJavaPanelReads({ kind: "open", entry, visibleKinds }, credentials, openReplySchema);
}

export function locateViaJava(entries: readonly JavaPanelLocateRef[], credentials: AssistantCredentials) {
  return requestJavaPanelReads({ kind: "locate", entries }, credentials, z.object({
    viewer: viewerSchema, entries: z.array(registeredResultSchema.catch({
      kind: "error", status: 502, code: "PANEL_READ_OWNER_RESPONSE_INVALID", error: "Invalid entry from the panel read owner",
    })).length(entries.length),
  }));
}

export function readViaJava(viewer: JavaPanelViewer, reads: readonly JavaPanelRead[], credentials: AssistantCredentials, retrievalScopeId?: string) {
  const { userId, domainId } = viewer;
  return requestJavaPanelReads({ kind: "read", viewer: { userId, domainId }, reads }, credentials, z.object({
    viewer: viewerSchema, results: z.array(javaPanelReadResultSchema.catch({
      status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID", error: "Invalid item from the panel read owner",
    })).length(reads.length),
  }), retrievalScopeId);
}
