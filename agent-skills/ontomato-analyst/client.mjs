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
async function agentHeaders(cfg,headers) {
  const supplied=await commandHeaders(headers);
  const credential=supplied.tk || supplied["X-API-Key"] ? {} : process.env.ONTOMATO_API_KEY ? {"X-API-Key":process.env.ONTOMATO_API_KEY} : process.env.ONTOMATO_TK || cfg.tk ? {tk:process.env.ONTOMATO_TK || cfg.tk} : {};
  return {"Accept-Language":process.env.ONTOMATO_LANGUAGE ?? "en",...credential,...supplied};
}
async function json(url, headers, body) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.ONTOMATO_EXECUTION_CALLBACK ? { "X-Ontomato-Callback-Credential": process.env.ONTOMATO_EXECUTION_CALLBACK, "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
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
  if (command === "agent") return agentChannelCommand(cfg,args,headers);
  if (command === "retriever-cancel") {
    const run=take(args,"--run");
    if(args.length!==1 || !run) throw new Error("retriever-cancel requires sessionId --run runId from the task snapshot");
    console.log(JSON.stringify(await json(process.env.ONTOMATO_RETRIEVAL_CALLBACK_URL || `${ontology}/ontology/retrievals/${encodeURIComponent(args[0])}/retriever/cancel`,await agentHeaders(cfg,headers),process.env.ONTOMATO_RETRIEVAL_CALLBACK_URL ? {operation:"cancel",retrievalId:args[0],retrievalRunId:run} : {expectedRoundId:run})));
    return;
  }
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
      "Commands: dataset-desc, classes, schema, relationships, dsl-reference, distinct-values, execute-dsl, metrics, execute-metric, knowledge, pending, actions, run, agent, retriever-cancel",
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

  const grants = (await json(`${ontology}/workflow/grants`, headers, {})).data ?? [];
  const inForce = grants.filter((grant) => grant.inForce && roleIds.has(grant.roleId));

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

function flag(args,name) {
  const index=args.indexOf(name);
  if(index<0) return false;
  args.splice(index,1); return true;
}
function reference(value,field) {
  if(!value || value.indexOf("/")<1) throw new Error(`${field} requires provider/id from agent list or a task snapshot`);
  const slash=value.indexOf("/");
  return { providerId:value.slice(0,slash),[field === "agent" ? "agentId" : "sessionId"]:value.slice(slash+1) };
}
function text(value) {
  if(value===undefined) throw new Error("--message is required");
  return value.startsWith("@")?fs.readFileSync(value.slice(1),"utf8"):value;
}
async function downloadAgentFiles(ontology,headers,snapshot) {
  if(!Array.isArray(snapshot.files)) throw new Error("Task snapshot has no file references");
  const directory=path.resolve(process.env.ONTOMATO_OUTPUT_DIR || "outputs");
  fs.mkdirSync(directory,{recursive:true});
  const downloaded=[];
  for(const file of snapshot.files) {
    if(!file.name || path.basename(file.name)!==file.name || [".",".."].includes(file.name)) throw new Error("Invalid delivered file name");
    const prefix=`/platform/agent-channel/tasks/${encodeURIComponent(snapshot.taskId)}/files/`;
    if(typeof file.href!=="string" || !file.href.startsWith(prefix)) throw new Error("Invalid delivered file reference");
    const response=await fetch(ontology+file.href,{headers,redirect:"error"});
    if(!response.ok) throw new Error(`File read failed: HTTP ${response.status}`);
    const destination=path.join(directory,`${file.id}-${file.name}`),temporary=destination+`.${randomUUID()}.download`;
    try { fs.writeFileSync(temporary,Buffer.from(await response.arrayBuffer()));fs.renameSync(temporary,destination); }
    finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    downloaded.push({id:file.id,path:destination});
  }
  return {...snapshot,downloaded};
}
async function followAgentTask(ontology,headers,taskId,files) {
  const response=await fetch(`${ontology}/platform/agent-channel/tasks/${encodeURIComponent(taskId)}/events`,{headers:{...headers,Accept:"text/event-stream"},redirect:"error"});
  if(!response.ok) throw new Error(`Task stream failed: HTTP ${response.status}`);
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer="",data=[];
  try {
    for(;;) {
      const chunk=await reader.read();
      if(chunk.done) throw new Error("Task stream ended before delivery");
      buffer+=decoder.decode(chunk.value,{stream:true});
      let newline;
      while((newline=buffer.indexOf("\n"))>=0) {
        const line=buffer.slice(0,newline).replace(/\r$/u,"");buffer=buffer.slice(newline+1);
        if(line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if(line==="" && data.length) {
          const frame=JSON.parse(data.join("\n"));data=[];
          if(frame.type==="error") throw new Error(frame.error.message);
          if(frame.type!=="task_snapshot") continue;
          const snapshot=frame.task;
          if(!Array.isArray(snapshot.questions)) throw new Error("Task snapshot has no question references");
          const delivered=["completed","failed","cancelled"].includes(snapshot.status) || snapshot.questions.some(question=>!question.answered);
          console.log(JSON.stringify(delivered && files ? await downloadAgentFiles(ontology,headers,snapshot) : snapshot));
          if(delivered) return;
        }
      }
    }
  } finally { await reader.cancel(); }
}
/** The sole transport for native-channel commands in every standalone skill package. */
export async function agentChannelCommand(cfg,argv,headers={}) {
  if(process.env.ONTOMATO_SKILL_SCENARIO === "platform") throw new Error("平台内请用原生 agent 工具（agent），这些命令只用于独立分发包");
  const [op,...args]=argv;
  let command;
  const follow=flag(args,"--follow"),files=flag(args,"--files");
  if(op==="list") command={op,query:args.join(" ") || undefined};
  else if(op==="start") {
    const agent=reference(take(args,"--agent"),"agent"),message=text(take(args,"--message")),title=take(args,"--title"),context=take(args,"--context");
    command={op,agent,message,...(title?{title}:{}),...(context?{context:readJson(context)}:{})};
  } else if(op==="send") {
    const recipient=take(args,"--session"),session=recipient==="parent"?"parent":reference(recipient,"session"),message=text(take(args,"--message"));
    const replyTo=take(args,"--reply-to"),steer=flag(args,"--steer"),needsInput=flag(args,"--needs-input"),defaultAssumption=take(args,"--default-assumption");
    if(needsInput && !defaultAssumption) throw new Error("--needs-input requires --default-assumption");
    command={op,session,message,...(replyTo?{replyTo}:{}),...(steer?{steer:true}:{}),...(needsInput?{needsInput:true,defaultAssumption}:{})};
  } else if(op==="read") {
    const view=take(args,"--view"),cursor=take(args,"--cursor"),limit=take(args,"--limit");
    command={op,taskId:args.shift(),...(view?{view}:{}),...(cursor?{cursor:finiteNumber(cursor,"--cursor")} : {}),...(limit?{limit:finiteNumber(limit,"--limit")} : {}),...(files?{files:true}:{})};
  } else if(op==="cancel") command={op,taskId:args.shift()};
  else throw new Error("agent requires list, start, send, read or cancel");
  if(op!=="list" && args.length) throw new Error(`Unexpected agent arguments: ${args.join(" ")}`);
  if((op==="read" || op==="cancel") && !command.taskId) throw new Error("A task ID is required");
  if((follow || files) && op!=="read") throw new Error("--follow and --files belong to agent read");
  const ontology=(cfg.ontologyUrl || `${cfg.envUrl}/api/data-query`).replace(/\/$/u,"");
  headers=await agentHeaders(cfg,headers);
  if(follow) return followAgentTask(ontology,headers,command.taskId,files);
  const result=await json(`${ontology}/platform/agent-channel/commands`,headers,command);
  console.log(JSON.stringify(op==="read" && files ? await downloadAgentFiles(ontology,headers,result) : result,null,2));
}
