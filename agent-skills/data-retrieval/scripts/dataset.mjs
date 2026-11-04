import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { collectPackage } from "./query-package.mjs";

const base = process.env.ONTOMATO_ONTOLOGY_URL?.replace(/\/$/, "");
if (!base) throw new Error("Set ONTOMATO_ONTOLOGY_URL (see SKILL.md)");
const [command, entry, ...args] = process.argv.slice(2);
if (!["deliver", "preview", "begin", "close"].includes(command))
  throw new Error("Use deliver @query --meta @delivery.json [--params @values.json] [--out outputs/result.dataset.json]");
const json = async (file) => JSON.parse(await readFile(file.replace(/^@/, ""), "utf8"));
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--meta", "--params", "--out"].includes(args[i]) || !args[i + 1] || options[args[i]])
    throw new Error("Invalid or duplicate delivery option: " + args[i]);
  options[args[i]] = args[i + 1];
}
let input = {};
if (command === "begin") input = await json(entry);
else if (command !== "close") {
  if (!options["--meta"]) throw new Error("--meta @delivery.json is required");
  const meta = await json(options["--meta"]), selector = await json(entry);
  const { columnLabels, ...description } = meta;
  input = { ...description, recipe: selector.kind === "metric" ? selector : {
    kind: "package", package: await collectPackage(entry),
    parameters: options["--params"] ? await json(options["--params"]) : {}, columnLabels,
  } };
  if (selector.kind === "metric" && options["--params"])
    throw new Error("Metric parameters belong in the metric selector");
}
const headers = {
  "content-type": "application/json", tk: process.env.ONTOMATO_TK ?? "",
  ...(process.env.ONTOMATO_RETRIEVAL_CALLER_ID ? { "X-Ontomato-Retrieval-Caller-Id": process.env.ONTOMATO_RETRIEVAL_CALLER_ID } : {}),
  ...(process.env.ONTOMATO_API_KEY ? { "X-API-Key": process.env.ONTOMATO_API_KEY } : {}),
  "Accept-Language": process.env.ONTOMATO_LANGUAGE ?? "en",
  "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID ?? randomUUID(),
  ...(process.env.ONTOMATO_RUN_ID ? { "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
  ...(process.env.ONTOMATO_SESSION_ID ? { "X-Ontomato-Session-Id": process.env.ONTOMATO_SESSION_ID } : {}),
};
async function call(route, body, extra = {}, raw = false) {
  const response = await fetch(base + "/ontology/retrievals" + route, {
    method: body === undefined ? "GET" : "POST", headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "error",
  });
  const value = response.status === 204 ? null : raw ? await response.text() : await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
await mkdir("work", { recursive: true }).catch((error) => {
  if (!["EACCES", "EROFS", "EPERM"].includes(error.code)) throw error;
  throw new Error(`Cannot write work/ in ${process.cwd()}; run this command from the workspace root`);
});
let state = process.env.ONTOMATO_RUN_ID ? {
  id: process.env.ONTOMATO_RETRIEVAL_ID, sessionId: process.env.ONTOMATO_SESSION_ID, runId: process.env.ONTOMATO_RUN_ID,
} : null;
if (!state) {
  try { state = await json("work/.retrieval-run.json"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (command === "begin" || !state) {
  if (!input.question) throw new Error("External delivery requires begin @question.json first");
  const body = { question: input.question, ...(state?.id ? { retrievalId: state.id } : {}) };
  let key = randomUUID();
  try {
    const pending = await json("work/.retrieval-begin.json");
    if (JSON.stringify(pending.body) !== JSON.stringify(body)) throw new Error("A different begin intent is unresolved");
    key = pending.key;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeFile("work/.retrieval-begin.json", JSON.stringify({ key, body }));
  state = await call("/skill-runs", body, { "Idempotency-Key": key });
  await writeFile("work/.retrieval-run.json", JSON.stringify(state));
  await rm("work/.retrieval-begin.json", { force: true });
  if (command === "begin") { console.log(JSON.stringify(state)); process.exit(0); }
}
if (command === "close") {
  await call(`/${state.id}/skill-runs/${state.runId}/close`, {});
  console.log("Closed"); process.exit(0);
}
const hash = createHash("sha256").update(JSON.stringify([state.runId, input])).digest("hex");
const target = options["--out"] ?? `outputs/result-${hash.slice(0, 12)}.dataset.json`;
const output = path.resolve(target), outRoot = path.resolve(process.env.ONTOMATO_OUTPUT_DIR ?? "outputs");
if (!target.endsWith(".dataset.json") || !output.startsWith(outRoot + path.sep))
  throw new Error("Write .dataset.json files under outputs/");
const keyFile = `work/.dataset-${hash}.json`;
let key;
try { key = (await json(keyFile)).key; }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  key = randomUUID(); await writeFile(keyFile, JSON.stringify({ key }));
}
const extra = { "X-Ontomato-Run-Id": state.runId, "X-Ontomato-Session-Id": state.sessionId };
await call(`/${state.id}/runs/${state.runId}/outputs`, input, { ...extra, "Idempotency-Key": key });
let result;
do {
  result = await call(`/${state.id}/runs/${state.runId}/outputs/${key}`, undefined, extra);
  if (result.running) await new Promise((resolve) => setTimeout(resolve, 250));
} while (result.running);
if (result.error) throw new Error(JSON.stringify(result.error));
if (command === "preview") { console.log(JSON.stringify(result.dataset, null, 2)); process.exit(0); }
await mkdir(path.dirname(output), { recursive: true });
const temporary = path.resolve("work", `.dataset-${key}.tmp`);
await writeFile(temporary, await call(`/${state.id}/runs/${state.runId}/outputs/${key}/content`, undefined, extra, true));
await rename(temporary, output);
console.log(JSON.stringify({ path: target, rowCount: result.dataset.rows.length, columns: result.dataset.columns,
  truncation: result.dataset.truncation, receiptId: result.dataset.execution.receiptId,
  packageSha256: result.dataset.recipe.packageSha256 }));
