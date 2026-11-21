import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = process.env.ONTOMATO_ONTOLOGY_URL?.replace(/\/$/, "");
if (!base) throw new Error("Set ONTOMATO_ONTOLOGY_URL (see SKILL.md)");
const markdownLink = (title, href) => `[${title.replace(/[\\[\]]/g, "\\$&")}](${href})`;
const [command, arg] = process.argv.slice(2),
  platform = process.env.ONTOMATO_SKILL_SCENARIO === "platform",
  stateFile = platform ? "work/.governance-platform-window.json" : "work/.governance-run.json";
const headers = {
  ...(process.env.ONTOMATO_EXECUTION_CALLBACK ? { "X-Ontomato-Callback-Credential": process.env.ONTOMATO_EXECUTION_CALLBACK, "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
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
    headers: { ...headers, ...(state?.token ? { tk: state.token, "X-API-Key": "" } : {}), ...extra },
    body: JSON.stringify(body),
    redirect: "error",
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const actions = {
  "read-input":"read_input",
  "import-knowledge":"import_knowledge",
  "read-knowledge": "read_knowledge",
  "read-ontology": "read_ontology",
  "search-history": "search_history",
  "read-history": "read_history",
    "read-evidence": "read_evidence",
  "collect-turn-artifacts": "collect_turn_artifacts",
  "read-work-record": "read_work_record",
  "update-work-record": "update_work_record",
};
if (!["begin", "close", ...Object.keys(actions)].includes(command))
  throw new Error("Unknown governance command; see SKILL.md");
const args = arg
  ? JSON.parse(arg.startsWith("@") ? await readFile(arg.slice(1), "utf8") : arg)
  : {};
if (platform && command === "import-knowledge") {
  const response = await fetch(base + "/admin/getBussinessKnowledge", {
    method: "POST", redirect: "error", headers, body: "{}",
  });
  const result = await response.json();
  if (!response.ok || result.success !== true)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  const existing = new Map(Object.entries(result.data));
  const drafts = [];
  await mkdir("outputs/drafts", { recursive: true });
  for (const item of args.items) {
    const previous = existing.get(item.id);
    const draft = {
      pageKey: "business-knowledge",
      operation: previous ? "knowledge.update" : "knowledge.create",
      target: { objectType: "platform:BusinessKnowledge", ...(previous ? { id: previous.knowledgeID } : {}) },
      form: {
        knowledgeTitle: item.title, knowledgeText: item.text,
        knowledgeTags: item.tags ?? previous?.knowledgeTags ?? [],
        status: previous ? previous.status : 0,
      },
    };
    const path = `outputs/drafts/knowledge-${randomUUID()}.page-draft.json`;
    await writeFile(path, JSON.stringify(draft, null, 2));
    const query = new URLSearchParams({ draftSessionId: process.env.ONTOMATO_SESSION_ID,
      draftRunId: process.env.ONTOMATO_RUN_ID, draftPath: path });
    drafts.push({ path, link: markdownLink(item.title, `#/ontology/knowledge?${query}`) });
  }
  console.log(JSON.stringify({ drafts }, null, 2));
  process.exit(0);
}
let state = null;
try {
  state = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (platform) {
  if (command === "close") throw new Error("Platform write windows close with the real run; close is only for external work");
  if (!state || state.runId !== process.env.ONTOMATO_RUN_ID || command === "begin") {
    const response = await fetch(process.env.ONTOMATO_GOVERNANCE_WINDOW_URL, {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", tk: process.env.ONTOMATO_GOVERNANCE_CALLBACK,
        "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID },
      body: JSON.stringify((command === "begin" && args.id) ? { recordId: args.id } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    state = result;
    await mkdir("work", { recursive: true });
    await writeFile(stateFile, JSON.stringify(state));
  }
  if (command === "begin") {
    console.log(JSON.stringify({ id: state.id, sessionId: state.sessionId, runId: state.runId, expiresAt: state.expiresAt }));
    process.exit(0);
  }
}
if (!platform && (command === "begin" || !state)) {
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
if (!actions[command])
  throw new Error("Unknown governance command; see SKILL.md");
const result = await call(
  `/${state.id}/runs/${state.runId}/actions/${actions[command]}`,
  args,
  {
    "X-Ontomato-Session-Id": state.sessionId,
    "X-Ontomato-Run-Id": state.runId,
  },
);
console.log(JSON.stringify(result, null, 2));
