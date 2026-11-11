import { z } from "zod";

export const BUILD_TEST_HEADER = "X-Ontomato-Execution-Context";
export const BUILD_TEST_SAMPLE_DIRECTORY = "test-data";
export const BUILD_TEST_SDK_CAPABILITY = 1;
export const buildTestContextSchema = z.object({
  contextId: z.string(), workspaceId: z.string(),
  status: z.enum(["PREPARING", "READY", "PREPARE_FAILED", "CLOSED", "EXPIRED"]),
  expiresAt: z.number(), classNames: z.array(z.string()),
  sampleSummary: z.object({ name: z.string().nullish(), classes: z.number(), sha256: z.string().nullable() }).passthrough(),
  prepareError: z.string().nullish(), cleanupError: z.string().nullish(), resources: z.array(z.unknown()),
});
export type BuildTestContext = z.infer<typeof buildTestContextSchema>;
/** What a frame runs on: live, or the build-test context Java answered for its workspace (NONE when Java has none). */
export type AppExecutionContext = { kind: "live" } | {
  kind: "build-test"; contextId: string | null; workspaceId: string;
  status: BuildTestContext["status"] | "NONE";
  expiresAt: number | null; sampleSummary: BuildTestContext["sampleSummary"] | null;
  sampleName: string; error: string | null;
};
export function buildExecutionContext(workspaceId: string, context: BuildTestContext | null): Extract<AppExecutionContext, {kind:"build-test"}> {
  return { kind: "build-test", workspaceId, contextId: context?.contextId ?? null, status: context?.status ?? "NONE",
    expiresAt: context?.expiresAt ?? null, sampleSummary: context?.sampleSummary ?? null,
    sampleName: context?.sampleSummary.name ?? "test-data/sample.json", error: context?.prepareError || context?.cleanupError || null };
}

/** details of BUILD_TEST_SDK_UPGRADE_REQUIRED in the existing HTTP error envelope. */
export const buildTestSdkUpgradeDetailsSchema=z.object({
  requiredVersion:z.string(),foundVersions:z.array(z.string()),
  upgrade:z.object({kind:z.literal("edit-workspace-references"),currentCommand:z.literal("sdk current"),
    readCommands:z.array(z.string()),steps:z.array(z.string())}),
});
export type BuildTestSdkUpgradeDetails=z.infer<typeof buildTestSdkUpgradeDetailsSchema>;
