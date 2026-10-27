// Shared external client source. Edition distributions generate this file without changes.
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export function readJson(argument) {
  return JSON.parse(
    argument.startsWith("@")
      ? fs.readFileSync(argument.slice(1), "utf8")
      : argument,
  );
}
async function json(url, headers, body) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok || result.success === false || result.error)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : (result.error?.message ??
            result.message ??
            `HTTP ${response.status}`),
    );
  return result;
}
function take(args, key) {
  const i = args.indexOf(key);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined) throw new Error(`${key} requires a value`);
  args.splice(i, 2);
  return value;
}
export async function analystCommand(cfg, argv, headers = {}) {
  const [command, ...args] = argv;
  const ontology = (cfg.ontologyUrl || `${cfg.envUrl}/api/data-query`).replace(
    /\/$/,
    "",
  );
  if (command === "ask") return ask(cfg, args, headers);
  let endpoint, body;
  if (command === "dataset-desc" || command === "classes")
    endpoint = "/overview";
  else if (
    command === "schema" ||
    command === "relationships" ||
    command === "dsl-reference"
  ) {
    if (!args.length) throw new Error("Class names are required");
    endpoint = command === "dsl-reference" ? "/dsl-reference" : "/schema";
    body = { classNames: args };
  } else if (command === "distinct-values") {
    const like = take(args, "--like") ?? null,
      limit = Number(take(args, "--limit") ?? 100);
    if (args.length !== 2)
      throw new Error("distinct-values requires class and attribute");
    endpoint = "/distinct-values";
    body = { className: args[0], attribute: args[1], like, limit };
  } else if (command === "execute-dsl") {
    endpoint = "/execute-dsl";
    body = { dsl: readJson(args[0]) };
  } else if (command === "metrics" || command === "knowledge") {
    const limit = Number(take(args, "--limit") ?? 10),
      cursor = take(args, "--cursor") ?? null;
    endpoint = command === "metrics" ? "/metrics/search" : "/knowledge/search";
    body = {
      query: args.join(" "),
      limit,
      ...(command === "metrics" ? { cursor } : {}),
    };
  } else if (command === "execute-metric") {
    const revision = take(args, "--revision");
    if (!revision) throw new Error("--revision from metrics is required");
    endpoint = "/metrics/execute";
    body = { id: args[0], revision, parameters: readJson(args[1]) };
  } else
    throw new Error(
      "Commands: dataset-desc, classes, schema, relationships, dsl-reference, distinct-values, execute-dsl, metrics, execute-metric, knowledge, ask",
    );
  const result = await json(
    ontology + "/ontology/query" + endpoint,
    headers,
    body,
  );
  console.log(
    JSON.stringify(
      command === "dataset-desc"
        ? result.description
        : command === "classes"
          ? result.classes
          : command === "relationships"
            ? result.relationships
            : result,
      null,
      2,
    ),
  );
}
async function ask(cfg, args, headers) {
  const base =
    (cfg.workbenchUrl || cfg.envUrl).replace(/\/$/, "") + "/api/retrievals";
  const locale = take(args, "--lang") ?? "en",
    resume = take(args, "--resume"),
    answers = take(args, "--answers"),
    status = take(args, "--status"),
    cancel = take(args, "--cancel");
  const requestId = take(args, "--request-id") ?? randomUUID();
  headers = { ...headers, "Accept-Language": locale };
  let snapshot;
  if (cancel) {
    console.log(
      JSON.stringify(
        await json(`${base}/${encodeURIComponent(cancel)}/cancel`, headers, {}),
        null,
        2,
      ),
    );
    return;
  }
  if (status) {
    console.log(
      JSON.stringify(
        await json(`${base}/${encodeURIComponent(status)}`, headers),
        null,
        2,
      ),
    );
    return;
  }
  if (resume) {
    if (!answers)
      throw new Error(
        "--resume requires --answers @file with explicit question IDs and answers",
      );
    const reply = readJson(answers);
    if (
      !reply ||
      Array.isArray(reply) ||
      !reply.expectedRunId ||
      !Number.isInteger(reply.expectedDecisionRevision) ||
      !Array.isArray(reply.answers)
    )
      throw new Error(
        "Reply file requires expectedRunId, expectedDecisionRevision and answers; copy the revision from ask --status",
      );
    console.log(JSON.stringify({ requestId }));
    snapshot = await json(
      `${base}/${encodeURIComponent(resume)}/answers`,
      { ...headers, "Idempotency-Key": requestId },
      reply,
    );
  } else {
    if (!args.length) throw new Error("ask requires a complete question");
    console.log(JSON.stringify({ requestId }));
    snapshot = await json(
      base,
      { ...headers, "Idempotency-Key": requestId },
      {
        question: args.join(" "),
        interaction: "resumable",
        userQuotes: [],
        previousDatasetIds: [],
      },
    );
  }
  console.log(
    JSON.stringify({
      retrievalId: snapshot.id,
      runtimeSessionId: snapshot.runtimeSessionId,
    }),
  );
  while (snapshot.phase === "running") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await json(`${base}/${snapshot.id}`, headers);
  }
  console.log(JSON.stringify(snapshot, null, 2));
  for (const id of snapshot.datasetArtifactIds)
    console.log(
      JSON.stringify(
        await json(`${base}/${snapshot.id}/datasets/${id}`, headers),
        null,
        2,
      ),
    );
  if (snapshot.result?.status === "failed")
    throw new Error(snapshot.result.error.message);
}
