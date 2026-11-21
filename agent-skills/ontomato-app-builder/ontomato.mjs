#!/usr/bin/env node
import fs from "node:fs";
import { analystCommand } from "./client.mjs";
import { authenticate } from "./identity.mjs";
import { domainApplicationIconChoices, panelRegistrationClient } from "./panel-registration.mjs";
import { currentSdkClient, installedPanelSdk, readLocalComponentPackages } from "./current-sdk.mjs";
import { checkBuiltinPanelSource, checkPanelWorkspace, registerPanelWorkspace } from "./panel-check.mjs";
import { managementPanel, writeManagementPanel } from "./panel-scaffold.mjs";
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
  if (!res.ok) throw new Error(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  if (json?.success === false || json?.error) throw new Error(json.message ?? json.error?.message ?? json.error);
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

function isPlatformAuthoring() {
  return process.env.ONTOMATO_SKILL_SCENARIO === "platform" ||
    Boolean(process.env.ONTOMATO_RUN_ID || process.env.ONTOMATO_AUTHORING_URL || process.env.ONTOMATO_EXECUTION_CALLBACK);
}

async function withAuthoring(api, kind, workspaceId, work) {
  if (isPlatformAuthoring()) {
    const { ONTOMATO_AUTHORING_URL: base, ONTOMATO_EXECUTION_CALLBACK: callback, ONTOMATO_RUN_ID: runId } = process.env;
    if (!base || !callback || !runId) throw new Error("The current platform run must supply its authoring callback");
    return work(async (operation, input) => readJson(await fetch(`${base.replace(/\/$/, "")}/${kind}/${operation}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        "Accept-Language": api.lang,
        "Content-Type": "application/json",
        "X-Ontomato-Callback-Credential": callback,
        "X-Ontomato-Run-Id": runId,
      },
      body: input === undefined ? undefined : JSON.stringify(input),
      redirect: "error",
    })));
  }

  if (workspaceId || process.env.ONTOMATO_EXECUTION_KIND === "build-test") {
    await bindTestTarget(api, workspaceId);
  }
  const root = "/ontology/ai/generation";
  const { runId } = await requestJson(api, "POST", `${root}/gates`, { kind: kind === "action" ? "action" : "metric" });
  try {
    return await work((operation, input = {}) =>
      requestJson(api, "POST", `${root}/${runId}/authoring/${kind}/${operation}`, input));
  } finally {
    await requestJson({ ...api, executionContext: undefined }, "POST", `${root}/${runId}/close`, {});
  }
}

async function runAuthorTest(author, input) {
  const { result } = await author("test", input);
  if (result.error) throw new Error(result.error);
}

async function generateAsset(api, prefix, args, workspaceId) {
  const kind = prefix === "action" ? "action" : "metric-view";
  const save = takeFlag(args, "--save");
  const sample = kind === "action" ? takeOption(args, "--sample") : null;
  if (args.length !== 1 || (kind === "action" && sample === null)) {
    const sampleOption = kind === "action" ? " --sample <JSON or @file>" : "";
    die(`Usage: ${kind} generate [--save]${sampleOption} <definition JSON or @file>`);
  }
  const definition = JSON.parse(readInput(args[0]));
  const fixtures = kind === "action" ? JSON.parse(readInput(sample)) : undefined;
  const accepted = await withAuthoring(api, kind, workspaceId, async author => {
    const definitionFunction = definition.function;
    if (kind === "action") {
      const input = { code: definitionFunction.code, parameterDefs: definitionFunction.parameters ?? [] };
      await author("prepare", fixtures);
      await author("reset", {});
      await runAuthorTest(author, input);
      const { explanationRef } = await author("explain-draft", input);
      definition.explanationRef = explanationRef;
    } else {
      const { queryPackage } = definitionFunction;
      const columnLabels = definitionFunction.returnDef?.columnLabels;
      await runAuthorTest(author, { queryPackage, columnLabels });
      for (const binding of definition.bindings ?? []) {
        const bound = structuredClone(queryPackage);
        for (const parameter of bound.manifest.parameterDefs) {
          parameter.value = binding.parameters[parameter.name];
        }
        await runAuthorTest(author, { queryPackage: bound, columnLabels });
      }
    }
    return (await author("adopt", { definition })).definition;
  });
  if (save) {
    printData(await requestJson({ ...api, executionContext: undefined }, "POST", `/${prefix}/save`, accepted));
  } else {
    print(accepted);
  }
}

async function assetCommand(api, prefix, argv, workspaceId) {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === "context") {
    if (rest.length) die(`Usage: ${prefix === "action" ? "action" : "metric-view"} context`);
    const kind = prefix === "action" ? "action" : "metric-view";
    return print(await withAuthoring(api, kind, workspaceId, author => author("context")));
  }
  if (sub === "generate") return generateAsset(api, prefix, rest, workspaceId);
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

async function workbench(api, method, endpoint, body, decode = readJson) {
  return decode(await fetch(`${api.envUrl}/api${endpoint}`, {
    method, headers: { ...headers(api), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "error",
  }));
}
const print = value => console.log(JSON.stringify(value, null, 2));
async function sdkCommand(api, args) {
  const sdk = currentSdkClient({ workbenchUrl: api.envUrl, headers: headers(api) });
  if (args[0] === "current" && args.length === 1) return print(await sdk.current());
  if (args[0] === "icons" && args.length === 1) {
    return print(domainApplicationIconChoices(await sdk.check(await sdk.current())));
  }
  if (args[0] === "package" && args.length === 2) {
    const checks = await sdk.check(await sdk.current());
    return print(await sdk.componentPackage(args[1], checks));
  }
  if (args[0] !== "read" || args.length !== 2) die("sdk requires current, icons, package <name>, or read <relative path>");
  console.log(await (await sdk.read(await sdk.current(), args[1])).text());
}

async function readPlatformTypeTable(api, checks) {
  const table = checks.platformTypeTableResponseSchema.parse(await workbench(api, "GET", "/app-builder/type-table"));
  for (const { id, reason, objectType } of table.unavailableActions ?? []) {
    const record = objectType === undefined ? id : `${id} (${objectType})`;
    console.error(`Action ${record} is unavailable. ${reason}`);
  }
  if (table.customerTypesUnavailable) {
    console.error(`Customer type catalogue is unavailable. ${table.customerTypesUnavailable.reason}`);
  }
  return table;
}

async function checkCurrentPanel(api, directory, materialPath) {
  const sdk = currentSdkClient({ workbenchUrl: api.envUrl, headers: headers(api) });
  const release = await sdk.current();
  const [checks, catalogue] = await Promise.all([sdk.check(release), sdk.components(release)]);
  const typeTable = await readPlatformTypeTable(api, checks);
  const lookup = (kind, id) => workbench(api, "GET", `/product-${kind}s/${encodeURIComponent(id)}`, undefined,
    async response => {
      if (response.status === 404) return null;
      try {
        return (await readJson(response))[kind];
      } catch (error) {
        throw new Error(`${kind} ${id}: ${error.message}`, { cause: error });
      }
    });
  const registration = panelRegistrationClient({ workbenchUrl: api.envUrl, headers: headers(api) });
  const findChartSource = source => registration.findChartSource(source, checks);
  return print(await checkPanelWorkspace(directory, {
    checks, catalogue, version: release.version, digest: release.digest, typeTable, lookup, findChartSource, materialPath,
    loadPackage: name => sdk.componentPackage(name, checks),
  }));
}

async function panelCommand(api, workspaceId, [command, ...args]) {
  if (command === "type") {
    const readName = takeOption(args, "--read");
    const all = takeFlag(args, "--all");
    if (all ? args.length || readName !== null : args.length !== 1) {
      die("panel type <type-id> [--read <name>] or panel type --all");
    }
    const [id] = args;
    const sdk = currentSdkClient({ workbenchUrl: api.envUrl, headers: headers(api) });
    const checks = await sdk.check(await sdk.current());
    const typeTable = await readPlatformTypeTable(api, checks);
    if (all) return print(typeTable);
    const { objectTypes, resultSchemas } = typeTable;
    if (!Object.hasOwn(objectTypes, id)) die(`Type ${id} is not listed in the author's type table`);
    const { reads = {}, ...metadata } = objectTypes[id];
    const describe = read => ({ ...read, resultSchema: resultSchemas[read.result] });
    if (readName !== null) {
      if (!Object.hasOwn(reads, readName)) die(`Type ${id} has no read '${readName}'`);
      return print({ id, read: readName, ...describe(reads[readName]) });
    }
    return print({
      id, reads: Object.fromEntries(Object.entries(reads).map(([name, read]) => [name, describe(read)])), ...metadata,
    });
  }
  if (command === "scaffold") {
    const id = takeOption(args, "--id") ?? undefined;
    const operations = [];
    const batches = [];
    for (const [flag, values] of [["--operation", operations], ["--batch", batches]]) {
      let operation = takeOption(args, flag);
      while (operation !== null) {
        values.push(operation);
        operation = takeOption(args, flag);
      }
    }
    if (args.length !== 2) die("panel scaffold <type> <new directory> [--id <application id>] [--operation <id>] [--batch <id>]");
    const [type, directory] = args;
    const sdk = currentSdkClient({ workbenchUrl: api.envUrl, headers: headers(api) });
    const checks = await sdk.check(await sdk.current());
    const typeTable = await readPlatformTypeTable(api, checks);
    const panel = managementPanel(type, checks, typeTable, { id, operations, batches });
    await writeManagementPanel(directory, panel);
    return print({ directory, entry: panel.material.applications[0].input.panelUses[0].path });
  }
  if (command === "applications" && args.length === 0) {
    return printData(await requestJson(api, "GET", "/platform/applications?purpose=navigation"));
  }
  if (command === "preview" && args.length === 1) {
    if (!workspaceId) die("Panel preview requires --workspace <id>");
    const query = new URLSearchParams({ ref: args[0] });
    return print(await workbench(api, "GET", `/workspaces/${encodeURIComponent(workspaceId)}/panel-candidate?${query}`));
  }
  if (command === "register") {
    const materialPath = takeOption(args, "--material") ?? undefined;
    if (args.length !== 1) die("panel register requires one workspace directory or registration object");
    const connection = { workbenchUrl: api.envUrl, ontologyUrl: api.ontologyUrl, headers: headers(api) };
    const client = panelRegistrationClient(connection);
    const report = (kind, id, details) => {
      console.log(`${kind} ${id}`);
      if (details?.recoveredUpdate) console.log(`Updated projection ${id}`);
    };
    const [source] = args;
    if (source.startsWith("@") || source.trimStart().startsWith("{")) {
      if (materialPath !== undefined) die("--material applies to workspace registration");
      return client.register(JSON.parse(readInput(source)), report);
    }
    const sdk = currentSdkClient(connection);
    const release = await sdk.current();
    const checks = await sdk.check(release);
    return registerPanelWorkspace(source, materialPath, checks, client, report, async () => {
      const [catalogue, typeTable] = await Promise.all([sdk.components(release), readPlatformTypeTable(api, checks)]);
      return { catalogue, typeTable };
    }, name => sdk.componentPackage(name, checks));
  }
  if (command === "delete") {
    const [kind, id] = args;
    if (args.length !== 2 || !["application", "panel"].includes(kind)) {
      die("panel delete application|panel <id>");
    }
    const client = panelRegistrationClient({ workbenchUrl: api.envUrl, ontologyUrl: api.ontologyUrl, headers: headers(api) });
    const result = kind === "application" ? await client.deleteApplication(id) : await client.deletePanel(id);
    return print({ kind, id, ...result });
  }
  if (command === "uses" && args.length === 1) {
    return printData(await requestJson(api, "GET", `/platform/applications/${encodeURIComponent(args[0])}/panel-uses`));
  }
  if ((command === "projection" || command === "get") && args.length === 1) {
    const collection = command === "projection" ? "projections" : "panels";
    return print(await workbench(api, "GET", `/product-${collection}/${encodeURIComponent(args[0])}`));
  }
  die("panel requires applications, type <id> [--read <name>], delete application|panel <id>, projection <id>, get <id>, uses <applicationId>, preview <working|commit> [--workspace <id>], scaffold <type> <directory>, check <directory>, or register <directory|json|@file>");
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

async function productCommand(api, [command, ...args]) {
  const base="/product-assets";
  if(command==='create-dashboard'&&args.length===1)return print(await workbench(api,'POST','/dashboards/create',{name:args[0]}));
  if(["list","types","home"].includes(command) && args.length===0)
    return print(await workbench(api,"GET",base+(command==="list"?"":`/${command}`)));
  if(command==="get" && args.length===1) return print(await workbench(api,"GET",`${base}/${encodeURIComponent(args[0])}`));
  if(command==="save" && args.length===2) return print(await workbench(api,"PUT",`${base}/${encodeURIComponent(args[0])}`,JSON.parse(readInput(args[1]))));
  if(command==='grants'&&args.length===1)return print(await workbench(api,'GET',`${base}/${encodeURIComponent(args[0])}/grants`));
  if(command==='grant'&&args.length===2)return print(await workbench(api,'POST',`${base}/${encodeURIComponent(args[0])}/grants`,JSON.parse(readInput(args[1]))));
  if(command==='domain-grant'&&args.length===2&&['true','false'].includes(args[1]))return print(await workbench(api,'POST',`${base}/${encodeURIComponent(args[0])}/domain-grant`,{shared:args[1]==='true'}));
  if(command==="copy" && args.length===2) return print(await workbench(api,"POST",`${base}/${encodeURIComponent(args[0])}/copy`,{name:args[1]}));
  if(command==="create-page" && args.length===2) return print(await workbench(api,"POST",`${base}/${encodeURIComponent(args[0])}/create-page`,{name:args[1]}));
  if(command==="use-home" && args.length===2) return print(await workbench(api,"POST",`${base}/${encodeURIComponent(args[0])}/use-home`,{revision:Number(args[1])}));
  if(command==="delete" && args.length===2) return print(await workbench(api,"DELETE",`${base}/${encodeURIComponent(args[0])}`,{revision:Number(args[1])}));
  die("product list|types|home|get <id>|save <id> <json|@file>|copy <id> <name>|use-home <id> <home revision>|delete <id> <revision>");
}

function usage() {
  die(`usage: ontomato.mjs [--lang <tag>] <command>
  test start|status|stop [--workspace <id>] [--sample test-data/sample.json]
  sdk current
  sdk icons
  sdk read <relative path, e.g. docs/components.md>
  sdk package <name>
  panel applications
  panel type <id> [--read <name>]
  panel type --all
  panel delete application|panel <id>
  panel projection <id>
  panel get <id>
  panel uses <applicationId>
  panel preview <working|commit> [--workspace <id>]
  panel scaffold <type> <new directory> [--id <application id>] [--operation <id>] [--batch <id>]
  panel check <directory> [--material <registration file>] [--sdk-dir <installed SDK release directory> [--component-package <release directory>]... [--type-table <file>]]
  panel check <platform panel directory> --builtin --sdk-dir <installed SDK release directory>
  panel register <directory> [--material <registration file>]
  panel register <json|@file>
  function list [<filter json|@file>]
  function get <id>
  function save <definition json|@file>
  function delete <id>
  workspace list [<page json|@file>]
  workspace create <name>
  workspace get|tree|commits|sessions <id> [<query json|@file>]
  workspace content <id> <path> [<commit>]
  workspace diff <id> <from> <to|working>
  workspace rename <id> <name>
  workspace delete <id>
  workspace import <id> <directory> --message <text>
  workspace restore <id> <commit>
  dataset-desc
  classes
  schema <class> [<class> ...]
  relationships <class> [<class> ...]
  vector-upload <class> <attribute> <objectId> [--file <path>] --text <text|@file>
  vector-delete <class> <attribute> <objectId> <path>
  distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
  execute-dsl <json|@file>
  metric-view context [--workspace <id>]
  metric-view generate [--save] <definition JSON or @file>
  metric-view execute <id> [<param json|@file>]
  metric-view find <class> [<question>]
  metric-view get <id>
  metric-view save <json|@file>
  metric-view publish <id>
  metric-view delete <id>
  action context [--workspace <id>]
  action generate [--save] --sample <JSON or @file> <definition JSON or @file>
  action find|get|save|publish|delete ...   (same arguments as metric-view)
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
  if (!cmd || cmd === "--help") return usage();
  const checkingPanel = cmd === "panel" && argv[1] === "check";
  const builtin = checkingPanel && takeFlag(argv, "--builtin");
  const sdkDirectory = checkingPanel ? takeOption(argv, "--sdk-dir") : null;
  const materialPath = checkingPanel ? takeOption(argv, "--material") ?? undefined : undefined;
  const typeTablePath = checkingPanel ? takeOption(argv, "--type-table") : null;
  const packageDirectories = [];
  if (checkingPanel) {
    let directory = takeOption(argv, "--component-package");
    while (directory !== null) {
      packageDirectories.push(directory);
      directory = takeOption(argv, "--component-package");
    }
    if (argv.length !== 3) die("panel check requires one workspace directory");
  }
  const offlineMaterial = typeTablePath !== null || packageDirectories.length > 0;
  if (builtin && (sdkDirectory === null || materialPath !== undefined || offlineMaterial)) {
    die("panel check <platform panel directory> --builtin --sdk-dir <installed SDK release directory>");
  }
  if (offlineMaterial && sdkDirectory === null) die("--component-package and --type-table require --sdk-dir");
  if (sdkDirectory !== null) {
    const sdk = await installedPanelSdk(sdkDirectory);
    if (builtin) return print(await checkBuiltinPanelSource(argv[2], sdk.checks, { assignIds: true }));
    const packages = await readLocalComponentPackages(packageDirectories, sdk.checks);
    const typeTable = typeTablePath === null ? undefined
      : sdk.checks.platformTypeTableResponseSchema.parse(JSON.parse(fs.readFileSync(typeTablePath, "utf8")));
    return print(await checkPanelWorkspace(argv[2], {
      ...sdk, materialPath, typeTable, loadPackage: name => packages.get(name),
    }));
  }
  if (cmd === "agent" && process.env.ONTOMATO_SKILL_SCENARIO === "platform") {
    return analystCommand({}, argv);
  }
  const platformAuthoring = ["action", "metric-view"].includes(cmd) && ["context", "generate"].includes(argv[1])
    && isPlatformAuthoring();
  const cfg = loadConfig();
  if (!cfg.envUrl) die("Set ONTOMATO_URL or envUrl in application.yml");
  const identity = process.env.ONTOMATO_API_KEY ? { apiKey: process.env.ONTOMATO_API_KEY }
    : process.env.ONTOMATO_TK ? { tk: process.env.ONTOMATO_TK }
      : platformAuthoring ? {} : await authenticate(cfg, lang);
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
  if (checkingPanel) return checkCurrentPanel(api, argv[2], materialPath);
  if (cmd === "panel") return panelCommand(api, workspaceId, argv.slice(1));
  if (cmd === "workspace") return workspaceCommand(api, argv.slice(1));
  if (cmd === "product") return productCommand(api, argv.slice(1));
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
  if (cmd === "distinct-values" || cmd === "execute-dsl" || cmd === "agent")
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
    await assetCommand(api, "metricView", argv.slice(1), workspaceId);
    return;
  }
  if (cmd === "action") {
    await assetCommand(api, "action", argv.slice(1), workspaceId);
    return;
  }
  die(`BUILD_TEST_UNSUPPORTED: command not supported: ${cmd}`);
}

main().catch(error => { console.error(error.message);process.exitCode=1; });
