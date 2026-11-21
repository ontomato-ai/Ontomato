#!/usr/bin/env node
// The main assistant's entry point. Published into the ontomato-analyst-assistant package together with the analyst
// package's client.mjs, application.yml and retriever-ref.json, so the retriever, the app builder and the ontomap builder
// never see these commands. `start-retrieval` starts the retriever and recalls published metrics concurrently;
// `run-metric` opens one formal retrieval run and delivers one table, so the assistant cites a stored dataset instead of
// a response it stitched together itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analystCommand, readJson, sendAgentCommand } from "./client.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url)),
  cfg = {};
try {
  for (const line of fs
    .readFileSync(path.join(dir, "application.yml"), "utf8")
    .split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const at = text.indexOf(":");
    if (at < 0) throw new Error("application.yml requires key: value lines");
    cfg[text.slice(0, at).trim()] = text.slice(at + 1).trim();
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const [env, key] of Object.entries({
  ONTOMATO_URL: "envUrl",
  ONTOMATO_ONTOLOGY_URL: "ontologyUrl",
  ONTOMATO_TK: "tk",
}))
  if (process.env[env] !== undefined) cfg[key] = process.env[env];
const token = cfg.tk;
const headers = {
  ...(process.env.ONTOMATO_EXECUTION_CALLBACK ? { "X-Ontomato-Callback-Credential": process.env.ONTOMATO_EXECUTION_CALLBACK, "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
  ...(process.env.ONTOMATO_SESSION_ID ? { "X-Ontomato-Session-Id": process.env.ONTOMATO_SESSION_ID } : {}),
  ...(process.env.ONTOMATO_RETRIEVAL_CALLER_ID ? { "X-Ontomato-Retrieval-Caller-Id": process.env.ONTOMATO_RETRIEVAL_CALLER_ID } : {}),
  ...(token ? { tk: token } : {}),
  ...(process.env.ONTOMATO_API_KEY ? { "X-API-Key": process.env.ONTOMATO_API_KEY } : {}),
  "Accept-Language": process.env.ONTOMATO_LANGUAGE ?? "en",
  ...(process.env.ONTOMATO_RUN_ID ? { "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
  ...(process.env.ONTOMATO_CORRELATION_ID ? { "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID } : {}),
};

const ontology = (cfg.ontologyUrl || `${cfg.envUrl}/api/data-query`).replace(/\/$/u, "");
const callback = process.env.ONTOMATO_RETRIEVAL_CALLBACK_URL;

async function request(url, body, extra = {}) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok || result?.error) {
    const message = typeof result?.error === "string"
      ? result.error
      : (result?.error?.message ?? result?.message ?? `HTTP ${response.status}`);
    const error = new Error(message);
    error.status = response.status;
    const code = result?.error?.code ?? (typeof result?.code === "string" ? result.code : undefined);
    if (code) error.code = code;
    throw error;
  }
  return result;
}
async function originalBytes(url, extra = {}) {
  const response = await fetch(url, { headers: { ...headers, ...extra }, redirect: "error" });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return text;
}
function option(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  args.splice(at, 2);
  return value;
}

async function recallMetrics(question) {
  return request(`${ontology}/ontology/query/metrics/recall`, { question });
}

async function runMetric(selector, question) {
  const key = randomUUID();
  const run = await request(callback || `${ontology}/ontology/retrievals/skill-runs`,
    callback ? { operation: "begin", key, input: { question } } : { question },
    callback ? {} : { "Idempotency-Key": key });
  const retrieval = encodeURIComponent(run.id), retrievalRun = encodeURIComponent(run.runId);
  const runHeaders = { "X-Ontomato-Run-Id": run.runId };
  const named = (operation, extra) => ({ operation, retrievalId: run.id, retrievalRunId: run.runId, ...extra });
  await request(callback || `${ontology}/ontology/retrievals/${retrieval}/runs/${retrievalRun}/submit-metric`,
    callback ? named("submit-metric", { key, input: selector }) : selector,
    callback ? {} : { ...runHeaders, "Idempotency-Key": key });
  const route = `${ontology}/ontology/retrievals/${retrieval}/runs/${retrievalRun}/outputs/${encodeURIComponent(key)}`;
  let state;
  do {
    state = await request(callback || route, callback ? named("status", { key }) : undefined,
      callback ? {} : runHeaders);
    if (state.running) await new Promise((resolve) => setTimeout(resolve, 250));
  } while (state.running);
  if (state.error) throw new Error(JSON.stringify(state.error));
  const content = `${route}/content`;
  const bytes = callback
    ? JSON.stringify(await request(callback, named("content", { key })))
    : await originalBytes(content, runHeaders);
  await request(callback || `${ontology}/ontology/retrievals/${retrieval}/skill-runs/${retrievalRun}/close`,
    callback ? named("close") : {});
  return { key, dataset: state.dataset, bytes };
}

function errorValue(error) {
  return {
    error: {
      message: error instanceof Error ? error.message : String(error),
      ...(error?.status !== undefined ? { status: error.status } : {}),
      ...(error?.code !== undefined ? { code: error.code } : {}),
    },
  };
}

async function startRetrieval(args) {
  const question = args.join(" ");
  if (!question.trim()) throw new Error("start-retrieval requires the complete question");
  const retrieverRef = JSON.parse(fs.readFileSync(path.join(dir, "retriever-ref.json"), "utf8"));
  const [retrieverResult, recallResult] = await Promise.allSettled([
    sendAgentCommand({ op: "start", agent: retrieverRef, message: question }, { cfg, headers }),
    recallMetrics(question),
  ]);
  console.log(JSON.stringify({
    retriever: retrieverResult.status === "fulfilled" ? retrieverResult.value : errorValue(retrieverResult.reason),
    recall: recallResult.status === "fulfilled" ? recallResult.value : errorValue(recallResult.reason),
  }));
  if (retrieverResult.status === "rejected" || recallResult.status === "rejected") process.exitCode = 1;
}

async function runMetricCommand(args) {
  const revision = option(args, "--revision"), question = option(args, "--question"),
    bindingId = option(args, "--binding"), params = option(args, "--params");
  if (args.length !== 1) throw new Error("run-metric requires one metric id");
  if (!revision || !question) throw new Error("run-metric requires --revision and --question");
  if (bindingId && params) throw new Error("--binding and --params are mutually exclusive");
  const { key, dataset, bytes } = await runMetric({ id: args[0], revision, ...(bindingId ? { bindingId } : {}),
    ...(params ? { parameters: readJson(params) } : {}) }, question);
  const target = `outputs/metrics/${key}.dataset.json`;
  const output = path.resolve(target), root = path.resolve(process.env.ONTOMATO_OUTPUT_DIR ?? "outputs");
  if (!output.startsWith(root + path.sep)) throw new Error("Write dataset files under outputs/");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  console.log(JSON.stringify({ path: target, title: dataset.title, rowCount: dataset.rows.length,
    columns: dataset.columns, truncation: dataset.truncation ?? null,
    receiptId: dataset.execution.receiptId }));
}

// Data questions start the retriever and recall metrics concurrently through `start-retrieval`; follow-ups, reads and
// cancellation use the native agent tool.
const metadata = ["dataset-desc", "classes", "schema", "relationships", "knowledge"];
const [command, ...commandArgs] = process.argv.slice(2);
const run = command === "start-retrieval" ? () => startRetrieval(commandArgs)
  : command === "run-metric" ? () => runMetricCommand(commandArgs)
  : metadata.includes(command) ? () => analystCommand(cfg, process.argv.slice(2), headers)
  : () => { throw new Error(`Commands: ${metadata.join(", ")}, start-retrieval, run-metric`); };
Promise.resolve().then(run).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
