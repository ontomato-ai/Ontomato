import { z } from "zod";

const principalKindSchema = z.enum(["member", "role"]);

export const principalDirectoryRequestSchema = z.union([
  z.object({ kind: principalKindSchema, keyword: z.string().optional(), limit: z.number() }).strict(),
  z.object({ kind: z.literal("member"), ids: z.array(z.string()) }).strict(),
]);
export type PrincipalDirectoryRequest = z.infer<typeof principalDirectoryRequestSchema>;

export const principalDirectoryResponseSchema = z.object({
  options: z.array(z.object({ id: z.string(), name: z.string(), kind: principalKindSchema }).strict()),
}).strict();
