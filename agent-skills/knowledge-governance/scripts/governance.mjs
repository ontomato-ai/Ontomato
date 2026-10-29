import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = process.env.ONTOMATO_ONTOLOGY_URL?.replace(/\/$/, "");
if (!base) throw new Error("Set ONTOMATO_ONTOLOGY_URL (see SKILL.md)");
const [command, arg] = process.argv.slice(2),
  stateFile = "work/.governance-run.json";
const headers = {
  "content-type": "application/json",
  tk: process.env.ONTOMATO_GOVERNANCE_TK ?? process.env.ONTOMATO_TK ?? "",
  "X-API-Key": process.env.ONTOMATO_API_KEY ?? "",
  "Accept-Language": process.env.ONTOMATO_LANGUAGE ?? "en",
  "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID ?? randomUUID(),
    ...(process.env.ONTOMATO_RUN_ID ? { "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
    ...(process.env.ONTOMATO_SESSION_ID ? { "X-Ontomato-Session-Id": process.env.ONTOMATO_SESSION_ID } : {}),
};
async function call(route, body, extra = {}) {
  const response = await fetch(base + "/ontology/ai/knowledge-governance" + route, {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
    redirect: "error",
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const args = arg
  ? JSON.parse(arg.startsWith("@") ? await readFile(arg.slice(1), "utf8") : arg)
  : {};
let state = process.env.ONTOMATO_RUN_ID
  ? {
      id: process.env.ONTOMATO_GOVERNANCE_ID,
      sessionId: process.env.ONTOMATO_SESSION_ID,
      runId: process.env.ONTOMATO_RUN_ID,
    }
  : null;
if (!state)
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
if (command === "begin" || !state) {
  await mkdir("work", { recursive: true });
  let key = randomUUID();
  const input = {
    ...((args.id ?? state?.id) ? { id: args.id ?? state.id } : {}),
    message:
      command === "begin"
        ? (args.message ?? "Govern knowledge through standard skills")
        : "Govern knowledge through standard skills",
  };
  try {
    const pending = JSON.parse(
      await readFile("work/.governance-begin.json", "utf8"),
    );
    if (JSON.stringify(pending.input) !== JSON.stringify(input))
      throw new Error("A different begin intent is unresolved");
    key = pending.key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(
    "work/.governance-begin.json",
    JSON.stringify({ key, input }),
  );
  state = await call("/skill-runs", input, { "Idempotency-Key": key });
  await writeFile(stateFile, JSON.stringify(state));
  await rm("work/.governance-begin.json", { force: true });
  if (command === "begin") {
    console.log(JSON.stringify(state));
    process.exit(0);
  }
}
if (command === "close") {
  await call(`/${state.id}/skill-runs/${state.runId}/close`, {});
  console.log("Closed");
  process.exit(0);
}
const actions = {
  "read-knowledge": "read_knowledge",
  "read-ontology": "read_ontology",
  "search-history": "search_history",
  "read-history": "read_history",
    "read-evidence": "read_evidence",
  "collect-turn-artifacts": "collect_turn_artifacts",
  "read-work-record": "read_work_record",
  "update-work-record": "update_work_record",
};
if (!actions[command])
  throw new Error("Unknown governance command; see SKILL.md");
console.log(
  JSON.stringify(
    await call(
      `/${state.id}/runs/${state.runId}/actions/${actions[command]}`,
      args,
      {
        "X-Ontomato-Session-Id": state.sessionId,
        "X-Ontomato-Run-Id": state.runId,
      },
    ),
    null,
    2,
  ),
);
