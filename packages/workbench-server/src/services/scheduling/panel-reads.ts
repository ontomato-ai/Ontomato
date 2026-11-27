import type { TriggerListParams } from "@ontomato/platform-schedules/panel-reads";
import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
import { platformTaskStatusSchema } from "@ontomato/contracts/platform-schedules";

export const SCHEDULE_LIST_REREAD_MS = 30_000;
export const SCHEDULE_RUN_REREAD_MS = 5_000;

export function triggerCatalogueParams(params: Record<string, unknown>): TriggerListParams {
  const workspace = params.workspace === "agent";
  const taskId = workspace ? panelReadParameterSchemas.triggerRef.nullish().parse(params.selectedTask)?.primaryKey : undefined;
  return {
    scope: panelReadParameterSchemas.keyword.optional().parse(params.scope),
    search: panelReadParameterSchemas.keyword.optional().parse(params.search),
    status: platformTaskStatusSchema.optional().parse(params.status === "" ? undefined : params.status),
    taskId,
    agentId: workspace && !taskId ? panelReadParameterSchemas.keyword.optional().parse(params.workspaceAgent) : undefined,
  };
}
