import { withScheduledUserActivity } from "../assistant/scheduled-activity";
import { deleteUserState } from "../assistant/user-state";
import { createLogger } from "../../logging/logger";
import { toErrorMessage } from "../../utils/errors";
import { pptArtifactStore } from "../analysis-agent/delivery/ppt-artifacts";
import { deleteUserAssistantSessions } from "../assistant/cleanup";
import { deleteUserDashboards } from "../dashboard/store";
import { deleteUserHomeData } from "../platform-home/store";

const logger = createLogger("user-resource-cleanup");
const stages: [string, (userId: string) => Promise<void>][] = [
  ["assistant conversations", deleteUserAssistantSessions],
  ["dashboards", deleteUserDashboards],
  ["home preferences and application usage", deleteUserHomeData],
  ["memory and preferences", deleteUserState],
  ["PPT artifacts", (id) => pptArtifactStore().deleteByUser(id)],
];

/** Complete cleanup of a deleted global account; any failed stage leaves its event unacknowledged. */
export async function cleanupDeletedUsers(
  userIds: readonly string[],
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await withScheduledUserActivity(userId, async () => {
    for (const [stage, cleanup] of stages) {
      try {
        await cleanup(userId);
      } catch (error) {
        logger.error("Failed to clean up deleted account resources", {
          userId,
          stage,
          error: toErrorMessage(error),
        });
        throw error;
      }
    }
    });
  }
}
