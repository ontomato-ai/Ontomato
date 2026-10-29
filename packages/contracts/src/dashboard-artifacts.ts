import { z } from "zod";
export const dashboardSourceSchema = z.object({
  sessionId: z.string().uuid(),
  datasetArtifactIds: z.array(z.string().uuid()).min(1),
});
export const dashboardAddArtifactSchema = z
  .object({
    sessionId: z.string().uuid(),
    datasetArtifactId: z.string().uuid(),
    dashboardId: z.string().min(1),
    groupId: z.string().min(1),
  })
  .strict();
export type DashboardAddArtifact = z.infer<typeof dashboardAddArtifactSchema>;
