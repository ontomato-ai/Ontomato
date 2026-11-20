import { z } from "zod";
import { panelReadResultIdSchema } from "./panel-operations";
import { directProjectionInputTypeSchema } from "./panel-projection";
import { workspacePathSchema } from "./workspaces";

/** Written by the image build beside its exact SDK version directory. */
export const appsSdkBuildSchema = z.object({
  version: z.string().min(1),
  /** SHA-256 of the release's final uncompressed files. */
  digest: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();

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

const name = z.string().min(1);
const componentPortSchema = z.object({
  name,
  type: z.string(),
  description: z.string(),
}).strict();
const componentPropSchema = componentPortSchema.extend({
  required: z.boolean(),
  default: z.string().optional(),
});
const componentConfigSchema = z.array(componentPropSchema);
export const appsSdkComponentDataSchema = z.record(name, z.object({
  results: z.array(panelReadResultIdSchema).min(1),
  required: z.boolean(),
  /** Read parameters this component can supply for this datum at runtime. */
  runtimeParams: z.array(name).optional(),
}).strict());
export type AppsSdkComponentData = z.infer<typeof appsSdkComponentDataSchema>;

export const appsSdkComponentCatalogEntrySchema = z.object({
  componentId: name,
  module: name,
  exportName: name,
  role: z.enum(["presentation", "control"]),
  meaning: name,
  effects: z.string().optional(),
  bindsElement: z.array(name).optional(),
  /** Omit this declaration for components that do not consume platform-supplied data. */
  data: appsSdkComponentDataSchema.optional(),
  config: componentConfigSchema.optional(),
  inputs: z.record(name, directProjectionInputTypeSchema).optional(),
  outputs: z.array(name).optional(),
  ports: z.object({
    props: componentConfigSchema,
    events: z.array(componentPortSchema),
    slots: z.array(componentPortSchema),
  }).strict(),
}).strict();
export type AppsSdkComponentCatalogEntry = z.infer<typeof appsSdkComponentCatalogEntrySchema>;

/** The generated components.json for one release. */
export const appsSdkComponentCatalogSchema = z.object({
  version: appsSdkBuildSchema.shape.version,
  components: z.array(appsSdkComponentCatalogEntrySchema),
}).strict();
export type AppsSdkComponentCatalog = z.infer<typeof appsSdkComponentCatalogSchema>;
