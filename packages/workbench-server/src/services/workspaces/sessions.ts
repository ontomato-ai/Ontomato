import type { AgentHostSessionPage, AgentHostSessionPageQuery } from "@ontomato/contracts/agent-host";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AssistantOwner } from "../assistant/store";
import { assistantService } from "../assistant/service";

export async function workspaceSessions(owner: AssistantOwner, workspaceId: string, query: AgentHostSessionPageQuery): Promise<AgentHostSessionPage> {
  await new RuntimeClient(owner.domainId, undefined, owner.userId).request(`/v1/workspaces/${workspaceId}`);
  return assistantService.list(owner, { ...query, workspaceId });
}
