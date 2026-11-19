import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    expect(result.stderr).toContain("draft");
  }
  expect(requested).not.toHaveBeenCalled();
});

it("writes a draft that keeps the execution user and prints the page link", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-draft-"));
  await writeFile(path.join(cwd, "form.json"), JSON.stringify(form));
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_SESSION_ID: "session", ONTOMATO_RUN_ID: "run" };
  const written = await run(["draft", "update", agentId, "@form.json"], env, cwd);
  expect(written.code).toBe(0);
  expect(JSON.parse(await readFile(path.join(cwd, "outputs/drafts/agent.page-draft.json"), "utf8"))).toEqual({
    pageKey: "agent-settings", operation: "agent.update", target: { id: agentId }, form,
  });
  const linked = await run(["draft-link", "@outputs/drafts/agent.page-draft.json"], env, cwd);
  expect(linked.code).toBe(0);
  expect(linked.stdout.trim()).toBe(
    `#/agents/settings/${agentId}?draftSessionId=session&draftRunId=run&draftPath=outputs%2Fdrafts%2Fagent.page-draft.json`,
  );
});

it("writes a draft with only the fields the agent gives it", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-partial-draft-"));
  const changed = { name: "Renamed agent", systemPrompt: "A new prompt" };
  await writeFile(path.join(cwd, "form.json"), JSON.stringify(changed));
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_SESSION_ID: "session", ONTOMATO_RUN_ID: "run" };
  expect((await run(["draft", "update", agentId, "@form.json"], env, cwd)).code).toBe(0);
  // A draft keeps the shape the agent gave: it does not fill the skills, or anything else, from the stored agent.
  expect(JSON.parse(await readFile(path.join(cwd, "outputs/drafts/agent.page-draft.json"), "utf8")).form).toEqual(changed);
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

it("validates the draft's target and form together", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const base = await serve((url, body, response) => {
    seen.push({ url, body });
    response.statusCode = 204;
    response.end();
  });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-validate-"));
  await writeFile(path.join(cwd, "form.json"), JSON.stringify(form));
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "session-token" };
  expect((await run(["draft", "update", agentId, "@form.json"], env, cwd)).code).toBe(0);
  const validated = await run(["validate-draft", "@outputs/drafts/agent.page-draft.json"], env, cwd);
  expect(validated.code).toBe(0);
  expect(validated.stdout.trim()).toBe("ok");
  expect(seen).toEqual([{ url: "/api/assistant/agent-definitions/validate", body: { target: { id: agentId }, form } }]);
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

it("uses the execution callback credential instead of tk when the runtime provides one", async () => {
  const seen: { url: string; headers: IncomingMessage["headers"] }[] = [];
  const base = await serve((url, _body, response, request) => {
    seen.push({ url, headers: request.headers });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ agents: [] }));
  });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-builder-callback-"));
  const env = { ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_EXECUTION_CALLBACK: "wbc1-run", ONTOMATO_RUN_ID: "run-id",
    ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base };
  const result = await run(["list"], env, cwd);
  expect(result.code).toBe(0);
  expect(seen).toHaveLength(1);
  expect(seen[0].url).toBe("/api/assistant/agent-definitions");
  expect(seen[0].headers["x-ontomato-callback-credential"]).toBe("wbc1-run");
  expect(seen[0].headers["x-ontomato-run-id"]).toBe("run-id");
  expect(seen[0].headers.tk).toBeUndefined();
  expect(seen[0].headers["x-api-key"]).toBeUndefined();
});
