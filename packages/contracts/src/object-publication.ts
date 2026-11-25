import { z } from "zod";

export const objectPublicationAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("domain") }).strict(),
  z.object({ kind: z.literal("policy"), policyId: z.string().trim().min(1) }).strict(),
]);
export type ObjectPublicationAccess = z.infer<typeof objectPublicationAccessSchema>;
