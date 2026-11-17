import { z } from "zod";
import { dashboardChartFileSchema, dashboardMetricReferenceSchema } from "./dashboard";

export const chartImportRequestSchema = z.object({ sessionId:z.string().uuid(), runId:z.string().uuid(), artifactId:z.string().uuid() }).strict();
export const chartImportResponseSchema = z.object({
  file: dashboardChartFileSchema,
  query: dashboardMetricReferenceSchema,
  metric: z.object({name:z.string(),status:z.string(),revision:z.string()}).strict(),
  source: chartImportRequestSchema,
}).strict();
export type ChartImportRequest = z.infer<typeof chartImportRequestSchema>;
export type ChartImportResponse = z.infer<typeof chartImportResponseSchema>;
