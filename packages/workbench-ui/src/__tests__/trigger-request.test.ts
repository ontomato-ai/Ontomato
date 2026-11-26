import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformScheduleErrorSchema } from "@ontomato/contracts/platform-schedules";
import { nodeApiRequest } from "../utils/api";


const requests: string[] = [];
const running = {
  error: { code: "TASK_RUNNING", message: "The task is running", activeRunId: "30000000-0000-4000-8000-000000000002" },
  correlationId: "schedule-example-running",
};

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    const refused = url.endsWith("/runs");
    return new Response(JSON.stringify(refused ? running : { tasks: [], timeZone: "UTC" }), {
      status: refused ? 409 : 200,
      headers: { "content-type": "application/json" },
    });
  });
});

describe("task trigger gateway requests", () => {
  it("sends the page's requests through the Node request layer without doubling the contract's segment", async () => {
    await nodeApiRequest("/api/data-query/platform/triggers?appId=agents", { method: "GET" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/data-query/platform/triggers?appId=agents");
    expect(requests[0]).not.toContain("/api/data-query/api/data-query");
  });

  it("hands a refusal to the page with its status and the service's error body", async () => {
    const refusal: { status?: unknown; payload?: unknown } = await nodeApiRequest("/api/data-query/platform/triggers/10000000-0000-4000-8000-000000000003/runs", {
        method: "POST",
        headers: { "Idempotency-Key": "10000000-0000-4000-8000-000000000009" },
      })
      .then(
        () => ({}),
        (error: unknown) => error as { status?: unknown; payload?: unknown },
      );

    expect(refusal.status).toBe(409);
    expect(platformScheduleErrorSchema.parse(refusal.payload).error.activeRunId).toBe(running.error.activeRunId);
  });
});
