import type { DashboardSource } from "@ontomato/contracts/dashboard-artifacts";
import { assistantService } from "../assistant/service";
import { assistantStore, type AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { createDashboard } from "./store";
import { DashboardMetricClient } from "./metric-client";
import { planReferenceDashboard } from "./reference-planning";
import type { DashboardDatasetInput } from "./types";

export async function resolveDashboardDatasets(
  sessionId: string, artifactIds: string[], owner: AssistantOwner,
): Promise<{ datasets: DashboardDatasetInput[] }> {
  const datasets: DashboardDatasetInput[] = [];
  await assistantStore.session(sessionId, owner);
  for (const id of new Set(artifactIds)) {
    const { payload } = await assistantService.dataset(sessionId, id, owner);
    if (payload.recipe.kind === "dsl")
      throw new HttpError(400, "Ask again before adding this historical dataset", "UNSUPPORTED_DATASET_RECIPE");
    datasets.push({
      datasetKey: id, subQuestion: payload.question, data: payload.rows, columns: payload.columns,
      recipe: payload.recipe, source: { sessionId, artifactId: id }, ...(payload.truncation ?? {}),
    });
  }
  return { datasets };
}

export async function createDashboardFromAnalysis(
  ownerId: string, domainId: string, body: DashboardSource, credentials: AssistantCredentials,
) {
  const { sessionId, datasetArtifactIds } = body;
  const { datasets } = await resolveDashboardDatasets(sessionId, datasetArtifactIds, { userId: ownerId, domainId });
  const planned = await planReferenceDashboard(datasets, new DashboardMetricClient(domainId, credentials));
  const detail = await createDashboard({
    ownerId, domainId, name: planned.name, source: { sessionId }, groups: planned.groups,
  });
  return { id: detail.id, name: detail.name };
}
