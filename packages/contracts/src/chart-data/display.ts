import { z } from "zod";

const column = z.string().min(1);
export const chartFormatSchema = z.object({
  kind: z.enum(["number", "percent", "text", "date", "currency"]),
  decimals: z.number().int().min(0).optional(),
  scale: z.union([z.literal(1), z.literal(100)]).optional(),
  currency: z.string().optional(),
}).strict().refine(v => v.kind !== "percent" || v.scale !== undefined, "Percent formatting requires an explicit scale");
export const chartSortSchema = z.array(z.object({ field: column, order: z.enum(["asc", "desc"]) }).strict());
export const chartDisplaySchema = z.object({
  sort: chartSortSchema.optional(),
  displayLimit: z.number().int().positive().optional(),
  formats: z.record(chartFormatSchema).optional(),
}).strict();
export type ChartFormat = z.infer<typeof chartFormatSchema>;
export type ChartSort = z.infer<typeof chartSortSchema>;
export type ChartDisplay = z.infer<typeof chartDisplaySchema>;
