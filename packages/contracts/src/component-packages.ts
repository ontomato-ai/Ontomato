import { z } from "zod";
import { runtimeJsonValueSchema, runtimeRelativePathSchema } from "./agent-runtime-values";
import { appsSdkBuildSchema, appsSdkComponentCatalogEntrySchema } from "./apps-sdk";
import { directProjectionPortsSchema, panelLocalOperationNameSchema } from "./panel-projection";
import { productCurrentIdParamsSchema } from "./product-record-id";

export const COMPONENT_PACKAGES_PATH = "/api/component-packages";

export const componentPackageNameSchema = z.string().regex(
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u,
  "Expected a package name or a scoped package name",
);
export const componentPackageParamsSchema = z.object({ name: componentPackageNameSchema }).strict();

const nonblank = z.string().trim().min(1);
const packageIdentity = z.object({
  name: componentPackageNameSchema,
  version: nonblank,
  author: z.union([
    nonblank,
    z.object({ name: nonblank, email: nonblank.optional(), url: nonblank.optional() }).strict(),
  ]),
});

const entries = z.record(z.string().min(1), runtimeRelativePathSchema).refine(value => Object.keys(value).length > 0, "Declare at least one entry");
const styles = z.array(runtimeRelativePathSchema).optional();

function checkEntryNames(name: string, modules: Record<string, string>, ctx: z.RefinementCtx, path: string[]) {
  for (const entry of Object.keys(modules)) {
    const subpath = entry.slice(name.length + 1);
    if (entry === name || (entry.startsWith(name + "/") && runtimeRelativePathSchema.safeParse(subpath).success &&
        /^[a-zA-Z0-9._/-]+$/u.test(subpath))) continue;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, entry], message: `Expected module '${name}' or a subpath of it` });
  }
}

/** The product metadata read from the release root's package.json. Other npm metadata is ignored. */
export const componentPackageManifestSchema = packageIdentity.extend({
  ontomato: z.object({
    /** A JSON file containing an array of component declarations. */
    components: runtimeRelativePathSchema,
    /** Public module specifiers mapped to relative JavaScript entry files. */
    entries,
    styles,
  }).strict(),
}).superRefine(({ name, ontomato }, ctx) => checkEntryNames(name, ontomato.entries, ctx, ["ontomato", "entries"]));
export type ComponentPackageManifest = z.infer<typeof componentPackageManifestSchema>;

const componentId = directProjectionPortsSchema.shape.componentId;
/** A component can describe which registered operations it can trigger without declaring their signatures or granting use. */
export const componentPackageComponentSchema = appsSdkComponentCatalogEntrySchema.extend({
  componentId,
  operations: z.array(z.object({
    name: panelLocalOperationNameSchema,
    handlerRef: nonblank,
  }).strict()).optional(),
});
export const componentPackageComponentsSchema = z.array(componentPackageComponentSchema).nonempty();
export type ComponentPackageComponent = z.infer<typeof componentPackageComponentSchema>;

const bytes = z.instanceof(Uint8Array);
const mode = z.enum(["inspect", "install"]);
/**
 * POST /api/component-packages/install accepts multipart/form-data with a text "mode" part.
 * Send one ZIP part named "archive", or file parts named "files" whose filenames are relative to the package root.
 * Inspect validates and fingerprints the candidate without changing the deployment.
 * This schema validates the request after decoding the parts.
 */
export const componentPackageInstallRequestSchema = z.union([
  z.object({ mode, archive: bytes }).strict(),
  z.object({ mode, files: z.array(z.object({ path: runtimeRelativePathSchema, bytes }).strict()).nonempty() }).strict(),
]);
export type ComponentPackageInstallRequest = z.infer<typeof componentPackageInstallRequestSchema>;

/** The deployment selects one release per package. The root is the same-origin URL path of the immutable release. */
export const currentComponentPackageSchema = packageIdentity.extend({
  digest: appsSdkBuildSchema.shape.digest,
  artifactRoot: z.string().regex(/^\/(?:[^/?#\\\s]+\/)+$/u, "Expected a public release path ending with '/'"),
}).strict();
export type CurrentComponentPackage = z.infer<typeof currentComponentPackageSchema>;

/**
 * Install and GET /api/component-packages/:name return the selected release and its static declarations.
 * Inspect returns the same shape for the candidate, with the artifactRoot it would have when installed.
 */
export const componentPackageResponseSchema = currentComponentPackageSchema.extend({
  components: componentPackageComponentsSchema,
  entries,
  styles,
}).superRefine(({ name, components, entries }, ctx) => {
  checkEntryNames(name, entries, ctx, ["entries"]);
  const seen = new Set<string>();
  for (const [index, component] of components.entries()) {
    const path = ["components", index];
    if (!component.componentId.startsWith(name + ":")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "componentId"], message: `Expected component ID prefixed with '${name}:'` });
    } else if (seen.has(component.componentId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "componentId"], message: `Duplicate component '${component.componentId}'` });
    }
    seen.add(component.componentId);
    if (!Object.hasOwn(entries, component.module)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "module"], message: `No entry for module '${component.module}'` });
    }
  }
});
export const componentPackageInstallResponseSchema = componentPackageResponseSchema;
export type ComponentPackageResponse = z.infer<typeof componentPackageResponseSchema>;

export const COMPONENT_PACKAGE_INCOMPATIBLE = "COMPONENT_PACKAGE_INCOMPATIBLE";
const productId = productCurrentIdParamsSchema.shape.id;

/** HTTP 409. IDs are limited to affected resources the caller may see. Omit a shape when that side has no field. */
export const componentPackageUpgradeErrorSchema = z.object({
  success: z.literal(false),
  error: nonblank,
  code: z.literal(COMPONENT_PACKAGE_INCOMPATIBLE),
  details: z.object({
    package: componentPackageNameSchema,
    changes: z.array(z.object({
      component: componentId,
      field: nonblank,
      before: runtimeJsonValueSchema.optional(),
      after: runtimeJsonValueSchema.optional(),
      projectionIds: z.array(productId),
      panelIds: z.array(productId),
    }).strict()).nonempty(),
  }).strict(),
}).strict();
export type ComponentPackageUpgradeError = z.infer<typeof componentPackageUpgradeErrorSchema>;
