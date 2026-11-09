import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import type { AssistantOwner } from "../assistant/store";

export async function workspaceSessions(owner: AssistantOwner, workspaceId: string) {
  await new RuntimeClient(owner.domainId, undefined, owner.userId).request(`/v1/workspaces/${workspaceId}`);
  const sessions = (await getPostgresPool().query(`SELECT id,agent_id AS "agentId",title FROM ${t("assistant_sessions")} WHERE domain_id=$1 AND owner_id=$2 AND workspace_id=$3 ORDER BY updated_at DESC,id`, [owner.domainId, owner.userId, workspaceId])).rows;
  return { sessions };
}
