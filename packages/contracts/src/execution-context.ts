import { z } from "zod";

/** Internal execution identity carried by preview frames and preview-run callback proxies. */
export const EXECUTION_CONTEXT_HEADER = "X-Ontomato-Execution-Context";
export const PREVIEW_WRITE_FORBIDDEN = "PREVIEW_WRITE_FORBIDDEN";
export const PREVIEW_WRITE_MESSAGE = "预览里不执行写操作，动作的对错用动作试跑验";
export const PREVIEW_SDK_CAPABILITY = 1;

/** What a frame runs on. Preview is an identity for write admission only; reads stay live. */
export type AppExecutionContext = { kind: "live" } | { kind: "preview" };

export const previewExecutionContextValue = { kind: "preview" } as const;
export const previewExecutionContextHeader = JSON.stringify(previewExecutionContextValue);

/** Where a request goes below the platform's API root: Node at `""`, DataRAG at `"/data-query"`. */
type PlatformService = "" | "/data-query";

/**
 * The entries a preview identity is carried to, by service, method and path below the API root, and the only ones. In a
 * preview, writing formal business data, and starting or advancing a formal run, are refused with
 * PREVIEW_WRITE_FORBIDDEN; only reads, and the writes that build (saving a definition, registering, workspace files), go
 * through, judged by their owner against the caller's permission.
 *
 * - DataRAG writes business data at `/action/execute`, the `/writeFunctionOperation/…` writes (`query` reads) and
 *   `/vectorResource/upload|delete`, and runs a trigger now at `/platform/triggers/{id}/runs`, whatever it targets.
 * - Praxis, through Node's `/praxis`, starts a workflow run (`/runs`), advances one (`/runs/{id}/tick`), changes its case
 *   (`/runs/{id}/case/submit|fill|close`) or its business target (`/runs/{id}/acts-on`), and decides or reassigns a step
 *   (`/steps/{id}/decide|assign`).
 * - Node carries a prepared panel operation out as the caller at `/panel-operations/intents/{id}/dispatch`, and starts,
 *   stops or deletes a formal test run at `/observe/autotest/runs`, `/observe/autotest/runs/{id}/stop` and
 *   `DELETE /observe/autotest/runs/{id}`.
 * - Agent runs a preview starts are the preview's, so what they execute is refused at the entries above: Node's
 *   `/assistant/sessions`, `/observe/agent/sessions` and `/observe/diagnoses` conversations and their `/runs`, DataRAG's
 *   `/ontology/ai/sessions/{id}/runs` and the agent channel's `/platform/agent-channel/commands`.
 * - Stopping an agent run (`/assistant|observe/agent/sessions/{id}/runs/{run}/cancel`,
 *   `/ontology/ai/sessions/{id}/runs/{run}/cancel`) or deleting a conversation (`DELETE /assistant/sessions/{id}`,
 *   `DELETE /observe/agent/sessions/{id}`, `DELETE /ontology/ai/sessions/{id}`, and a workspace with its conversations,
 *   `DELETE /workspaces/{id}`) carries the identity too: a preview stops only a preview's run and deletes only what
 *   holds no live run. Writing a workspace's files is building and is not marked.
 * - A pending page operation is the preview's when a preview prepared it (`/panel-operations/intents`,
 *   `/panel-operations/local-confirmations`), and dispatching, cancelling or claiming one
 *   (`/panel-operations/intents/{id}/dispatch|cancel`, `/panel-operations/questions/{id}/cancel-if-pending`,
 *   `/panel-operations/local-confirmations/{id}/claim`) carries the identity: a preview decides only a preview's.
 *
 * `/action/trial`, `/metricView/test` and `/ontology/ai/generation/…` write only inside the run's own sandbox.
 */
const previewEntries: readonly (readonly [service: PlatformService, method: string, path: RegExp])[] = [
  ["/data-query", "POST", /^\/action\/execute$/iu],
  ["/data-query", "POST", /^\/writeFunctionOperation\/(?:insert|update|delete|createEdge|deleteEdge|appendVector|updateVector|deleteVector)$/iu],
  ["/data-query", "POST", /^\/vectorResource\/(?:upload|delete)$/iu],
  ["/data-query", "POST", /^\/platform\/triggers\/[^/]+\/runs$/iu],
  ["/data-query", "POST", /^\/ontology\/ai\/sessions\/[^/]+\/runs$/iu],
  ["/data-query", "POST", /^\/platform\/agent-channel\/commands$/iu],
  ["/data-query", "POST", /^\/ontology\/ai\/sessions\/[^/]+\/runs\/[^/]+\/cancel$/iu],
  ["", "POST", /^\/praxis\/(?:runs|runs\/[^/]+\/(?:tick|acts-on|case\/(?:submit|fill|close))|steps\/[^/]+\/(?:decide|assign))$/iu],
  ["", "POST", /^\/panel-operations\/intents\/[^/]+\/dispatch$/iu],
  ["", "POST", /^\/panel-operations\/(?:intents|local-confirmations)$/iu],
  ["", "POST", /^\/panel-operations\/(?:intents\/[^/]+\/cancel|questions\/[^/]+\/cancel-if-pending|local-confirmations\/[^/]+\/claim)$/iu],
  ["/data-query", "DELETE", /^\/ontology\/ai\/sessions\/[^/]+$/iu],
  ["", "DELETE", /^\/(?:assistant|observe\/agent)\/sessions\/[^/]+$/iu],
  ["", "DELETE", /^\/workspaces\/[^/]+$/iu],
  ["", "POST", /^\/assistant\/sessions$/iu],
  ["", "POST", /^\/assistant\/sessions\/[^/]+\/runs$/iu],
  ["", "POST", /^\/(?:assistant|observe\/agent)\/sessions\/[^/]+\/runs\/[^/]+\/cancel$/iu],
  ["", "POST", /^\/observe\/agent\/sessions$/iu],
  ["", "POST", /^\/observe\/agent\/sessions\/[^/]+\/runs$/iu],
  ["", "POST", /^\/observe\/diagnoses$/iu],
  ["", "POST", /^\/observe\/autotest\/runs$/iu],
  ["", "POST", /^\/observe\/autotest\/runs\/[^/]+\/stop$/iu],
  ["", "DELETE", /^\/observe\/autotest\/runs\/[^/]+$/iu],
];

/** A path's percent-decoded spelling, or none when its encoding is malformed: no owner routes such a path. */
function decodedSpellings(path: string): string[] {
  try {
    return [decodeURIComponent(path)];
  } catch (error) {
    if (error instanceof URIError) return [];
    throw error;
  }
}

/**
 * Whether a preview's request to this service carries its identity. The path is read as loosely as any owner routes it,
 * so a spelling that still reaches one of these entries is never left unmarked: with or without percent-decoding, in any
 * letter case, with repeated or a trailing slash.
 */
export function carriesPreviewIdentity(service: string, method: string, path: string): boolean {
  const raw = path.split("?")[0]!;
  const spellings = [raw, ...decodedSpellings(raw)].map(spelling => spelling.replace(/\/{2,}/gu, "/").replace(/(?<=.)\/$/u, ""));
  return previewEntries.some(([entryService, entryMethod, pattern]) => entryService === service
    && entryMethod === method.toUpperCase() && spellings.some(spelling => pattern.test(spelling)));
}

/** Details of PREVIEW_SDK_UPGRADE_REQUIRED in the existing HTTP error envelope. */
export const sdkUpgradeDetailsSchema = z.object({
  requiredVersion: z.string(), foundVersions: z.array(z.string()),
  upgrade: z.object({ kind: z.literal("edit-workspace-references"), currentCommand: z.literal("sdk current"),
    readCommands: z.array(z.string()), steps: z.array(z.string()) }),
});
export type SdkUpgradeDetails = z.infer<typeof sdkUpgradeDetailsSchema>;
