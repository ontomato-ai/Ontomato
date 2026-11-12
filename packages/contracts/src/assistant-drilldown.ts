import { z } from "zod";

export const drilldownPreviewSchema = z.object({
  question: z.string(),
  groups: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict()),
  filters: z.array(z.string()),
  assumptions: z.array(z.string()),
  truncated: z.boolean(),
}).strict();
