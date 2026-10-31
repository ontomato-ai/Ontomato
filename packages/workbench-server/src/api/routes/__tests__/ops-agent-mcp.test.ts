import path from "node:path";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), snapshot: vi.fn() }));
vi.mock("../../../services/ops-diagnosis/service", () => ({
  createDiagnosis: mocks.create,
  diagnosisService: { start: mocks.start, snapshot: mocks.snapshot },
}));
import { HttpError } from "../../../utils/errors";
import { installWorkbenchIdentity } from "../../../identity/installed";
import { installWorkbenchProduct } from "../../../product/installed";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createOpsAgentMcpRouter, getOpsAgentMcpToolCatalog } from "../ops-agent-mcp";
import os from "node:os";
import { installContentLayout } from "../../../content/layout";
import { installRuntimeDefaults } from "../../../runtime/defaults";
import type { WorkbenchIdentity } from "../../../identity/types";
import type { WorkbenchProduct } from "../../../product/types";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

installContentLayout({
  runtimeRoot: os.tmpdir(),
  prompts: [],
  publicSkillsRoot: path.join(os.tmpdir(), "no-public-skills"),
  runtimeResources: [],
});

installRuntimeDefaults({
  postgresFallback: "postgresql://localhost/dummy",
  systemMcpUrlFallback: "",
  requestLocaleFallback: "en",
});

let servers: http.Server[] = [];
let clients: Client[] = [];

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());

  installWorkbenchProduct({
    analysisMcpServerName: "ontomato-analysis-agents",
    opsMcpServerName: "ontomato-ops-agent",
    serviceDisplayName: "Ontomato",
  } as unknown as WorkbenchProduct);

  installWorkbenchIdentity({
    resolveMcpCaller: async () => ({ userId: "system", domainId: "default" }),
    assertObserveAccess: async () => {},
  } as unknown as WorkbenchIdentity);
});

afterEach(async () => {
  const activeClients = clients;
  clients = [];
  await Promise.all(activeClients.map((client) => client.close().catch(() => undefined)));

  const activeServers = servers;
  servers = [];
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  vi.restoreAllMocks();
});

async function startClient(router: express.Router): Promise<Client> {
  const app = express();
  app.use(express.json());
  app.use("/mcp", router);
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`)
  );
  const client = new Client({ name: "ops-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

function readToolPayload(result: unknown): any {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content || [];
  const text = content.find((item) => item.type === "text");
  return typeof text?.text === "string" ? JSON.parse(text.text) : result;
}

describe("ops agent MCP compatibility", () => {
  const sessionId = "a8c435e0-c139-43e7-b4b3-329b966504a8";
  const snapshot = (status: string, stopReason: string | null, text = "diagnosed") => ({ latestRun: { run: { status, stopReason, errorMessage: stopReason === "aborted" ? "Cancelled" : null }, messages: [{ message: { role: "assistant", content: [{ type: "text", text }] } }] } });
  it("retains the send schema and creates a session with the current owner", async () => {
    mocks.create.mockResolvedValue({ session: { id: sessionId } }); mocks.start.mockResolvedValue({}); mocks.snapshot.mockResolvedValue(snapshot("stopped", "stop"));
    const catalog = await getOpsAgentMcpToolCatalog(); expect(catalog.map((t) => t.name)).toEqual(["send"]);
    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 10 }));
    const value = readToolPayload(await client.callTool({ name: "send", arguments: { message: " diagnose " } }));
    expect(value).toEqual({ status: "completed", sessionId, answer: "diagnosed" });
    expect(mocks.start.mock.calls[0][2]).toBe("diagnose"); expect(mocks.start.mock.calls[0][3]).toEqual({ userId: "system", domainId: "default" });
  });
  it("polls running work without submitting another message", async () => {
    mocks.snapshot.mockResolvedValue(snapshot("running", null));
    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 0 }));
    expect(readToolPayload(await client.callTool({ name: "send", arguments: { sessionId } }))).toEqual({ status: "running", sessionId });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["error", "aborted", "length"])("preserves failed wire status for stopped %s", async (reason) => {
    mocks.snapshot.mockResolvedValue(snapshot("stopped", reason));
    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 0 }));
    expect(readToolPayload(await client.callTool({ name: "send", arguments: { sessionId } }))).toMatchObject({ status: "failed", sessionId });
  });
  it("retains invalid, missing and busy error shapes", async () => {
    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 0 }));
    expect(readToolPayload(await client.callTool({ name: "send", arguments: {} }))).toMatchObject({ success: false, code: "INVALID_CHAT_INPUT" });
    mocks.snapshot.mockRejectedValue(new HttpError(404, "Not found"));
    expect(readToolPayload(await client.callTool({ name: "send", arguments: { sessionId } }))).toMatchObject({ success: false, code: "SESSION_NOT_FOUND" });
    mocks.start.mockRejectedValue(new HttpError(409, "Busy", "SESSION_BUSY"));
    expect(readToolPayload(await client.callTool({ name: "send", arguments: { sessionId, message: "next" } }))).toMatchObject({ success: false, code: "RESPONSE_BUSY" });
  });
});
