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
 * The entries a preview identity is carried to, by service, method and path below the API root, and the only ones. Building
 * is never here: saving, publishing or deleting a definition, a model, a panel, an application or a trigger is judged by
 * its owner against the caller's permission. Running is: an entry that writes business data, or that starts on the spot
 * an execution which does, refuses a preview with PREVIEW_WRITE_FORBIDDEN.
 *
 * - DataRAG writes business data at `/action/execute`, the `/writeFunctionOperation/…` writes (`query` reads) and
 *   `/vectorResource/upload|delete`; `/platform/triggers/{id}/runs` runs a trigger now, whatever it targets.
 * - Node starts a workflow run at Praxis through `/praxis/runs` and carries a prepared panel operation out as the caller
 *   at `/panel-operations/intents/{id}/dispatch`.
 * - Node's `/assistant/sessions` and `/assistant/sessions/{id}/runs` make a conversation and its runs the preview's, so
 *   what those runs execute is refused at the entries above.
 *
 * `/action/trial`, `/metricView/test` and `/ontology/ai/generation/…` write only inside the run's own sandbox.
 */
const previewEntries: readonly (readonly [service: PlatformService, method: string, path: RegExp])[] = [
  ["/data-query", "POST", /^\/action\/execute$/iu],
  ["/data-query", "POST", /^\/writeFunctionOperation\/(?:insert|update|delete|createEdge|deleteEdge|appendVector|updateVector|deleteVector)$/iu],
  ["/data-query", "POST", /^\/vectorResource\/(?:upload|delete)$/iu],
  ["/data-query", "POST", /^\/platform\/triggers\/[^/]+\/runs$/iu],
  ["", "POST", /^\/praxis\/runs$/iu],
  ["", "POST", /^\/panel-operations\/intents\/[^/]+\/dispatch$/iu],
  ["", "POST", /^\/assistant\/sessions$/iu],
  ["", "POST", /^\/assistant\/sessions\/[^/]+\/runs$/iu],
];

/**
 * Whether a preview's request to this service carries its identity. The path is read as loosely as any owner routes it,
 * so a spelling that still reaches one of these entries is never left unmarked: with or without percent-decoding, in any
 * letter case, with repeated or a trailing slash.
 */
export function carriesPreviewIdentity(service: string, method: string, path: string): boolean {
  const raw = path.split("?")[0]!;
  const spellings = [raw, decodeURIComponent(raw)].map(spelling => spelling.replace(/\/{2,}/gu, "/").replace(/(?<=.)\/$/u, ""));
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
