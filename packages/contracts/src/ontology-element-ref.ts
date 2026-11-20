import { z } from "zod";

/** An element's kind disambiguates names that can occur in more than one owner catalogue. */
export const ontologyElementRefSchema = z.object({
  kind: z.enum(["MetricView", "Action", "ObjectType", "Relationship", "Definition", "PlatformObjectType", "PlatformOperation"]),
  id: z.string().min(1).max(200),
}).strict();
export type OntologyElementRef = z.infer<typeof ontologyElementRefSchema>;
