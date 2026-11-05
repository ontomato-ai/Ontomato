import { getStore } from "../../infrastructure/connection";
import { createLogger } from "../../logging/logger";
import { toErrorMessage } from "../../utils/errors";
import { pptArtifactStore } from "../analysis-agent/delivery/ppt-artifacts";
import { getAnalysisScheduleRuleService } from "../analysis-agent/task/schedule-rules";
import { deleteScheduleCredentialsOfUser } from "../analysis-agent/task/schedule-credentials";
import { getAnalysisTaskService } from "../analysis-agent/task/task-service";
import { deleteUserThreads } from "../chat/thread-service";
import { deleteUserDashboards } from "../dashboard/store";
import { governanceStore } from "../knowledge-governance/store";

const logger = createLogger("user-resource-cleanup");
const stages: [string, (userId: string) => Promise<void>][] = [
  ["schedules", (id) => getAnalysisScheduleRuleService().deleteByUser(id)],
  ["schedule credentials", deleteScheduleCredentialsOfUser],
  ["analysis tasks", (id) => getAnalysisTaskService().deleteByUser(id)],
  ["threads", deleteUserThreads],
  ["dashboards", deleteUserDashboards],
  ["memory and preferences", async (id) => {
    const store = getStore();
    if (!store) throw new Error("User store is not initialized");
    await store.deleteByUser(id);
  }],
  ["governance sessions", (id) => governanceStore.deleteByUser(id)],
  ["PPT artifacts", (id) => pptArtifactStore().deleteByUser(id)],
];

/** Best-effort cleanup after Java has successfully deleted the global accounts. */
export async function cleanupDeletedUsers(userIds: readonly string[]): Promise<void> {
  for (const userId of new Set(userIds)) {
    for (const [stage, cleanup] of stages) {
      try { await cleanup(userId); }
      catch (error) {
        logger.error("Failed to clean up deleted account resources", { userId, stage, error: toErrorMessage(error) });
      }
    }
  }
}
