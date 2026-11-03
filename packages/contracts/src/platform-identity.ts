import { z } from "zod";

const names = z.record(z.string().min(1)).refine((value) => Boolean(value.en), "An English name is required");
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const sequence = z.string().regex(/^[0-9]+$/).refine((value) => BigInt(value) <= 9223372036854775807n);

export const applicationDeclarationSchema = z.object({
  names,
  entryPath: z.string().regex(/^\/(?:[A-Za-z0-9_-]+\/)*$/),
  groups: z.array(z.object({ key, names, sort: z.number().int() }).strict()),
  permissions: z.array(z.object({ code: key, names, groupKey: key, sort: z.number().int() }).strict()),
}).strict();
export type ApplicationDeclaration = z.infer<typeof applicationDeclarationSchema>;

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
  applications: { applicationId: string; permissions: string[] }[];
}
