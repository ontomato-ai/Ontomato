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

/**
 * The DataRAG entries that write business object data, by method and path below the DataRAG root. A preview request is
 * marked at these entries and at no others; their owner refuses it. A definition, a model, a trigger's registration, a
 * workflow, an environment import and the platform's own objects are writes their owner judges against the caller's
 * permission, and a preview asks for them like any other caller.
 *
 * A trigger's manual run is here because an Action target runs as that request. `/writeFunctionOperation/query` is
 * absent because it reads; `/action/trial`, `/metricView/test` and `/ontology/ai/generation/…` are absent because they
 * write only inside the run's own sandbox.
 */
const businessDataWriteEntries: readonly (readonly [method: string, path: RegExp])[] = [
  ["POST", /^\/action\/execute$/u],
  ["POST", /^\/writeFunctionOperation\/(?:insert|update|delete|createEdge|deleteEdge|appendVector|updateVector|deleteVector)$/u],
  ["POST", /^\/vectorResource\/(?:upload|delete)$/u],
  ["POST", /^\/platform\/triggers\/[^/]+\/runs$/u],
];

/** Whether this DataRAG request is a business-data write, whose owner refuses it under a preview identity. */
export function entersBusinessDataWrite(method: string, path: string): boolean {
  const pathname = path.split("?")[0]!;
  return businessDataWriteEntries.some(([entry, pattern]) => entry === method.toUpperCase() && pattern.test(pathname));
}

/** Details of PREVIEW_SDK_UPGRADE_REQUIRED in the existing HTTP error envelope. */
export const sdkUpgradeDetailsSchema = z.object({
  requiredVersion: z.string(), foundVersions: z.array(z.string()),
  upgrade: z.object({ kind: z.literal("edit-workspace-references"), currentCommand: z.literal("sdk current"),
    readCommands: z.array(z.string()), steps: z.array(z.string()) }),
});
export type SdkUpgradeDetails = z.infer<typeof sdkUpgradeDetailsSchema>;
