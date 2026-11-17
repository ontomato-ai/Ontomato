import { z } from "zod";

const names = z.record(z.string().min(1)).refine(value => Boolean(value.en), "An English name is required");
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);

/** Java-owned application metadata, shared by source and panel registration requests. */
export const applicationMetadataSchema = z.object({
  names,
  descriptions: z.record(z.string()),
  icon: z.string().min(1),
  groups: z.array(z.object({ key, names, sort: z.number().int() }).strict()),
  permissions: z.array(z.object({ code: key, names, groupKey: key, sort: z.number().int() }).strict()),
}).strict();
