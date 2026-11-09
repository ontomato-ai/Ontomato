import { z } from "zod";

export const drilldownInputSchema = z.object({ rowIndex: z.number().int().nonnegative().safe() }).strict();
export const drilldownPreviewSchema = z.object({
  question: z.string(),
  groups: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict()),
  filters: z.array(z.string()),
  assumptions: z.array(z.string()),
  truncated: z.boolean(),
}).strict();
