#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function die(message) {
  console.error(message);
  process.exit(1);
}

function loadConfig() {
  const text = fs.readFileSync(path.join(DIR, "application.yml"), "utf8");
  const cfg = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) die(`application.yml line is not key: value: ${trimmed}`);
    cfg[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  if (process.env.ONTOMATO_URL) cfg.envUrl = process.env.ONTOMATO_URL;
  return cfg;
}

function readInput(arg) {
  if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8");
  return arg;
}

function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

function headers(api) {
  const h = { "Accept-Language": api.lang };
  if (api.tk) h.tk = api.tk;
  return h;
}

// Two services sit behind the same frontend URL: the data engine under /api/data-query and the workbench under /api.
async function call(api, method, apiPath, body) {
  const h = headers(api);
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${api.envUrl}${apiPath}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: reported below with the status.
  }
  if (!res.ok || (json && json.success === false)) die(`${res.status}\n${json?.message || json?.error || text}`);
  return json;
}

const requestJson = (api, method, backendPath, body) => call(api, method, `/api/data-query${backendPath}`, body);

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function readJsonInput(arg, what) {
  if (arg == null) die(`${what} requires <json|@file>`);
  const value = JSON.parse(readInput(arg));
  if (value === null || typeof value !== "object" || Array.isArray(value)) die(`${what} must be a JSON object`);
  return value;
}

// The fields an agent definition keeps; read-only and derived fields are left out of a save.
const AGENT_FIELDS = [
  "name", "description", "icon", "executionMode", "loopPrompt", "reportDeliverableEnabled", "hotReportEnabled",
  "summaryPosition", "analysisDimensionPrompt", "summarizerPrompt", "conclusionMakerPrompt", "enabledSkillIds",
  "enabledVisualizationSkillIds", "enabledMcpServiceNames", "enabledActionIds", "enabledMetricViewIds",
  "classNames", "graphScope", "isEnabled", "sortOrder",
];

async function agentCommand(api, argv) {
  const [sub, arg] = argv;
  if (sub === "list") {
    const json = await call(api, "GET", "/api/analysis-agents");
    print((json.data || []).map((a) => ({ id: a.id, name: a.name, regular: a.reportDeliverableEnabled === false, isEnabled: a.isEnabled })));
    return;
  }
  if (sub === "get") {
    if (arg == null) die("agent get requires an id");
    print((await call(api, "GET", `/api/analysis-agents/${encodeURIComponent(arg)}`)).data);
    return;
  }
  if (sub === "save") {
    const input = readJsonInput(arg, "agent save");
    const definition = Object.fromEntries(Object.entries(input).filter(([key]) => AGENT_FIELDS.includes(key)));
    const json = input.id
      ? await call(api, "PUT", `/api/analysis-agents/${encodeURIComponent(input.id)}`, definition)
      : await call(api, "POST", "/api/analysis-agents", definition);
    print({ id: json.data.id, name: json.data.name });
    return;
  }
  if (sub === "delete") {
    if (arg == null) die("agent delete requires an id");
    await call(api, "DELETE", `/api/analysis-agents/${encodeURIComponent(arg)}`);
    console.log("ok");
    return;
  }
  usage();
}

async function mcpCommand(api, argv) {
  const [sub, arg] = argv;
  if (sub === "list") {
    const json = await call(api, "GET", "/api/mcp/services");
    // Header values are credentials: show only their names.
    print((json.services || []).map((s) => ({ name: s.name, url: s.url, headers: Object.keys(s.headers || {}) })));
    return;
  }
  if (sub === "tools") {
    if (arg == null) die("mcp tools requires a service name");
    print(await call(api, "GET", `/api/mcp/services/${encodeURIComponent(arg)}/tools`));
    return;
  }
  if (sub === "save") {
    const service = readJsonInput(arg, "mcp save");
    if (!service.name || !service.url) die("mcp save requires name and url");
    const body = { name: service.name, url: service.url, headers: service.headers || {} };
    const existing = ((await call(api, "GET", "/api/mcp/services")).services || []).some((s) => s.name === service.name);
    if (existing) await call(api, "PUT", `/api/mcp/services/${encodeURIComponent(service.name)}`, body);
    else await call(api, "POST", "/api/mcp/services", body);
    console.log(existing ? "updated" : "created");
    return;
  }
  if (sub === "delete") {
    if (arg == null) die("mcp delete requires a service name");
    await call(api, "DELETE", `/api/mcp/services/${encodeURIComponent(arg)}`);
    console.log("ok");
    return;
  }
  usage();
}

async function listPublished(api, prefix) {
  const json = await requestJson(api, "POST", `/${prefix}/queryList`, { status: "PUBLISHED" });
  print((json.data || []).map((item) => ({
    id: item.id,
    name: item.name,
    ...(prefix === "metricView" ? { readOnly: item.function?.operation === "OPERATION_READ" } : {}),
    parameters: (item.function?.parameters || []).map((p) => p.name),
  })));
}

function usage() {
  die(`usage: ontomato.mjs [--lang <tag>] <command>
  agent list
  agent get <id>
  agent save <json|@file>          (with "id": update that agent; without: create)
  agent delete <id>
  mcp list
  mcp tools <name>
  mcp save <json|@file>            ({"name","url","headers"}; an existing name is updated)
  mcp delete <name>
  skills
  metric-views                      (published; an agent can select the read-only ones)
  actions                           (published)`);
}

async function main() {
  const argv = process.argv.slice(2);
  let lang = "en";
  const li = argv.indexOf("--lang");
  if (li >= 0) {
    if (argv[li + 1] == null) die("--lang requires a value");
    lang = argv[li + 1];
    argv.splice(li, 2);
  }
  const cfg = loadConfig();
  if (!cfg.envUrl) die("Set ONTOMATO_URL or envUrl in application.yml");
  const api = { envUrl: cfg.envUrl.replace(/\/+$/, ""), lang, tk: null };
  const cmd = argv[0];
  if (cmd === "agent") return agentCommand(api, argv.slice(1));
  if (cmd === "mcp") return mcpCommand(api, argv.slice(1));
  if (cmd === "skills") {
    const json = await call(api, "GET", "/api/skills");
    print((json.skills || []).map((s) => ({ id: s.id, category: s.category, title: s.title, ...(s.enabled === false ? { enabled: false } : {}) })));
    return;
  }
  if (cmd === "metric-views") return listPublished(api, "metricView");
  if (cmd === "actions") return listPublished(api, "action");
  usage();
}

main();
