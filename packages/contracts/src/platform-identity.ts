import { z } from "zod";
import { pageSkillSchema } from "./page-skills";
import { applicationMetadataSchema } from "./application-metadata";
import { applicationPanelUseSchema } from "./product-panels";

const names = applicationMetadataSchema.shape.names;
const sequence = z.string().regex(/^[0-9]+$/).refine((value) => BigInt(value) <= 9223372036854775807n);
const categories = z.enum(["business", "build", "admin"]);

export const applicationDeclarationSchema = applicationMetadataSchema.extend({
  pageSkills: z.array(pageSkillSchema).optional(),
  panelUses: z.array(applicationPanelUseSchema).optional(),
}).strict();
export type ApplicationDeclaration = z.infer<typeof applicationDeclarationSchema>;
export const builtinApplicationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), kind: z.enum(["native", "link"]),
  rail: z.enum(["top", "apps", "bottom"]), category: categories, sort: z.number().int(),
  entry: z.object({ path: z.string(), renderer: z.string(), home: z.string().optional() }),
  entryAccess: z.array(z.string()).min(1), scheduleAdapter: z.string().nullable(), declaration: applicationDeclarationSchema,
  framePanelId: z.string().min(1).optional(),
  allowStandalone: z.boolean().optional(),
});
export type BuiltinApplication = z.infer<typeof builtinApplicationSchema>;
export const applicationCatalogSchema = z.array(z.object({
  id: z.string(), kind: z.enum(["native", "hosted", "connected", "link",'product']), names,
  descriptions: z.record(z.string()), icon: z.string(), rail: z.enum(["top", "apps", "bottom"]), category: categories, sort: z.number(),
  entry: z.object({ path: z.string(), renderer: z.string().optional(), home: z.string().optional() }),
  entryAccess: z.array(z.string()).min(1), scheduleAdapter: z.string().nullable(), releaseId: z.string().nullable(),
  panelUses: z.array(applicationPanelUseSchema).optional(),
  framePanelId: z.string().min(1).optional(),
  allowStandalone: z.boolean().optional(),
}));
export type CatalogApplication = z.infer<typeof applicationCatalogSchema>[number];

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

export const accountDeletionPageSchema = z.object({
  events: z.array(z.object({
    sequence, type: z.literal("account.deleted"), userId: z.string().min(1), occurredAt: z.string().datetime(),
  })),
  nextCursor: sequence,
  hasMore: z.boolean(),
});
export type AccountDeletionPage = z.infer<typeof accountDeletionPageSchema>;

export interface ApplicationMenus {
  applications: {
    id: string; names: Record<string, string>; entryPath: string; sort: number;
    groups: {
      key: string; names: Record<string, string>; sort: number;
      permissions: { id: string; code: string; names: Record<string, string>; sort: number; userTemplate: boolean }[];
    }[];
  }[];
}
export interface UserApplicationPermissions {
  userId: string; domainId: string; permissions: string[];
  applications: { applicationId: string; ownerService: string; permissions: string[] }[];
}
