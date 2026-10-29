import { deleteUserState } from "../assistant/user-state";
import { createLogger } from "../../logging/logger";
import { toErrorMessage } from "../../utils/errors";
import { pptArtifactStore } from "../analysis-agent/delivery/ppt-artifacts";
import { deleteUserAssistantSessions } from "../assistant/cleanup";
import { deleteUserDashboards } from "../dashboard/store";
import { governanceStore } from "../knowledge-governance/store";

const logger = createLogger("user-resource-cleanup");
const stages: [string, (userId: string) => Promise<void>][] = [
  ["assistant conversations", deleteUserAssistantSessions],
  ["dashboards", deleteUserDashboards],
  ["memory and preferences", deleteUserState],
  ["governance sessions", (id) => governanceStore.deleteByUser(id)],
  ["PPT artifacts", (id) => pptArtifactStore().deleteByUser(id)],
];

/** Best-effort cleanup after Java has successfully deleted the global accounts. */
export async function cleanupDeletedUsers(
  userIds: readonly string[],
): Promise<void> {
  for (const userId of new Set(userIds)) {
    for (const [stage, cleanup] of stages) {
      try {
        await cleanup(userId);
      } catch (error) {
        logger.error("Failed to clean up deleted account resources", {
          userId,
          stage,
          error: toErrorMessage(error),
        });
      }
    }
  }
}
