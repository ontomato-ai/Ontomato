import { beforeEach, describe, expect, it, vi } from "vitest";
import { schedulesHost } from "../utils/schedules-host";

/*
 * The scheduled-tasks page shows up in two places — the platform's own page and the agent application — and both read
 * through one host. What this guards is the wiring that made the new-task dialog's agent picker empty on the deployed
 * build: the agents come from the Node API (`/assistant/agents`), not from the data-query API, which serves no such list.
 */
const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/assistant/agents")) {
      return new Response(
        JSON.stringify({ agents: [{ id: "3f4b0d0e-1c2a-4f6e-9a0b-2d5c8e7f1a34", name: "Order agent", description: "", icon: null, enabled: true }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

describe("the one schedules host", () => {
  it("reads the agents a task may run from the Node API", async () => {
    const agents = await schedulesHost().agents();
    expect(agents.map((agent) => agent.name)).toEqual(["Order agent"]);
    expect(requests.some((url) => url.includes("/assistant/agents"))).toBe(true);
    // Not the data-query interface: that path answers nothing for agents.
    expect(requests.every((url) => !url.includes("/data-query/assistant/agents"))).toBe(true);
  });

  it("sends the page's requests through the Node request layer without doubling the contract's segment", async () => {
    const host = schedulesHost();
    await host.request("/api/data-query/platform/scheduled-tasks?appId=agents", { method: "GET" });
    // The contract spells `/api/data-query` itself; the request adds this deployment's prefix and never a second one.
    expect(requests.filter((url) => url.includes("scheduled-tasks"))).toHaveLength(1);
    expect(requests.find((url) => url.includes("scheduled-tasks"))).not.toContain("/api/data-query/api/data-query");
  });
});
