import { z } from "zod";

/** Internal execution identity carried by every request a preview frame or preview-run callback proxy sends. */
export const EXECUTION_CONTEXT_HEADER = "X-Ontomato-Execution-Context";
export const PREVIEW_WRITE_FORBIDDEN = "PREVIEW_WRITE_FORBIDDEN";
export const PREVIEW_WRITE_MESSAGE = "预览里不执行写操作，动作的对错用动作试跑验";
export const PREVIEW_SDK_CAPABILITY = 1;

/** What a frame runs on. Preview is an identity for write admission only; reads stay live. */
export type AppExecutionContext = { kind: "live" } | { kind: "preview" };

/** The only preview identity value. Every other value is no identity. */
export const previewExecutionContextHeader = "preview";

/** Details of PREVIEW_SDK_UPGRADE_REQUIRED in the existing HTTP error envelope. */
export const sdkUpgradeDetailsSchema = z.object({
  requiredVersion: z.string(), foundVersions: z.array(z.string()),
  upgrade: z.object({ kind: z.literal("edit-workspace-references"), currentCommand: z.literal("sdk current"),
    readCommands: z.array(z.string()), steps: z.array(z.string()) }),
});
export type SdkUpgradeDetails = z.infer<typeof sdkUpgradeDetailsSchema>;
