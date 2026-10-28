import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
const base = process.env.ONTOMATO_WORKBENCH_URL?.replace(/\/$/, "");
if (!base) throw new Error("Set ONTOMATO_WORKBENCH_URL (see SKILL.md)");
const [arg, target] = process.argv.slice(2),
  headers = {
    "content-type": "application/json",
    tk: process.env.ONTOMATO_TK ?? "",
    "Accept-Language": process.env.ONTOMATO_LANGUAGE ?? "en",
    "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID ?? randomUUID(),
  };
async function call(route, body, extra = {}) {
  const response = await fetch(base + "/api/retrievals" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
const input =
  arg === "close"
    ? {}
    : JSON.parse(
        await readFile(
          (arg === "begin" ? target : arg).replace(/^@/, ""),
          "utf8",
        ),
      );
await mkdir("work", { recursive: true });
let state = process.env.ONTOMATO_RUN_ID
  ? {
      id: process.env.ONTOMATO_RETRIEVAL_ID,
      sessionId: process.env.ONTOMATO_SESSION_ID,
      runId: process.env.ONTOMATO_RUN_ID,
    }
  : null;
if (!state)
  try {
    state = JSON.parse(await readFile("work/.retrieval-run.json", "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
if (arg === "begin" || !state) {
  const question = input.question;
  const body = { question, ...(state?.id ? { retrievalId: state.id } : {}) };
  let key = randomUUID();
  try {
    const pending = JSON.parse(
      await readFile("work/.retrieval-begin.json", "utf8"),
    );
    if (JSON.stringify(pending.body) !== JSON.stringify(body))
      throw new Error("A different begin intent is unresolved");
    key = pending.key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile("work/.retrieval-begin.json", JSON.stringify({ key, body }));
  state = await call("/skill-runs", body, { "Idempotency-Key": key });
  await writeFile("work/.retrieval-run.json", JSON.stringify(state));
  await rm("work/.retrieval-begin.json", { force: true });
  if (arg === "begin") {
    console.log(JSON.stringify(state));
    process.exit(0);
  }
}
if (arg === "close") {
  await call(`/${state.id}/skill-runs/${state.runId}/close`, {});
  console.log("Closed");
  process.exit(0);
}
if (!target?.endsWith(".dataset.json"))
  throw new Error("Output must end in .dataset.json");
const output = path.resolve(target),
  outRoot = path.resolve(process.env.ONTOMATO_OUTPUT_DIR ?? "outputs");
if (!output.startsWith(outRoot + path.sep))
  throw new Error("Write datasets under outputs/");
const hash = createHash("sha256")
  .update(JSON.stringify([state.runId, input]))
  .digest("hex");
const keyFile = `work/.dataset-${hash}.json`;
let key;
try {
  key = JSON.parse(await readFile(keyFile, "utf8")).key;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  key = randomUUID();
  await writeFile(keyFile, JSON.stringify({ key }));
}
const extra = {
  "X-Ontomato-Run-Id": state.runId,
  "X-Ontomato-Session-Id": state.sessionId,
};
await call(`/${state.id}/runs/${state.runId}/outputs`, input, {
  ...extra,
  "Idempotency-Key": key,
});
let result;
do {
  result = await call(
    `/${state.id}/runs/${state.runId}/outputs/${key}`,
    undefined,
    extra,
  );
  if (result.running) await new Promise((resolve) => setTimeout(resolve, 250));
} while (result.running);
if (result.error) throw new Error(JSON.stringify(result.error));
await mkdir(path.dirname(output), { recursive: true });
const temporary = path.resolve("work", `.dataset-${key}.tmp`);
await writeFile(temporary, JSON.stringify(result.dataset));
await rename(temporary, output);
console.log(
  JSON.stringify({
    path: target,
    rowCount: result.dataset.rows.length,
    columns: result.dataset.columns,
    truncation: result.dataset.truncation,
  }),
);
