import { z } from "zod";
import { directPanelPortTypeSchema } from "./panel-manifest";
import { panelReadResultIdSchema } from "./panel-operations";
import { directProjectionInputTypeSchema, panelLocalOperationNameSchema } from "./panel-projection";
import { componentDataSchema, componentDeclarationBase, componentConfigSchema, componentPortSchema } from "./component-declaration";
import { componentIdSchema } from "./product-record-id";
import { SDK_UI_ENTRY_SPECIFIER } from "./sdk-ui-map";
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

export const appsSdkComponentDataSchema = componentDataSchema(z.lazy(() => panelReadResultIdSchema));
export type AppsSdkComponentData = z.infer<typeof appsSdkComponentDataSchema>;

export function appsSdkComponentDatum(data: AppsSdkComponentData | undefined, datum: string) {
  return data && Object.hasOwn(data, datum) ? data[datum] : data?.["*"];
}

const componentDeclarationBaseSchema = componentDeclarationBase(
  appsSdkComponentDataSchema, z.lazy(() => directProjectionInputTypeSchema), z.lazy(() => directPanelPortTypeSchema),
);
const operations = z.array(z.object({
  name: z.lazy(() => panelLocalOperationNameSchema),
  handlerRef: z.string().trim().min(1),
}).strict()).optional();

export const componentDeclarationSchema = componentDeclarationBaseSchema.extend({
  componentId: componentIdSchema, operations,
});
export type ComponentDeclaration = z.infer<typeof componentDeclarationSchema>;

export const appsSdkComponentCatalogEntrySchema = componentDeclarationBaseSchema.extend({
  module: z.string().min(1),
  exportName: z.string().min(1),
});
export type AppsSdkComponentCatalogEntry = z.infer<typeof appsSdkComponentCatalogEntrySchema>;

/** The product catalogue includes declarations with either deployment or domain source. */
export const productComponentDefinitionSchema = appsSdkComponentCatalogEntrySchema
  .partial({ module: true, exportName: true }).extend({ operations });

/** Public UI primitive entry declared by the SDK itself (no third-party library names exposed). */
export const appsSdkUiPrimitiveEntrySchema = z.object({
  tag: z.string().regex(/^sdk-[a-z][a-z0-9-]*$/u, "Expected an sdk-* template tag"),
  exportName: z.string().regex(/^Sdk[A-Z][A-Za-z0-9]*$/u, "Expected an Sdk* export name"),
  module: z.literal(SDK_UI_ENTRY_SPECIFIER),
  description: z.string().optional(),
  props: componentConfigSchema,
  events: z.array(componentPortSchema),
  slots: z.array(componentPortSchema),
}).strict();
export type AppsSdkUiPrimitiveEntry = z.infer<typeof appsSdkUiPrimitiveEntrySchema>;

/** Public UI directive exposed under `v-sdk-*` and `@ontomato/sdk/ui`. */
export const appsSdkUiDirectiveEntrySchema = z.object({
  name: z.string().regex(/^v-sdk-[a-z][a-z0-9-]*$/u, "Expected a v-sdk-* directive name"),
  exportName: z.string().regex(/^vSdk[A-Z][A-Za-z0-9]*$/u, "Expected a vSdk* directive export name"),
  module: z.literal(SDK_UI_ENTRY_SPECIFIER),
  description: z.string().min(1),
}).strict();
export type AppsSdkUiDirectiveEntry = z.infer<typeof appsSdkUiDirectiveEntrySchema>;

/** Author-facing CSS custom property declared by the SDK theme token catalogue. */
export const appsSdkThemeTokenEntrySchema = z.object({
  name: z.string().regex(/^--[a-z][a-z0-9-]*$/u, "Expected a CSS custom property name"),
  kind: z.enum(["color", "length", "elevation", "font", "shadow"]),
  overridable: z.boolean(),
}).strict();
export type AppsSdkThemeTokenEntry = z.infer<typeof appsSdkThemeTokenEntrySchema>;

/** The generated components.json for one release. */
export const appsSdkComponentCatalogSchema = z.object({
  version: appsSdkBuildSchema.shape.version,
  components: z.array(appsSdkComponentCatalogEntrySchema),
  uiPrimitives: z.array(appsSdkUiPrimitiveEntrySchema).optional(),
  uiDirectives: z.array(appsSdkUiDirectiveEntrySchema).optional(),
  themeTokens: z.array(appsSdkThemeTokenEntrySchema).optional(),
}).strict();
export type AppsSdkComponentCatalog = z.infer<typeof appsSdkComponentCatalogSchema>;
