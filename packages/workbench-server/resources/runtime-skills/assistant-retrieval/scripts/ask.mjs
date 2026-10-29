import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
const e = process.env,
  source = process.argv[2]?.replace(/^@/, "");
if (!source) throw new Error("Expected @request.json");
const body = await readFile(source, "utf8"),
  args = JSON.parse(body),
  receipt = source + ".request.json";
let saved;
try {
  saved = JSON.parse(await readFile(receipt, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (saved && saved.body !== body)
  throw new Error("Use a new request file for changed input");
const key = saved?.key ?? randomUUID();
if (!saved) await writeFile(receipt, JSON.stringify({ key, body }));
const internal = !!e.ONTOMATO_ASSISTANT_SESSION_ID;
const base = e.ONTOMATO_WORKBENCH_URL?.replace(/\/$/, "");
const token = internal ? e.ONTOMATO_RETRIEVAL_CALLBACK_TOKEN : e.ONTOMATO_TK;
if (!base || !token)
  throw new Error("Workbench URL and retrieval credential are required");
const root = internal
  ? `${base}/api/assistant/sessions/${e.ONTOMATO_ASSISTANT_SESSION_ID}/runs/${e.ONTOMATO_RUN_ID}/retrievals`
  : `${base}/api/retrievals`;
async function request(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    headers: {
      tk: token,
      ...(internal ? { "X-Ontomato-Run-Id": e.ONTOMATO_RUN_ID } : {}),
      "Accept-Language": e.ONTOMATO_LANGUAGE ?? "en",
      "Idempotency-Key": key,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r;
}
let requestBody = args,
  url = root;
if (!internal) {
  if (args.retrievalId) {
    url = `${root}/${args.retrievalId}/answers`;
    if (saved?.requestBody) requestBody = saved.requestBody;
    else {
      const prior = await (await request(root + "/" + args.retrievalId)).json();
      requestBody = {
        message: args.message,
        expectedRunId: prior.runtimeRunId,
        expectedDecisionRevision: prior.decisionRevision,
      };
      await writeFile(receipt, JSON.stringify({ key, body, requestBody }));
    }
  } else
    requestBody = {
      question: args.question,
      userQuotes: [args.question],
      previousDatasetIds: [],
      interaction: "resumable",
    };
}
let snapshot = await (await request(url, "POST", requestBody)).json();
while (!snapshot.run || snapshot.run.status === "running") {
  await new Promise((r) => setTimeout(r, 500));
  snapshot = await (await request(root + "/" + snapshot.id)).json();
}
const files = [];
await mkdir("work", { recursive: true });
for (const id of snapshot.datasetArtifactIds) {
  const out = `outputs/retrievals/${snapshot.id}/${id}.dataset.json`,
    tmp = `work/${id}.download`;
  await mkdir(path.dirname(out), { recursive: true });
  const r = await request(
    internal
      ? `${root}/${snapshot.id}/artifacts/${id}/content`
      : `${root}/${snapshot.id}/datasets/${id}`,
  );
  await writeFile(
    tmp,
    internal
      ? Buffer.from(await r.arrayBuffer())
      : JSON.stringify((await r.json()).payload),
  );
  await rename(tmp, out);
  files.push(out);
}
const message = [...snapshot.messages]
  .reverse()
  .find((m) => m.message.role === "assistant")?.message;
const answer =
  typeof message?.content === "string"
    ? message.content
    : (message?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
console.log(
  JSON.stringify({
    retrievalId: snapshot.id,
    run: snapshot.run,
    answer,
    files,
  }),
);
