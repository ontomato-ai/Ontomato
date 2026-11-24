#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const e = process.env, enc = encodeURIComponent;
const [command, raw = "{}"] = process.argv.slice(2);
try {
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a JSON object");
  if (!e.ONTOMATO_WORKBENCH_URL) throw new Error("ONTOMATO_WORKBENCH_URL is required");
  // The sandbox exports the same session credential under the standard and legacy names.
  const legacyAlias = e.ONTOMATO_SKILL_SCENARIO === "platform" && e.ONTOMATO_TK === e.ONTOMATO_EXECUTION_CALLBACK;
  const credentials = [
    ["ONTOMATO_EXECUTION_CALLBACK", "X-Ontomato-Callback-Credential"],
    ["ONTOMATO_TK", "tk"],
    ["ONTOMATO_API_KEY", "X-API-Key"],
  ].filter(([variable]) => e[variable] && !(legacyAlias && variable === "ONTOMATO_TK"));
  if (credentials.length > 1) throw new Error("Set only one of ONTOMATO_EXECUTION_CALLBACK, ONTOMATO_TK or ONTOMATO_API_KEY");
  const headers = { "Content-Type": "application/json" };
  if (credentials.length) headers[credentials[0][1]] = e[credentials[0][0]];
  for (const [variable, header] of [["ONTOMATO_RUN_ID", "X-Ontomato-Run-Id"], ["ONTOMATO_SESSION_ID", "X-Ontomato-Session-Id"], ["ONTOMATO_CORRELATION_ID", "X-Correlation-Id"], ["ONTOMATO_LANGUAGE", "Accept-Language"]]) if (e[variable]) headers[header] = e[variable];
  const required = (key) => { if (typeof input[key] !== "string" || !input[key]) throw new Error(`${key} is required`); return enc(input[key]); };
  let endpoint, method = "GET", body;
  if (command === "resolve") { endpoint = "/resolve"; method = "POST"; body = { target: input }; }
  else if (command === "query") { endpoint = "/query"; method = "POST"; body = input; }
  else if (command === "logs") {
    const { service, ...query } = input;
    if (!["workbench", "ontology", "agent-runtime"].includes(service)) throw new Error("Unknown service");
    endpoint = `/logs/${service}?${new URLSearchParams({ limit: 20, ...query })}`;
  } else if (["session", "run", "artifact"].includes(command)) {
    if (!["workbench", "ontology"].includes(input.owner)) throw new Error("Unknown owner");
    endpoint = `/runtime/${input.owner}/sessions/${required("sessionId")}`;
    if (command === "run") endpoint += `/runs/${required("runId")}`;
    if (command === "artifact") endpoint += `/artifacts/${required("artifactId")}${input.content ? "/content" : ""}`;
  } else if (["config", "health", "metadata"].includes(command)) endpoint = `/${command}?${new URLSearchParams(input)}`;
  else if (command === "knowledge") endpoint = input.path ? `/knowledge/content?path=${enc(input.path)}` : "/knowledge";
  else throw new Error("Use resolve, logs, session, run, artifact, config, health, metadata, query or knowledge");
  const base = e.ONTOMATO_WORKBENCH_URL.replace(/\/$/, "");
  // Platform runs forward ONTOMATO_WORKBENCH_URL to /api/observe/evidence directly; external callers supply the root before /api.
  const evidenceBase = (e.ONTOMATO_SKILL_SCENARIO === "platform" || e.ONTOMATO_EXECUTION_CALLBACK || base.endsWith("/api/observe/evidence"))
    ? base
    : base + "/api/observe/evidence";
  const response = await fetch(evidenceBase + endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(`${response.status} ${error?.error?.code ?? "EVIDENCE_UNAVAILABLE"}: ${error?.error?.message ?? "Evidence unavailable"}`); }
  if (command === "artifact" && input.content && input.out) {
    const out = input.out;
    if (typeof out !== "string" || !out.startsWith("work/") || out.includes("\\") || out.split("/").includes("..")) throw new Error("Artifact output must be a relative work/ file");
    await mkdir(path.dirname(out), { recursive: true });
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(out, bytes);
    console.log(JSON.stringify({ artifactId: input.artifactId, path: out, size: bytes.length }));
  } else {
    const text = await response.text();
    if (text.length <= 30000) console.log(text);
    else console.log(JSON.stringify({ source: { command, input }, abbreviated: true, totalCharacters: text.length, shownCharacters: 30000, preview: text.slice(0, 30000), note: "Output abbreviated. Narrow the query; this preview does not cover all evidence." }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
