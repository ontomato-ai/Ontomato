#!/usr/bin/env node
import fs from "node:fs";
import { analystCommand } from "./client.mjs";
import { authenticate } from "./identity.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function die(message) {
  console.error(message);
  process.exit(1);
}

function loadConfig() {
  const text = fs.readFileSync(path.join(DIR, "application.yml"), "utf8");
  const cfg = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) die(`application.yml line is not key: value: ${trimmed}`);
    cfg[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  cfg.envUrl = (process.env.ONTOMATO_WORKBENCH_URL || process.env.ONTOMATO_URL || cfg.envUrl).replace(/\/$/, "");
  cfg.ontologyUrl = (process.env.ONTOMATO_ONTOLOGY_URL || `${cfg.envUrl}/api/data-query`).replace(/\/$/, "");
  return cfg;
}

function readInput(arg) {
  if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8");
  return arg;
}

function takeOption(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  if (argv[i + 1] == null) die(`${name} requires a value`);
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}

function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

function headers(api) {
  return { "Accept-Language": api.lang,
    ...(api.executionContext ? {"X-Ontomato-Execution-Context":api.executionContext} : {}),
    ...(api.apiKey ? { "X-API-Key": api.apiKey } : api.tk ? { tk: api.tk } : {}),
  };
}

function send(api, method, backendPath, body) {
  const h = headers(api);
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${api.ontologyUrl}${backendPath}`, {
    method,
    headers: h,
    body: payload,
    redirect: "error",
  });
}

async function readJson(res) {
  const text = await res.text();
  if (!res.ok) die(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  if (json?.success === false || json?.error) die(json.message ?? json.error?.message ?? json.error);
  return json;
}

async function requestJson(api, method, backendPath, body) {
  return readJson(await send(api, method, backendPath, body));
}

function printData(json) {
  if (typeof json.data === "string") console.log(json.data);
  else console.log(JSON.stringify(json.data, null, 2));
}

async function vectorUpload(api, argv) {
  const file = takeOption(argv, "--file");
  const text = takeOption(argv, "--text");
  if (text == null) die("vector-upload requires --text <content|@file>");
  if (argv.length !== 3)
    die("vector-upload requires <class> <attribute> <objectId>");
  const [className, attrName, objectId] = argv;
  const content = readInput(text);
  const form = new FormData();
  form.append("className", className);
  form.append("attrName", attrName);
  form.append("objectId", objectId);
  form.append("content", content);
  if (file != null) {
    const ext = path.extname(file).replace(/^\./, "").toLowerCase();
    form.append("suffix", ext);
    form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  }
  const res = await fetch(
    `${api.ontologyUrl}/vectorResource/upload`,
    {
      method: "POST",
      headers: headers(api),
      body: form,
    },
  );
  printData(await readJson(res));
}

async function vectorDelete(api, argv) {
  if (argv.length !== 4)
    die("vector-delete requires <class> <attribute> <objectId> <path>");
  const [className, attrName, objectId, path] = argv;
  await requestJson(api, "POST", "/vectorResource/delete", {
    className,
    attrName,
    objectId,
    path,
  });
  console.log("ok");
}

// MetricView (read interface) and Action (write interface) share the same seven endpoints under their own prefix.
async function assetCommand(api, prefix, argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === "generate") {
    const save = takeFlag(rest, "--save");
    if (rest.length === 0) die(`${prefix} generate requires a description`);
    const body = { question: rest.join(" "), persistence: save };
    printData(
      await requestJson(
        api,
        "POST",
        `/${prefix}/generateFromNatureLanguage`,
        body,
      ),
    );
    return;
  }
  if (sub === "execute") {
    const bindingId = prefix === "metricView" ? takeOption(rest, "--binding") : null;
    const files = [];
    if (prefix === "action") {
      for (
        let f = takeOption(rest, "--file");
        f != null;
        f = takeOption(rest, "--file")
      )
        files.push(f);
    }
    if (rest[0] == null) die(`${prefix} execute requires an id`);
    // A MetricView or Action without parameters is called with an empty parameter object.
    const param = rest[1] == null ? {} : JSON.parse(readInput(rest[1]));
    if (prefix === "action") {
      // Action execution is a form: `param` travels as a JSON string and each --file is one `file` part,
      // which a vector parameter refers to by its position ("uploadFile": "0").
      const form = new FormData();
      form.append("id", rest[0]);
      form.append("param", JSON.stringify(param));
      for (const f of files)
        form.append("file", new Blob([fs.readFileSync(f)]), path.basename(f));
      const res = await fetch(`${api.ontologyUrl}/action/execute`, {
        method: "POST",
        headers: headers(api),
        body: form,
      });
      printData(await readJson(res));
      return;
    }
    printData(
      await requestJson(api, "POST", `/${prefix}/execute`, {
        id: rest[0],
        param,
        ...(bindingId ? { bindingId } : {}),
      }),
    );
    return;
  }
  if (sub === "find") {
    if (rest[0] == null) die(`${prefix} find requires a class name`);
    const body = { className: rest[0] };
    if (rest.length > 1) body.question = rest.slice(1).join(" ");
    printData(await requestJson(api, "POST", `/${prefix}/find`, body));
    return;
  }
  if (sub === "get") {
    if (rest[0] == null) die(`${prefix} get requires an id`);
    printData(
      await requestJson(api, "POST", `/${prefix}/queryById`, { id: rest[0] }),
    );
    return;
  }
  if (sub === "save") {
    if (rest[0] == null) die(`${prefix} save requires a JSON definition`);
    printData(await requestJson(api, "POST", `/${prefix}/save`, JSON.parse(readInput(rest[0]))));
    return;
  }
  if (sub === "publish") {
    if (rest.length !== 1) die(`${prefix} publish requires an id`);
    const definition = (await requestJson(api, "POST", `/${prefix}/queryById`, { id: rest[0] })).data;
    definition.status = "PUBLISHED";
    const saved = (await requestJson(api, "POST", `/${prefix}/save`, definition)).data;
    printData(await requestJson(api, "POST", `/${prefix}/queryById`, { id: saved.id }));
    return;
  }
  if (sub === "delete") {
    if (rest[0] == null) die(`${prefix} delete requires an id`);
    await requestJson(api, "POST", `/${prefix}/delete`, { id: rest[0] });
    console.log("ok");
    return;
  }
  usage();
}

async function workbench(api, method, endpoint, body) {
  return readJson(await fetch(`${api.envUrl}/api${endpoint}`, {
    method, headers: { ...headers(api), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "error",
  }));
}
const print = value => console.log(JSON.stringify(value, null, 2));
async function sdkCommand(api, args) {
  const current = await workbench(api, "GET", "/apps-sdk/current");
  if (args[0] === "current" && args.length === 1) return print(current);
  if (args[0] !== "read" || args.length !== 2) die("sdk requires current or read <relative path>");
  // The CLI reaches the deployment or internal Node URL; only HTML uses the returned public paths.
  const response = await fetch(`${api.envUrl}/apps-sdk/${current.version}/${args[1]}`, { headers: headers(api), redirect: "error" });
  const text = await response.text();
  if (!response.ok) die(`${response.status}\n${text}`);
  console.log(text);
}
async function functionCommand(api, [command, ...args]) {
  if (command === "list") return printData(await requestJson(api, "POST", "/function/queryList", args[0] ? JSON.parse(readInput(args[0])) : {}));
  if (args.length !== 1) die("function get/save/delete requires one id or definition");
  if (command === "get") return printData(await requestJson(api, "POST", "/function/queryById", { id: args[0] }));
  if (command === "save") return printData(await requestJson(api, "POST", "/function/save", JSON.parse(readInput(args[0]))));
  if (command === "delete") return print(await requestJson(api, "POST", "/function/delete", { id: args[0] }));
  usage();
}
function sourceFiles(directory) {
  const files = [];
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files.push({ path: name, encoding: "base64", content: fs.readFileSync(path.join(directory, name)).toString("base64") });
      else throw new Error(`Source must contain regular files: ${name}`);
    }
  }
  visit("");
  return files;
}
async function workspaceCommand(api, [command, ...args]) {
  const query = value => new URLSearchParams(value ? JSON.parse(readInput(value)) : {}).toString();
  if (command === "list") return print(await workbench(api, "GET", `/workspaces?${query(args[0])}`));
  if (command === "create") {
    if (args.length !== 1) die("workspace create requires a name");
    return print(await workbench(api, "POST", "/workspaces", { name: args[0] }));
  }
  if (!args[0]) die("workspace requires an id");
  const base = `/workspaces/${encodeURIComponent(args[0])}`;
  if (["get", "tree", "commits", "sessions", "releases"].includes(command))
    return print(await workbench(api, "GET", `${base}${command === "get" ? "" : `/${command}`}?${query(args[1])}`));
  if (command === "content") {
    if (!args[1]) die("workspace content requires a path");
    const params = new URLSearchParams({ path: args[1], ...(args[2] ? { commit: args[2] } : {}) });
    const response = await fetch(`${api.envUrl}/api${base}/files/content?${params}`, { headers: headers(api), redirect: "error" });
    if (!response.ok) die(`${response.status}\n${await response.text()}`);
    process.stdout.write(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (command === "diff") {
    if (args.length !== 3) die("workspace diff requires id, from and to");
    return print(await workbench(api, "GET", `${base}/diff?${new URLSearchParams({ from: args[1], to: args[2] })}`));
  }
  if (command === "delete") {
    const response = await fetch(`${api.envUrl}/api${base}`, { method: "DELETE", headers: headers(api), redirect: "error" });
    if (!response.ok) die(`${response.status}\n${await response.text()}`);
    return;
  }
  if (command === "import") {
    const message = takeOption(args, "--message");
    if (args.length !== 2 || !message) die("workspace import requires id, directory and --message");
    return print(await workbench(api, "POST", `${base}/import`, { files: sourceFiles(path.resolve(args[1])), message }));
  }
  if (command === "restore" || command === "rename") {
    if (args.length !== 2) die(`workspace ${command} requires id and ${command === "restore" ? "commit" : "name"}`);
    return print(await workbench(api, command === "restore" ? "POST" : "PATCH", `${base}${command === "restore" ? "/restore" : ""}`,
      command === "restore" ? { commit: args[1] } : { name: args[1] }));
  }
  if (command === "publish" || command === "rollback") {
    if (args.length !== 3) die(`workspace ${command} requires id, ${command === "publish" ? "commit" : "releaseId"} and declaration`);
    return print(await workbench(api, "POST", `${base}/${command}`, {
      [command === "publish" ? "commit" : "releaseId"]: args[1], declaration: JSON.parse(readInput(args[2])),
    }));
  }
  usage();
}

function usage() {
  die(`usage: ontomato.mjs [--lang <tag>] <command>
  test start|status|stop [--workspace <id>] [--sample test-data/sample.json]
  sdk current
  sdk read <relative path, e.g. docs/index.md>
  function list [<filter json|@file>]
  function get <id>
  function save <definition json|@file>
  function delete <id>
  workspace list [<page json|@file>]
  workspace create <name>
  workspace get|tree|commits|sessions|releases <id> [<query json|@file>]
  workspace content <id> <path> [<commit>]
  workspace diff <id> <from> <to|working>
  workspace rename <id> <name>
  workspace delete <id>
  workspace import <id> <directory> --message <text>
  workspace restore <id> <commit>
  workspace publish <id> <commit> <declaration json|@file>
  workspace rollback <id> <releaseId> <declaration json|@file>
  dataset-desc
  classes
  schema <class> [<class> ...]
  relationships <class> [<class> ...]
  vector-upload <class> <attribute> <objectId> [--file <path>] --text <text|@file>
  vector-delete <class> <attribute> <objectId> <path>
  distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
  execute-dsl <json|@file>
  metric-view generate [--save] <description>
  metric-view execute <id> [<param json|@file>]
  metric-view find <class> [<question>]
  metric-view get <id>
  metric-view save <json|@file>
  metric-view publish <id>
  metric-view delete <id>
  action generate|execute|find|get|save|publish|delete ...   (same arguments as metric-view)
  action re-explain [--missing] [--id <id> ...]
  action execute <id> [<param json|@file>] [--file <path> ...]`);
}

async function bindTestTarget(api,workspaceId) {
  if(!workspaceId) die("BUILD_TEST_WORKSPACE_REQUIRED: pass --workspace <id>");
  const context=await workbench(api,"GET",`/workspaces/${encodeURIComponent(workspaceId)}/build-tests`);
  api.executionContext=JSON.stringify({kind:"build-test",contextId:context?.contextId ?? null});
}

async function main() {
  const argv = process.argv.slice(2);
  const lang = takeOption(argv, "--lang") ?? "en";
  const workspaceId=takeOption(argv,"--workspace") ?? process.env.ONTOMATO_WORKSPACE_ID;
  const cmd = argv[0];
  const cfg = loadConfig();
  if (!cfg.envUrl) die("Set ONTOMATO_URL or envUrl in application.yml");
  const identity = process.env.ONTOMATO_API_KEY ? { apiKey: process.env.ONTOMATO_API_KEY }
    : process.env.ONTOMATO_TK ? { tk: process.env.ONTOMATO_TK } : await authenticate(cfg, lang);
  const api = { ...cfg, lang, ...identity };
  if(cmd==="test") {
    if(!workspaceId) die("BUILD_TEST_WORKSPACE_REQUIRED: pass --workspace <id>");
    const sub=argv[1], samplePath=takeOption(argv,"--sample") ?? "test-data/sample.json";
    if(!["start","status","stop"].includes(sub)) die("test start|status|stop [--workspace <id>] [--sample test-data/sample.json]");
    const result=await workbench(api,sub==="start"?"POST":sub==="stop"?"DELETE":"GET",`/workspaces/${encodeURIComponent(workspaceId)}/build-tests`,sub==="start"?{samplePath}:undefined);
    return print(result===null && sub!=="start" ? {workspaceId,contextId:null,status:"NONE"} : result);
  }
  if(["vector-upload","vector-delete"].includes(cmd) || ["action","metric-view"].includes(cmd) && argv[1]==="execute") {
    await bindTestTarget(api,workspaceId);
  }
  if (cmd === "sdk") return sdkCommand(api, argv.slice(1));
  if (cmd === "workspace") return workspaceCommand(api, argv.slice(1));
  if (cmd === "function") return functionCommand(api, argv.slice(1));
  if (cmd === "dataset-desc") {
    printData(await requestJson(api, "GET", "/admin/getDatasetDesc"));
    return;
  }
  if (cmd === "classes") {
    printData(await requestJson(api, "GET", "/admin/getAllClassNames"));
    return;
  }
  if (cmd === "schema" || cmd === "relationships") {
    const classNames = argv.slice(1);
    if (classNames.length === 0) die(`${cmd} requires at least one class name`);
    const backendPath =
      cmd === "schema"
        ? "/admin/getSchemaByClassName"
        : "/admin/getRelationshipByClassNames";
    printData(await requestJson(api, "POST", backendPath, { classNames }));
    return;
  }
  if (cmd === "vector-upload") {
    await vectorUpload(api, argv.slice(1));
    return;
  }
  if (cmd === "vector-delete") {
    await vectorDelete(api, argv.slice(1));
    return;
  }
  if (cmd === "distinct-values" || cmd === "execute-dsl")
    return analystCommand(api,argv,async()=>{await bindTestTarget(api,workspaceId);return headers(api);});
  if (cmd === "action" && argv[1] === "re-explain") {
    const rest = argv.slice(2);
    const missing = takeFlag(rest, "--missing");
    const ids = [];
    for (
      let v = takeOption(rest, "--id");
      v != null;
      v = takeOption(rest, "--id")
    )
      ids.push(v);
    printData(
      await requestJson(api, "POST", "/action/re-explain", {
        ids,
        missingOnly: missing,
      }),
    );
    return;
  }
  if (cmd === "metric-view") {
    await assetCommand(api, "metricView", argv.slice(1));
    return;
  }
  if (cmd === "action") {
    await assetCommand(api, "action", argv.slice(1));
    return;
  }
  if (cmd === "ask") {
    die("BUILD_TEST_UNSUPPORTED: ask is not a build-test execution; use MetricView or execute-dsl");
  }
  if(!cmd) return usage();
  die(`BUILD_TEST_UNSUPPORTED: command not supported: ${cmd}`);
}

main().catch(error => { console.error(error.message);process.exitCode=1; });
