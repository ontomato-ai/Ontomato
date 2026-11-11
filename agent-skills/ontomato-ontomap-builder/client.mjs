// Shared external client source. Edition distributions generate this file without changes.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function readJson(argument) {
  return JSON.parse(
    argument.startsWith("@")
      ? fs.readFileSync(argument.slice(1), "utf8")
      : argument,
  );
}
function commandHeaders(headers) {
  return typeof headers === "function" ? headers() : headers;
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
function finiteNumber(value, field) {
  if (value.trim() === "" || !Number.isFinite(Number(value)))
    throw new Error(`${field}: expected a finite number; supply a numeric value such as 10`);
  return Number(value);
}

export async function analystCommand(cfg, argv, headers = {}) {
  const [command, ...args] = argv;
  const ontology = (cfg.ontologyUrl || `${cfg.envUrl}/api/data-query`).replace(
    /\/$/,
    "",
  );
  if (command === "ask") return ask(cfg, args, await commandHeaders(headers));
  if (command === "run") return runAction(ontology, args, headers);
  if (command === "pending") return pending(ontology, args, headers);
  if (command === "actions") return listActions(ontology, await commandHeaders(headers));
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
      limit = finiteNumber(take(args, "--limit") ?? "100", "--limit");
    if (args.length !== 2)
      throw new Error("distinct-values requires class and attribute");
    endpoint = "/distinct-values";
    body = { className: args[0], attribute: args[1], like, limit };
  } else if (command === "execute-dsl") {
    endpoint = "/execute-dsl";
    body = { dsl: readJson(args[0]) };
  } else if (command === "metrics" || command === "knowledge") {
    const limit = finiteNumber(take(args, "--limit") ?? "10", "--limit"),
      cursor = take(args, "--cursor") ?? null;
    endpoint = command === "metrics" ? "/metrics/search" : "/knowledge/search";
    body = {
      query: args.join(" "),
      limit,
      ...(command === "metrics" ? { cursor } : {}),
    };
  } else if (command === "execute-metric") {
    const revision = take(args, "--revision");
    const bindingId = take(args, "--binding");
    if (!revision) throw new Error("--revision from metrics is required");
    endpoint = "/metrics/execute";
    body = { id: args[0], revision, parameters: args[1] ? readJson(args[1]) : {}, ...(bindingId ? { bindingId } : {}) };
  } else
    throw new Error(
      "Commands: dataset-desc, classes, schema, relationships, dsl-reference, distinct-values, execute-dsl, metrics, execute-metric, knowledge, pending, actions, run, ask",
    );
  // Resolve dynamic execution credentials only after input validation, once per command.
  headers = await commandHeaders(headers);
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
/**
 * Turn a platform refusal into the reason a person can act on.
 *
 * The executor checks three layers in order, and each has its own message. Left untranslated they
 * all read as "failed", which sends the caller to the wrong place: a missing grant is an admin
 * question, "not your turn" is a business-state question, and a data-permission refusal is neither.
 */
function explainActionError(message) {
  const text = String(message ?? "");
  if (/No role grants this action/i.test(text))
    return "No current role grant allows this action. Check the direct grant or the active workflow revision.";
  if (/preconditions are not met/i.test(text))
    return "Business precondition failed: " + text.replace(/^.*?preconditions are not met:\s*/i, "");
  if (text.includes("/action/execute") && /permission|无此权限/i.test(text))
    return "This action has no capability grants; it requires the existing /action/execute permission.";
  if (/Action\.targetOutsideScope|not readable or is outside the granted scope/i.test(text))
    return "You cannot read this target or it is outside the scope granted to your role.";
  if (/class is outside the authorized scope|field is outside the authorized scope/i.test(text))
    return "Your role lacks data permission for this object class; the platform refused the read this step needs.";
  if (/not published|Action\.notPublished/i.test(text)) return "This action is not published.";
  if (/frozen|publishedIsFrozen/i.test(text))
    return "A published action is frozen. Create a new action instead of editing this one.";
  return text;
}

/** Run one action as the authenticated subject; the server decides whether that is allowed. */
async function runAction(ontology, args, headers) {
  const actionId = args[0];
  if (!actionId) throw new Error("run requires an action id");
  const parameters = args[1] ? readJson(args[1]) : {};
  headers = await commandHeaders(headers);
  const response = await fetch(`${ontology}/action/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      ...headers,
    },
    body: new URLSearchParams({ id: actionId, param: JSON.stringify(parameters) }),
    redirect: "error",
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Action execution returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  const error = result?.data?.error || (!response.ok || result.success !== true
    ? (result.message || result.msg || result.error?.message || `Action request refused (HTTP ${response.status})`) : null);
  if (error) {
    const explained = explainActionError(error);
    console.log(JSON.stringify({ ok: false, actionId, error: explained, raw: String(error) }, null, 2));
    throw new Error(explained);
  }
  const raw = result?.data?.result ?? null;
  let payload = raw;
  try {
    payload = raw === null ? null : JSON.parse(raw);
  } catch {
    // A program may print plain text; keep it as written.
  }
  console.log(
    JSON.stringify(
      { ok: true, actionId, result: payload, spendTimeMs: result?.data?.spendTime ?? null },
      null,
      2,
    ),
  );
}

/** Execute published pending metrics; roles, steps and row scope are evaluated by the server. */
async function pending(ontology, args, headers) {
  const limit = Number(take(args, "--limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  const flow = take(args, "--flow");
  headers = await commandHeaders(headers);
  const metrics = [];
  let cursor;
  do {
    const page = await json(`${ontology}/ontology/query/metrics/search`, headers, {
      workflowPurpose: "pending", limit: 100, cursor,
    });
    metrics.push(...page.items.filter(item => item.workflowSource?.purpose === "pending" &&
      (!flow || item.workflowSource.workflowId === flow || item.name.includes(flow))));
    cursor = page.nextCursor;
  } while (cursor);
  if (!metrics.length) throw new Error("No published pending-items query is available" +
    (flow ? ` for ${flow}` : "") + ". Check the workflow's active revision and pending query.");
  let remaining = limit;
  const items = [];
  for (const metric of metrics) {
    const output = await json(`${ontology}/ontology/query/metrics/execute`, headers, {
      id: metric.id, revision: metric.revision,
    });
    const rows = output.rows.slice(0, remaining);
    items.push({ workflowId: metric.workflowSource.workflowId, metric: metric.name, revision: metric.revision, rows });
    remaining -= rows.length;
    if (!remaining) break;
  }
  const answer = items.length === 1 ? items[0] : { items };
  console.log(JSON.stringify({ source: "metric", count: limit - remaining, ...answer }, null, 2));
}

/**
 * What this subject may actually run, and why.
 *
 * Computed as the intersection of three things the platform keeps separately: the roles in effect
 * for the caller, the grants in force, and the actions that exist. A grant is in force only while its
 * workflow is active at exactly that revision, so a row left by an earlier revision is not reported —
 * listing it would promise authority the executor would refuse.
 */
async function listActions(ontology, headers) {
  const me = (await json(`${ontology}/user/getCur`, headers)).data;
  if (!me?.id) throw new Error("The current credential has no user id.");

  const subjects = (await json(`${ontology}/workflow/subjects`, headers, {})).data ?? [];
  const mine = subjects.find((subject) => subject.id === me.id);
  const roleIds = new Set(mine?.roleIds ?? []);
  if (!roleIds.size) {
    console.log(JSON.stringify({ count: 0, actions: [], reason: "This subject holds no role in this domain." }, null, 2));
    return;
  }

  const workflows = (await json(`${ontology}/workflow/query`, headers, {})).data ?? [];
  const active = new Map(
    workflows.filter((workflow) => workflow.status === "ACTIVE").map((workflow) => [workflow.id, String(workflow.version ?? "")]),
  );
  const grants = (await json(`${ontology}/workflow/grants`, headers, {})).data ?? [];
  const inForce = grants
    .filter((grant) => roleIds.has(grant.roleId))
    .filter((grant) => {
      if (!grant.workflowId) return true; // granted by hand: it stands on its own
      return active.has(grant.workflowId) && active.get(grant.workflowId) === String(grant.activatedByWorkflowVersion ?? "");
    });

  const actions = (await json(`${ontology}/action/queryList`, headers, {})).data ?? [];
  const known = new Map(actions.map((action) => [action.id, action]));
  const rows = inForce
    .map((grant) => {
      const action = known.get(grant.capabilityId);
      return {
        actionId: grant.capabilityId,
        name: action?.name ?? grant.capabilityId,
        status: action?.status ?? null,
        role: grant.roleCode ?? grant.roleId,
        source: grant.workflowId ? "process" : "direct",
        workflowId: grant.workflowId ?? null,
        workflowVersion: grant.activatedByWorkflowVersion ?? null,
      };
    })
    // A grant for an unpublished or retired action is not something the caller can run.
    .filter((row) => row.status === null || row.status === "PUBLISHED");

  console.log(JSON.stringify({ count: rows.length, actions: rows }, null, 2));
}

async function ask(cfg, args, headers) {
  const base = (cfg.ontologyUrl || `${cfg.envUrl}/api/data-query`).replace(/\/$/, "") + "/ontology/retrievals";
  const locale = take(args, "--lang") ?? process.env.ONTOMATO_LANGUAGE ?? "en",
    resume = take(args, "--resume"), answers = take(args, "--answers"), status = take(args, "--status"),
    cancel = take(args, "--cancel"), cancelRetriever = take(args, "--cancel-retriever"), wait = take(args, "--wait");
  const requestId = take(args, "--request-id") ?? randomUUID();
  let cursor = Number(take(args, "--after") ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("--after must be a nonnegative result cursor");
  headers = { ...headers, "Accept-Language": locale,
    ...(process.env.ONTOMATO_RETRIEVAL_CALLER_ID ? { "X-Ontomato-Retrieval-Caller-Id": process.env.ONTOMATO_RETRIEVAL_CALLER_ID } : {}),
  };
  const poll = (id) => json(`${base}/${encodeURIComponent(id)}/results?after=${cursor}`, headers);
  if (cancel) {
    console.log(JSON.stringify(await json(`${base}/${encodeURIComponent(cancel)}/cancel`, headers, {}), null, 2)); return;
  }
  if (cancelRetriever) {
    const current = await poll(cancelRetriever);
    const result = await json(`${base}/${encodeURIComponent(cancelRetriever)}/retriever/cancel`, headers, { expectedRoundId: current.roundId });
    console.log(JSON.stringify({ retrievalId: cancelRetriever, pending: result.pending, cursor: current.cursor }, null, 2)); return;
  }
  if (status) { console.log(JSON.stringify(await poll(status), null, 2)); return; }
  let snapshot;
  if (wait) snapshot = await poll(wait);
  else if (resume) {
    if (!answers) throw new Error("--resume requires --answers @file");
    const reply = readJson(answers);
    if (!reply || !reply.expectedRunId || !Number.isInteger(reply.expectedDecisionRevision) || typeof reply.message !== "string" || !reply.message.trim())
      throw new Error("Reply requires expectedRunId, expectedDecisionRevision and message from ask --status");
    console.log(JSON.stringify({ requestId }));
    snapshot = await json(`${base}/${encodeURIComponent(resume)}/answers`, { ...headers, "Idempotency-Key": requestId }, reply);
  } else {
    if (!args.length) throw new Error("ask requires a complete question");
    console.log(JSON.stringify({ requestId }));
    snapshot = await json(base, { ...headers, "Idempotency-Key": requestId }, {
      question: args.join(" "), interaction: "resumable", userQuotes: [], previousDatasetIds: [],
    });
  }
  console.log(JSON.stringify({ retrievalId: snapshot.id, runtimeSessionId: snapshot.runtimeSessionId }));
  // Empty or failed binding searches produce no delivery. Keep waiting for the retriever.
  while (!snapshot.deliveries.length && (snapshot.pending.retriever || snapshot.pending.bindings)) {
    cursor = snapshot.cursor;
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await poll(snapshot.id);
  }
  const files = [];
  for (const delivery of snapshot.deliveries) {
    for (const dataset of delivery.data.datasets) {
      const id = dataset.id;
      if (![snapshot.id, id].every(value => /^[0-9a-f-]{36}$/i.test(value))) throw new Error("Invalid dataset identity");
      const response = await fetch(`${base}/${snapshot.id}/datasets/${id}/content`, { headers, redirect: "error" });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const root = path.resolve(process.env.ONTOMATO_OUTPUT_DIR ?? "outputs"),
        output = path.join(root, "retrievals", snapshot.id, `${id}.dataset.json`);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const scratch = path.join(path.dirname(root), "work"); fs.mkdirSync(scratch, { recursive: true });
      const temporary = path.join(scratch, `.retrieval-${id}-${randomUUID()}.download`);
      fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer())); fs.renameSync(temporary, output);
      files.push({ path: path.relative(process.cwd(), output).split(path.sep).join("/"), datasetId: id,
        source: delivery.source, rowCount: dataset.rowCount, ...(dataset.binding ? { binding: dataset.binding } : {}) });
    }
  }
  const answer = snapshot.deliveries.map(d => d.data.answer).filter(Boolean).join("\n\n");
  console.log(JSON.stringify({ retrievalId: snapshot.id, roundId: snapshot.roundId, runtimeSessionId: snapshot.runtimeSessionId,
    runtimeRunId: snapshot.runtimeRunId, decisionRevision: snapshot.decisionRevision, run: snapshot.run,
    pending: snapshot.pending, cursor: snapshot.cursor, answer, files, deliveries: snapshot.deliveries }, null, 2));
  const failed = snapshot.deliveries.find(d => d.source === "retriever" && (d.data.error || ["error", "aborted"].includes(d.data.run?.stopReason)));
  if (failed && !files.length && !snapshot.pending.retriever && !snapshot.pending.bindings)
    throw new Error(failed.data.error ?? failed.data.run.errorMessage ?? "Retrieval stopped");
}
