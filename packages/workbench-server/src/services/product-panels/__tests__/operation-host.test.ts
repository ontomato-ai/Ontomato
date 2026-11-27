import { afterEach, expect, it, vi } from "vitest";
import { EXECUTION_CONTEXT_HEADER } from "@ontomato/contracts/execution-context";
import type { AuthenticatedRequest } from "../../../utils/request-identity";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ callbackUrl: "http://workbench.test" }) } }));

const { credentialsFromRequest } = await import("../../../utils/request-identity");
const { operationHost } = await import("../operation-host");

afterEach(() => { vi.unstubAllGlobals(); });

function caller(headers: Record<string, string>) {
  return { token: "U-token", apiKey: "", locale: "en", header: (name: string) => headers[name] } as unknown as AuthenticatedRequest;
}

async function marks(headers: Record<string, string>) {
  const sent = vi.fn(async (_url: string, _init: NonNullable<Parameters<typeof fetch>[1]>) => Response.json({}));
  vi.stubGlobal("fetch", sent);
  const host = operationHost({ owner: { domainId: "d", userId: "U" }, credentials: credentialsFromRequest(caller(headers)) });
  const marked: Record<string, string | null> = {};
  for (const path of ["/action/form", "/action/execute", "/platform/triggers/t-1/runs", "/metricView/save", "/function/save"]) {
    sent.mockClear();
    await host.request(`/api/data-query${path}`, { method: "POST", body: "{}" });
    expect(sent.mock.calls[0]![0]).toBe(`http://owner.test${path}`);
    marked[path] = new Headers(sent.mock.calls[0]![1].headers).get(EXECUTION_CONTEXT_HEADER);
  }
  sent.mockClear();
  await host.request("/api/data-query/platform/triggers/t-1/runs", { method: "GET" });
  marked["GET /platform/triggers/t-1/runs"] = new Headers(sent.mock.calls[0]![1].headers).get(EXECUTION_CONTEXT_HEADER);
  return marked;
}

it("turns a preview caller's header into a marker carried by every Java request it sends", async () => {
  expect(await marks({ [EXECUTION_CONTEXT_HEADER]: 'preview' })).toEqual({
    "/action/form": 'preview',
    "/action/execute": 'preview',
    "/platform/triggers/t-1/runs": 'preview',
    "/metricView/save": 'preview',
    "/function/save": 'preview',
    "GET /platform/triggers/t-1/runs": 'preview',
  });
});

it("leaves a live caller's requests unmarked", async () => {
  expect(Object.values(await marks({})).every(value => value === null)).toBe(true);
});
