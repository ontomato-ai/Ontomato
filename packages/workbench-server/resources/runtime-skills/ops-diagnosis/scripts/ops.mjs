#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const e = process.env, enc = encodeURIComponent;
const [command, raw = "{}"] = process.argv.slice(2);
try {
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a JSON object");
  if (!e.ONTOMATO_WORKBENCH_URL) throw new Error("ONTOMATO_WORKBENCH_URL is required");
  if (e.ONTOMATO_TK && e.ONTOMATO_API_KEY) throw new Error("Choose TK or API key, not both");
  const headers = { "Content-Type": "application/json" };
  for (const [variable, header] of [["ONTOMATO_TK", "tk"], ["ONTOMATO_API_KEY", "X-API-Key"], ["ONTOMATO_RUN_ID", "X-Ontomato-Run-Id"], ["ONTOMATO_SESSION_ID", "X-Ontomato-Session-Id"], ["ONTOMATO_CORRELATION_ID", "X-Correlation-Id"], ["ONTOMATO_LANGUAGE", "Accept-Language"]]) if (e[variable]) headers[header] = e[variable];
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
  const response = await fetch(e.ONTOMATO_WORKBENCH_URL.replace(/\/$/, "") + "/api/observe/evidence" + endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
