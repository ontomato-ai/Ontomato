import { z } from "zod";

/** Internal execution identity carried by preview frames and preview-run callback proxies. */
export const EXECUTION_CONTEXT_HEADER = "X-Ontomato-Execution-Context";
export const PREVIEW_WRITE_FORBIDDEN = "PREVIEW_WRITE_FORBIDDEN";
export const PREVIEW_WRITE_MESSAGE = "预览里不执行写操作，动作的对错用动作试跑验";
export const PREVIEW_CONVERSATION_WRITE_MESSAGE = "这是正式对话，预览里不能接着聊，请新开一个对话";
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
 * - Node carries a prepared panel operation out at `/panel-operations/intents/{id}/dispatch`: as the caller, or as the
 *   preview that prepared it (`/panel-operations/intents` records a preview's identity on the operation it prepares),
 *   so what it executes is refused at the entries above.
 * - Agent runs a preview starts are the preview's, so what they execute is refused at the entries above: Node's
 *   `/assistant/sessions`, `/observe/agent/sessions` and `/observe/diagnoses` conversations and their `/runs`, DataRAG's
 *   `/ontology/ai/sessions/{id}/runs` and the agent channel's `/platform/agent-channel/commands`.
 *
 * Stopping, cancelling or deleting runs, conversations and workspaces, the platform's own records of pending page
 * operations (cancelling one, claiming a local confirmation), and ops test runs are not business writes: they are never
 * marked.
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
  ["", "POST", /^\/praxis\/(?:runs|runs\/[^/]+\/(?:tick|acts-on|case\/(?:submit|fill|close))|steps\/[^/]+\/(?:decide|assign))$/iu],
  ["", "POST", /^\/panel-operations\/intents\/[^/]+\/dispatch$/iu],
  ["", "POST", /^\/panel-operations\/intents$/iu],
  ["", "POST", /^\/assistant\/sessions$/iu],
  ["", "POST", /^\/assistant\/sessions\/[^/]+\/runs$/iu],
  ["", "POST", /^\/observe\/agent\/sessions$/iu],
  ["", "POST", /^\/observe\/agent\/sessions\/[^/]+\/runs$/iu],
  ["", "POST", /^\/observe\/diagnoses$/iu],
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
