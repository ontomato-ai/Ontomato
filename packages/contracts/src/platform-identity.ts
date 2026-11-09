import { z } from "zod";

const names = z.record(z.string().min(1)).refine((value) => Boolean(value.en), "An English name is required");
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const sequence = z.string().regex(/^[0-9]+$/).refine((value) => BigInt(value) <= 9223372036854775807n);

export const applicationDeclarationSchema = z.object({
  names,
  descriptions: z.record(z.string()),
  icon: z.string().min(1),
  groups: z.array(z.object({ key, names, sort: z.number().int() }).strict()),
  permissions: z.array(z.object({ code: key, names, groupKey: key, sort: z.number().int() }).strict()),
}).strict();
export type ApplicationDeclaration = z.infer<typeof applicationDeclarationSchema>;
export const builtinApplicationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), kind: z.enum(["native", "link"]),
  rail: z.enum(["top", "apps", "bottom"]), sort: z.number().int(),
  entry: z.object({ path: z.string(), renderer: z.string(), home: z.string().optional() }),
  entryAccess: z.array(z.string()).min(1), scheduleAdapter: z.string().nullable(), declaration: applicationDeclarationSchema,
});
export type BuiltinApplication = z.infer<typeof builtinApplicationSchema>;
export const applicationCatalogSchema = z.array(z.object({
  id: z.string(), kind: z.enum(["native", "hosted", "connected", "link"]), names,
  descriptions: z.record(z.string()), icon: z.string(), rail: z.enum(["top", "apps", "bottom"]), sort: z.number(),
  entry: z.object({ path: z.string(), renderer: z.string().optional(), home: z.string().optional() }),
  entryAccess: z.array(z.string()).min(1), scheduleAdapter: z.string().nullable(), releaseId: z.string().nullable(),
}));
export type CatalogApplication = z.infer<typeof applicationCatalogSchema>[number];

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
