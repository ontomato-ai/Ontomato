#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const env = process.env;
// Inside the platform use live page tools (`present`, `fill_form`, `page_action`); outside it, write directly via API.
const platform = env.ONTOMATO_SKILL_SCENARIO === "platform";
const workbench = (env.ONTOMATO_WORKBENCH_URL || env.ONTOMATO_URL || "").replace(/\/$/, "");
const ontology = (env.ONTOMATO_ONTOLOGY_URL || `${workbench}/api/data-query`).replace(/\/$/, "");
const definitions = `${workbench}/api/assistant/agent-definitions`;

function required(value, what) {
  if (!value) throw new Error(`${what} is required`);
  return value;
}

function headers() {
  const credentials = [
    ["ONTOMATO_EXECUTION_CALLBACK", "X-Ontomato-Callback-Credential"],
    ["ONTOMATO_TK", "tk"],
    ["ONTOMATO_API_KEY", "X-API-Key"],
  ].filter(([variable]) => env[variable]);
  if (credentials.length > 1)
    throw new Error("Set only one of ONTOMATO_EXECUTION_CALLBACK, ONTOMATO_TK or ONTOMATO_API_KEY");
  const result = { "Content-Type": "application/json", "Accept-Language": env.ONTOMATO_LANGUAGE || "en" };
  if (credentials.length) result[credentials[0][1]] = env[credentials[0][0]];
  for (const [variable, header] of [["ONTOMATO_RUN_ID", "X-Ontomato-Run-Id"], ["ONTOMATO_SESSION_ID", "X-Ontomato-Session-Id"], ["ONTOMATO_CORRELATION_ID", "X-Correlation-Id"]])
    if (env[variable]) result[header] = env[variable];
  return result;
}

function reason(text) {
  try {
    const body = JSON.parse(text);
    return body.error?.message ?? body.message ?? text;
  } catch {
    return text;
  }
}

async function request(method, url, body, extra = {}) {
  if (!workbench) throw new Error("Set ONTOMATO_WORKBENCH_URL (platform) or ONTOMATO_URL (deployment)");
  const response = await fetch(url, {
    method,
    headers: { ...headers(), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${reason(text)}`);
  return text ? JSON.parse(text) : null;
}

const print = (value) => console.log(JSON.stringify(value, null, 2));

async function input(argument) {
  required(argument, "A JSON argument or @file");
  return argument.startsWith("@") ? readFile(argument.slice(1), "utf8") : argument;
}

async function form(argument) {
  const value = JSON.parse(await input(argument));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The form must be a JSON object");
  return value;
}

async function directWrite(command, args) {
  if (platform)
    throw new Error("Direct writes are unavailable in the platform. Open the agent settings page with `present`, fill fields with `fill_form`, and save via `page_action` (or let the user save on the page).");
  if (command === "create") return print(await request("POST", definitions, await form(args[0]), { "Idempotency-Key": randomUUID() }));
  const agentId = encodeURIComponent(required(args[0], "An agent id"));
  if (command === "update") return print(await request("PUT", `${definitions}/${agentId}`, await form(args[1])));
  await request("DELETE", `${definitions}/${agentId}`);
  console.log("ok");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "list") return print(await request("GET", definitions));
  if (command === "get") return print(await request("GET", `${definitions}/${encodeURIComponent(required(args[0], "An agent id"))}`));
  if (command === "skills") return print(await request("GET", `${workbench}/api/assistant/agent-skills`));
  if (command === "models") return print((await request("GET", `${ontology}/model-options`)).data);
  if (command === "execution-users")
    return print(await request("GET", `${ontology}/platform/agent-execution/options?${new URLSearchParams({ keyword: args[0] ?? "", pageNum: "1", pageSize: "100" })}`));
  if (["create", "update", "delete"].includes(command)) return directWrite(command, args);
  throw new Error("Use list, get, skills, models, execution-users, create, update or delete");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
