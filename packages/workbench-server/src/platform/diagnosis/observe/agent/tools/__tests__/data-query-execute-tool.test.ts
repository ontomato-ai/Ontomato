import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n, tApp } from "../../../../../../i18n";
import { appTextEn } from "../../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../../i18n/locales/en";
import { installRuntimeDefaults } from "../../../../../../runtime/defaults";
import { createDataQueryExecuteTool } from "../data-query-execute-tool";

vi.mock("../../../../../../logging/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

// Only the Java HTTP endpoint is replaced; requests use the real shared backend client.
const requests: { path?: string; method?: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
let response: unknown;
let status = 200;
let holdResponse = false;
let received: (() => void) | undefined;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  requests.push({ path: req.url, method: req.method, headers: req.headers, body: JSON.parse(body) });
  received?.();
  if (holdResponse) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response));
});
const query = { problem: "Orders", answer: { steps: [{
  graph: { patterns: [{ objects: [{ variable: "o", class: "Order" }] }] },
  output: { fields: [{ variable: "o", field: "id", as: "id" }] },
}] } };
const tool = () => createDataQueryExecuteTool({ domainId: "domain-a", token: "test-token" });

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
  installRuntimeDefaults({ defaultDataAdapter: "sql", postgresFallback: "", systemMcpUrlFallback: "", requestLocaleFallback: "en" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("DATA_QUERY_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

beforeEach(() => {
  requests.length = 0;
  response = { data: [{ answer: [{ id: 1 }] }] };
  status = 200;
  holdResponse = false;
  received = undefined;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
});

describe("diagnosis DSL execution", () => {
  it.each([
    { domainId: "domain-a", token: "test-token" },
    { domainId: "domain-b", apiKey: "test-api-key" },
    { domainId: "default" },
  ])("sends the DSL and caller credential through the current endpoint: %j", async (caller) => {
    const result = await createDataQueryExecuteTool(caller).execute("call", { query });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "/dsl/executeV1", method: "POST", body: query });
    expect(requests[0].headers.tk).toBe("token" in caller ? caller.token : undefined);
    expect(requests[0].headers["x-api-key"]).toBe("apiKey" in caller ? caller.apiKey : undefined);
    expect(result.content[0].text).toContain('{"id":1}');
  });

  it("samples answer rows across packs, with the 25-row cap and received row count", async () => {
    response = { data: [{ answer: [{ id: 0 }] }, { answer: Array.from({ length: 29 }, (_, i) => ({ id: i + 1 })) }] };
    const text = (await tool().execute("call", { query, limit: 99 })).content[0].text!;
    expect(text).toContain(tApp("diag.observe.agent.tools.data-query-execute-tool.11", { p0: 30, p1: 25 }));
    expect(text).toContain('{"id":24}');
    expect(text).not.toContain('{"id":25}');
    const limited = (await tool().execute("call", { query, limit: 2 })).content[0].text!;
    expect(limited).toContain('{"id":1}');
    expect(limited).not.toContain('{"id":2}');
  });

  it("distinguishes complete empty results from partial empty results", async () => {
    response = { data: [{ answer: [] }] };
    const empty = (await tool().execute("call", { query })).content[0].text;
    expect(empty).toBe(tApp("diag.observe.agent.tools.data-query-execute-tool.10"));
    response = { data: [{ answer: [], truncated: true, rowLimit: 100, truncationHint: "Processing cap reached" }] };
    const partial = (await tool().execute("call", { query })).content[0].text;
    expect(partial).toContain("Processing cap reached");
    expect(partial).not.toBe(empty);
  });

  it("reports Java's error instead of presenting a failed query as data", async () => {
    response = { error: "Unknown class: Order", data: [{ answer: [{ id: 1 }] }] };
    const text = (await tool().execute("call", { query })).content[0].text;
    expect(text).toContain("Unknown class: Order");
    expect(text).not.toContain('{"id":1}');
  });

  it.each([null, [], { data: [] }, { data: [{ answer: "bad" }] }])("rejects malformed response %j", async (payload) => {
    response = payload;
    const text = (await tool().execute("call", { query })).content[0].text;
    expect(text).not.toBe(tApp("diag.observe.agent.tools.data-query-execute-tool.10"));
    expect(text).toContain("failed");
  });

  it("rejects old SQL text and empty DSL before making a request", async () => {
    for (const invalid of ["select 1", {}, null, []]) {
      const text = (await tool().execute("call", { query: invalid })).content[0].text;
      expect(text).toBe(tApp("diag.observe.agent.tools.data-query-execute-tool.6"));
    }
    expect(requests).toHaveLength(0);
  });

  it("keeps a single attempt on HTTP failure", async () => {
    status = 500;
    response = { error: "engine unavailable" };
    const text = (await tool().execute("call", { query })).content[0].text;
    expect(requests).toHaveLength(1);
    expect(text).toContain("engine unavailable");
  });

  it("cancels an in-flight HTTP call without retrying", async () => {
    holdResponse = true;
    const started = new Promise<void>((resolve) => { received = resolve; });
    const controller = new AbortController();
    const result = tool().execute("call", { query }, controller.signal);
    await started;
    controller.abort();
    expect((await result).content[0].text).toContain("failed");
    expect(requests).toHaveLength(1);
  });
});
