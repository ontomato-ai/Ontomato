import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformScheduleErrorSchema } from "@ontomato/contracts/platform-schedules";
import { schedulesHost } from "../utils/schedules-host";

/*
 * The scheduled tasks page reaches the service only through this host. What this guards is the request layer under it:
 * the contract spells `/api/data-query` itself, so the host must add this deployment's prefix and never a second one;
 * and the page tells a running task or a changed form from a failure by the service's error body, so a refusal must
 * reach it with its status and that body.
 */
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

const host = () => schedulesHost({ applications: () => [], openResult: () => {} });

describe("the scheduled tasks host", () => {
  it("sends the page's requests through the Node request layer without doubling the contract's segment", async () => {
    await host().request("/api/data-query/platform/scheduled-tasks?appId=agents", { method: "GET" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/data-query/platform/scheduled-tasks?appId=agents");
    expect(requests[0]).not.toContain("/api/data-query/api/data-query");
  });

  it("hands a refusal to the page with its status and the service's error body", async () => {
    const refusal: { status?: unknown; payload?: unknown } = await host()
      .request("/api/data-query/platform/scheduled-tasks/10000000-0000-4000-8000-000000000003/runs", {
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
