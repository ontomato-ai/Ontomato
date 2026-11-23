import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { workbenchServerResourceRoot } from "../../../content/resources";

const script = path.resolve(workbenchServerResourceRoot, "resources/runtime-skills/ontomato-agent-builder/scripts/page.mjs");
const agentId = "11111111-1111-4111-8111-111111111111";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function run(args: string[], env: Record<string, string>, cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ONTOMATO_LANGUAGE: "en", ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function serve(handler: (url: string, body: unknown, response: ServerResponse, request: IncomingMessage) => void) {
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => handler(request.url ?? "", text ? JSON.parse(text) : null, response, request));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return `http://127.0.0.1:${address.port}`;
}

const form = { name: "Agent", description: "", icon: null, enabled: true, systemPrompt: "Prompt",
  modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 0,
  executionUserId: "22222222-2222-4222-8222-222222222222" };

it("refuses to write directly inside the platform before sending any request", async () => {
  const requested = vi.fn();
  const base = await serve((url, _body, response) => { requested(url); response.end("{}"); });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-skill-"));
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "session-token" };
  for (const args of [["create", "@work/agent.json"], ["update", agentId, "@work/agent.json"], ["delete", agentId]]) {
    const result = await run(args, env, cwd);
    expect(result.code).toBe(1);
  }
  expect(requested).not.toHaveBeenCalled();
});

it("sends an outside update's own fields, with no skills when the file names none", async () => {
  const seen: { method?: string; url: string; body: unknown }[] = [];
  const base = await serve((url, body, response, request) => {
    seen.push({ method: request.method, url, body });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...form, name: "Renamed agent" }));
  });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-update-"));
  await writeFile(path.join(cwd, "form.json"), JSON.stringify({ name: "Renamed agent", systemPrompt: "A new prompt" }));
  const env = { ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "session-token" };
  const result = await run(["update", agentId, "@form.json"], env, cwd);
  expect(result.code).toBe(0);
  // The file's fields are the whole request: the owner keeps the skills the agent holds because none is sent.
  expect(seen).toEqual([{ method: "PUT", url: `/api/assistant/agent-definitions/${agentId}`, body: { name: "Renamed agent", systemPrompt: "A new prompt" } }]);
});

it("sends an outside update's explicit empty skills as the whole selection", async () => {
  const seen: { body: unknown }[] = [];
  const base = await serve((_url, body, response) => {
    seen.push({ body });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...form, skills: [] }));
  });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-clear-"));
  await writeFile(path.join(cwd, "form.json"), JSON.stringify({ skills: [] }));
  const env = { ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "session-token" };
  expect((await run(["update", agentId, "@form.json"], env, cwd)).code).toBe(0);
  expect(seen).toEqual([{ body: { skills: [] } }]);
});

it("lists the users a governance administrator may choose, and reports when none may be set", async () => {
  const seen: string[] = [];
  const base = await serve((url, _body, response) => {
    seen.push(url);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ canSetExecutionUser: false, users: [] }));
  });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-execution-"));
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "session-token" };
  const result = await run(["execution-users", "ali"], env, cwd);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ canSetExecutionUser: false, users: [] });
  expect(seen).toEqual(["/platform/agent-execution/options?keyword=ali&pageNum=1&pageSize=100"]);
});

it.each([false, true])("authenticates agent settings reads for a callback base: %s", async (callback) => {
  const seen: { url: string; headers: IncomingMessage["headers"] }[] = [];
  const base = await serve((url, _body, response, request) => {
    seen.push({ url, headers: request.headers });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ agents: [] }));
  });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-callback-"));
  const prefix = callback ? "/api/assistant/executions/run-id/workbench" : "";
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_EXECUTION_CALLBACK: "wbc1-run", ONTOMATO_RUN_ID: "run-id",
    ONTOMATO_WORKBENCH_URL: base + prefix, ...(!callback && { ONTOMATO_TK: "session-token" }) };
  const result = await run(["list"], env, cwd);
  expect(result.code).toBe(0);
  expect(seen).toHaveLength(1);
  expect(seen[0].url).toBe(prefix + "/api/assistant/agent-definitions");
  expect(seen[0].headers["x-ontomato-callback-credential"]).toBe(callback ? "wbc1-run" : undefined);
  expect(seen[0].headers["x-ontomato-run-id"]).toBe("run-id");
  expect(seen[0].headers.tk).toBe(callback ? undefined : "session-token");
  expect(seen[0].headers["x-api-key"]).toBeUndefined();
});
