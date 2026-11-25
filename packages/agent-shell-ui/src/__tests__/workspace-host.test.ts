import { expect, it, vi } from "vitest";
import { createAgentHostClient } from "../host";

it("resolves workspace scope only when creating a conversation and leaves the agent history unscoped", async () => {
  const workspaceIdForAgent = vi.fn((agentId: string) => agentId === "builder" ? "workspace-a" : undefined);
  const request = vi.fn(async () => new Response(JSON.stringify({ sessions: [], nextCursor: null, session: { id: "new" } })));
  const client = createAgentHostClient({ request, workspaceIdForAgent });
  await client.listSessions("builder", null);
  expect(workspaceIdForAgent).not.toHaveBeenCalled();
  expect(request).toHaveBeenLastCalledWith("/sessions?agentId=builder", expect.anything());

  await client.createSession("builder");
  expect(request).toHaveBeenLastCalledWith("/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify({ agentId: "builder", workspaceId: "workspace-a" }) }));
  await client.createSession("analyst");
  expect(request).toHaveBeenLastCalledWith("/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify({ agentId: "analyst" }) }));
});
