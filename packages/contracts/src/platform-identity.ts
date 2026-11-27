import { z } from "zod";
import { applicationMetadataSchema } from "./application-metadata";
import { applicationMenuEntrySchema, panelApplicationEntryUseSchema } from "./product-panels";

const names = applicationMetadataSchema.shape.names;
const sequence = z.string().regex(/^[0-9]+$/).refine((value) => BigInt(value) <= 9223372036854775807n);
const categories = z.enum(["business", "build", "admin"]);

export const applicationDeclarationSchema = applicationMetadataSchema.extend({
  panelUses: z.array(panelApplicationEntryUseSchema).optional(),
}).strict();
export type ApplicationDeclaration = z.infer<typeof applicationDeclarationSchema>;
export const builtinApplicationDeclarationSchema = applicationMetadataSchema.extend({
  panelUses: z.array(applicationMenuEntrySchema).optional(),
}).strict();
export const builtinApplicationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), kind: z.enum(["native", "link"]),
  rail: z.enum(["top", "apps", "bottom"]), category: categories, sort: z.number().int(),
  entry: z.object({ path: z.string(), renderer: z.string(), entryKey: z.string().min(1).optional(), home: z.string().optional() }),
  scheduleAdapter: z.string().nullable(), declaration: builtinApplicationDeclarationSchema,
  framePanelId: z.string().min(1).optional(),
  allowStandalone: z.boolean().optional(),
});
export type BuiltinApplication = z.infer<typeof builtinApplicationSchema>;
export const applicationCatalogSchema = z.array(z.object({
  id: z.string(), kind: z.enum(["native", "hosted", "connected", "link",'product']), names,
  ownerService: z.string().min(1).optional(),
  descriptions: z.record(z.string()), icon: z.string(), rail: z.enum(["top", "apps", "bottom"]), category: categories, sort: z.number(),
  entry: z.object({ path: z.string(), renderer: z.string().optional(), entryKey: z.string().min(1).optional(), home: z.string().optional() }),
  scheduleAdapter: z.string().nullable(), releaseId: z.string().nullable(),
  entryPaths: z.array(z.string().min(1)).optional(),
  singleEntry: z.boolean().optional(),
  groups: applicationMetadataSchema.shape.groups.optional(),
  panelUses: z.array(applicationMenuEntrySchema).optional(),
  framePanelId: z.string().min(1).optional(),
  allowStandalone: z.boolean().optional(),
}));
export type CatalogApplication = z.infer<typeof applicationCatalogSchema>[number];
export const navigationApplicationCatalogSchema = z.array(applicationCatalogSchema.element.required({ entryPaths: true, ownerService: true }));

/** Whether an application permits opening in standalone mode (`standalone=1`); defaults to enabled when omitted. */
export function allowsStandalone(app: { allowStandalone?: boolean } | null | undefined): boolean {
  return app?.allowStandalone !== false;
}

/** The platform entry, which resolves a panel application to its first available use. */
export function applicationRootPath(applicationId: string): string {
  return `/applications/${encodeURIComponent(applicationId)}`;
}

export function isPanelApplication(app: Pick<CatalogApplication, "entry">): boolean {
  return app.entry.renderer === "panels";
}

export function isPlatformCatalogApplication(app: Pick<CatalogApplication, "kind" | "entry">): boolean {
  return app.kind !== "hosted" && (app.kind !== "product" || isPanelApplication(app));
}

export const accountDeletionPageSchema = z.object({
  events: z.array(z.object({
    sequence, type: z.literal("account.deleted"), userId: z.string().min(1), occurredAt: z.string().datetime(),
  })),
  nextCursor: sequence,
  hasMore: z.boolean(),
});
export type AccountDeletionPage = z.infer<typeof accountDeletionPageSchema>;
