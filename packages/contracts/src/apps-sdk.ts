import { z } from "zod";

/** Written by the image build beside its exact SDK version directory. */
export const appsSdkBuildSchema = z.object({ version: z.string().min(1) }).strict();
/** Browser-facing paths include publicBasePath exactly once. */
export const appsSdkCurrentSchema = z.object({
  version: z.string(),
  publicBasePath: z.string(),
  sdkBasePath: z.string(),
  manifestPath: z.string(),
  docsPath: z.string(),
  referencePath: z.string(),
}).strict();
export type AppsSdkCurrent = z.infer<typeof appsSdkCurrentSchema>;
