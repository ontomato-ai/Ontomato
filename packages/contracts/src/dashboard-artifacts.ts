import { z } from "zod";
export const dashboardSourceSchema = z.object({
  sessionId: z.string().uuid(),
  datasetArtifactIds: z.array(z.string().uuid()).min(1),
}).strict();
export const dashboardAddArtifactSchema = z
  .object({
    sessionId: z.string().uuid(),
    datasetArtifactId: z.string().uuid(),
    dashboardId: z.string().min(1),
    groupId: z.string().min(1),
  })
  .strict();
export type DashboardAddArtifact = z.infer<typeof dashboardAddArtifactSchema>;
export type DashboardSource = z.infer<typeof dashboardSourceSchema>;

export const dashboardChartFileSourceSchema = z.object({sessionId:z.string().uuid(),runId:z.string().uuid(),artifactId:z.string().uuid()}).strict();
export const dashboardAddChartFileSchema = z.object({
  source: dashboardChartFileSourceSchema,
  title: z.string().trim().min(1).optional(),
  target: z.union([
    z.object({dashboardId:z.string().min(1),groupId:z.string().min(1)}).strict(),
    z.object({name:z.string().min(1)}).strict(),
  ]),
}).strict();
export type DashboardAddChartFile = z.infer<typeof dashboardAddChartFileSchema>;
