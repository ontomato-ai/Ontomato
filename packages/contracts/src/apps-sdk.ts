import { z } from "zod";
import { componentDeclarationBaseSchema } from "./component-declaration";
export { appsSdkComponentDataSchema, appsSdkComponentDatum, type AppsSdkComponentData } from "./component-declaration";
import { workspacePathSchema } from "./workspaces";

/** Written by the image build beside its exact SDK version directory. */
export const appsSdkBuildSchema = z.object({
  version: z.string().min(1),
  /** SHA-256 of the release's final uncompressed files. */
  digest: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();

/** The component authoring tool is downloaded from the same release as the checker. */
export const APPS_SDK_PACKAGE_COMPONENTS_PATH = "node/package-components.mjs";

/** Files in sdk.json are relative to the root of the release which contains it. */
export const appsSdkReleaseManifestSchema = z.object({
  version: appsSdkBuildSchema.shape.version,
  product: z.string().min(1),
  executionContext: z.number().int().positive(),
  hostTransport: z.number().int().positive(),
  messageBridge: z.number().int().positive(),
  entries: z.record(workspacePathSchema),
  stylesheet: workspacePathSchema,
  components: workspacePathSchema,
  check: workspacePathSchema,
  packageComponents: z.literal(APPS_SDK_PACKAGE_COMPONENTS_PATH),
  libraries: z.record(z.string()),
  docs: workspacePathSchema,
}).strict();
export type AppsSdkReleaseManifest = z.infer<typeof appsSdkReleaseManifestSchema>;

/** Browser-facing paths include publicBasePath exactly once. */
export const appsSdkCurrentSchema = appsSdkBuildSchema.extend({
  publicBasePath: z.string(),
  sdkBasePath: z.string(),
  manifestPath: z.string(),
  componentsPath: z.string(),
  checkPath: z.string(),
  docsPath: z.string(),
  referencePath: z.string(),
}).strict();
export type AppsSdkCurrent = z.infer<typeof appsSdkCurrentSchema>;

export const appsSdkComponentCatalogEntrySchema = componentDeclarationBaseSchema.extend({
  module: z.string().min(1),
  exportName: z.string().min(1),
});
export type AppsSdkComponentCatalogEntry = z.infer<typeof appsSdkComponentCatalogEntrySchema>;

/** The generated components.json for one release. */
export const appsSdkComponentCatalogSchema = z.object({
  version: appsSdkBuildSchema.shape.version,
  components: z.array(appsSdkComponentCatalogEntrySchema),
}).strict();
export type AppsSdkComponentCatalog = z.infer<typeof appsSdkComponentCatalogSchema>;
