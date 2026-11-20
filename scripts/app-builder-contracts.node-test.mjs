import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const [command, option] of [
  [["distinct-values", "person", "id"], "--limit"],
  [["prod-distinct-values", "person", "id"], "--limit"],
  [["prod-knowledge", "question"], "--max"],
]) {
  for (const value of ["abc", "Infinity", ""]) {
    test(`${command[0]} rejects ${JSON.stringify(value)} before HTTP (retired operations stay unavailable)`, () => {
      const result = spawnSync(process.execPath, [
        "agent-skills/ontomato-app-builder/ontomato.mjs", ...command, option, value,
      ], {
        encoding: "utf8",
        env: { ...process.env, ONTOMATO_URL: "http://127.0.0.1:1", ONTOMATO_API_KEY: "test-only" },
      });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(command[0].startsWith("prod-") ? "BUILD_TEST_UNSUPPORTED" : `${option}: expected a finite number`), result.stderr);
      assert.ok(!result.stderr.includes("fetch failed"), result.stderr);
    });
  }
}

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { analystCommand } from "../agent-skills/ontomato-analyst/client.mjs";

test("shared analyst numeric options reject invalid values before HTTP", async () => {
  for (const command of [["distinct-values", "person", "id"], ["metrics", "question"], ["knowledge", "question"]])
    await assert.rejects(analystCommand({ envUrl: "http://127.0.0.1:1" }, [...command, "--limit", "NaN"]), /--limit: expected a finite number/);
});

test("skill Action execution preserves complete explicit parameters and owner errors", async () => {
  let sent;
  const server = createServer(async (request, response) => {
    if(request.url.endsWith("/build-tests")) {
      response.setHeader("content-type","application/json");response.end(JSON.stringify({contextId:"22222222-2222-4222-8222-222222222222"}));return;
    }
    assert.deepEqual(JSON.parse(request.headers["x-ontomato-execution-context"]),{kind:"build-test",contextId:"22222222-2222-4222-8222-222222222222"});
    let text = "";
    for await (const chunk of request) text += chunk;
    const match = text.match(/name="param"\r\n\r\n([^\r]+)/);
    sent = JSON.parse(match[1]);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(Object.hasOwn(sent, "optional")
      ? { success: true, data: {} }
      : { success: false, message: "Missing parameter: optional" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const run = parameters => promisify(execFile)(process.execPath, ["agent-skills/ontomato-app-builder/ontomato.mjs", "action", "execute", "test", JSON.stringify(parameters)], {
    env: { ...process.env, ONTOMATO_URL: `http://127.0.0.1:${server.address().port}`, ONTOMATO_API_KEY: "test-only", ONTOMATO_WORKSPACE_ID:"11111111-1111-4111-8111-111111111111" },
  });
  try {
    const parameters = { optional: null, text: "", count: 0 };
    await run(parameters);
    assert.deepEqual(sent, parameters);
    await assert.rejects(run({ text: "", count: 0 }), error => error.stderr.includes("Missing parameter: optional"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

for(const command of ["status","stop"]) {
  test(`test ${command} reports NONE for an absent workspace context`,async()=>{
    const methods=[];
    const server=createServer((request,response)=>{
      methods.push(request.method);response.setHeader("content-type","application/json");response.end("null");
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    try {
      const result=await promisify(execFile)(process.execPath,["agent-skills/ontomato-app-builder/ontomato.mjs","test",command],{
        env:{...process.env,ONTOMATO_URL:`http://127.0.0.1:${server.address().port}`,ONTOMATO_API_KEY:"test-only",ONTOMATO_WORKSPACE_ID:"11111111-1111-4111-8111-111111111111"},
      });
      assert.deepEqual(JSON.parse(result.stdout),{workspaceId:"11111111-1111-4111-8111-111111111111",contextId:null,status:"NONE"});
      assert.deepEqual(methods,[command==="status"?"GET":"DELETE"]);
    } finally {await new Promise(resolve=>server.close(resolve));}
  });
}

test("agent dispatch carries build-test context and preserves the entry-point refusal",async()=>{
  const paths=[];
  const server=createServer((request,response)=>{
    paths.push(request.url);response.setHeader("content-type","application/json");
    if(request.url.endsWith("/build-tests")) {response.end(JSON.stringify({contextId:"22222222-2222-4222-8222-222222222222"}));return;}
    assert.deepEqual(JSON.parse(request.headers["x-ontomato-execution-context"]),{kind:"build-test",contextId:"22222222-2222-4222-8222-222222222222"});
    response.writeHead(422);response.end(JSON.stringify({success:false,code:"BUILD_TEST_UNSUPPORTED",message:"Agent commands are unavailable in build tests"}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    await assert.rejects(promisify(execFile)(process.execPath,["agent-skills/ontomato-app-builder/ontomato.mjs","agent","list"],{
      env:{...process.env,ONTOMATO_URL:`http://127.0.0.1:${server.address().port}`,ONTOMATO_API_KEY:"test-only",ONTOMATO_WORKSPACE_ID:"11111111-1111-4111-8111-111111111111"},
    }),error=>error.stderr.includes("Agent commands are unavailable in build tests"));
    assert.equal(paths.length,2);assert.ok(paths[1].endsWith("/platform/agent-channel/commands"));
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test("the app-builder CLI uses the current checker and registers no-code material", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const ref = "f".repeat(40);
  const sdkVersion = "4.1.9-dev." + "a".repeat(64);
  const panel = {
    content: {
      html: '<div id="app"></div>',
      module: 'import {mountPanel} from "@ontomato/sdk/panel"; await mountPanel({});',
      messages: { en: { "settings.title": "Settings for {name}" } },
    },
    manifest: { slots: {}, state: {}, operations: [] },
    sdkVersion,
  };
  const source = {
    kind: "candidate", workspace: { id: workspaceId, ref }, panel,
    previewContext: { kind: "build-test", test: null },
  };
  const requests = [];
  const sdkPath = `/apps-sdk/${sdkVersion}`;
  const release = {
    version: sdkVersion, digest: "b".repeat(64), publicBasePath: "/public",
    sdkBasePath: "/public" + sdkPath, checkPath: "/public" + sdkPath + "/node/panel-check.mjs",
    componentsPath: "/public" + sdkPath + "/components.json",
  };
  const checkModule = `
    const parse = value => {
      if ("sdkVersion" in value) throw new Error("The current SDK refuses sdkVersion");
      return value;
    };
    export const registerDirectPanelRequestSchema = { parse };
    export const registerDirectProjectionRequestSchema = { parse };
    export const directPanelDefinitionContentSchema = {
      safeParse(value) {
        return value.content.html === "<bad>"
          ? { success: false, error: { issues: [{ path: ["content", "html"], params: { line: 1, column: 2 }, message: "Rejected by the release parser" }] } }
          : { success: true, data: value };
      }
    };
  `;
  const candidatePath = `/api/workspaces/${workspaceId}/panel-candidate?ref=${ref}`;
  const panelPath = "/api/product-panels/acceptance-panel";
  const projectionPath = "/api/product-projections/tasks";
  const usesPath = "/owner/platform/applications/app-acceptance/panel-uses";
  const server = createServer(async (request, response) => {
    let content = "";
    for await (const chunk of request) content += chunk;
    const body = content ? JSON.parse(content) : undefined;
    requests.push([request.method, request.url, body, request.headers["x-api-key"]]);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/apps-sdk/current") response.end(JSON.stringify(release));
    else if (request.url === `${sdkPath}/components.json`) response.end(JSON.stringify({ version: sdkVersion, components: [{ componentId: "ObjectList" }] }));
    else if (request.url === `${sdkPath}/node/panel-check.mjs`) response.end(checkModule);
    else if (request.url === projectionPath) response.end(JSON.stringify({ projection: { componentId: "@ontomato/sdk:ObjectList" } }));
    else if (request.url === candidatePath) response.end(JSON.stringify(source));
    else if (request.url === panelPath && body?.revision === 6) {
      response.statusCode = 409;
      response.end(JSON.stringify({ error: { message: "Revision conflict" } }));
    } else if (request.url === panelPath) response.end(JSON.stringify({ panel: { revision: 8 } }));
    else if (request.url === usesPath) response.end(JSON.stringify({ success: true, data: { panelUses: [] } }));
    else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Unexpected request" }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "ontomato-panel-check-"));
  const run = (...args) => promisify(execFile)(process.execPath, ["agent-skills/ontomato-app-builder/ontomato.mjs", ...args], {
    env: { ...process.env, ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base + "/owner",
      ONTOMATO_API_KEY: "author-key", ONTOMATO_WORKSPACE_ID: workspaceId },
  });
  try {
    const catalog = await run("sdk", "read", "components.json");
    assert.equal(JSON.parse(catalog.stdout).version, sdkVersion);
    const preview = JSON.parse((await run("panel", "preview", ref)).stdout);
    assert.deepEqual(preview, source);
    const input = {
      content: { html: "<section></section>" },
      manifest: { members: {}, state: {}, events: {} },
      name: "Acceptance", description: "", visibility: "private",
    };
    const application = { entry: { path: "/acceptance", renderer: "panels" }, panelUses: [] };
    const result = await run("panel", "register", JSON.stringify({
      panels: [{ id: "acceptance-panel", mode: "update", revision: 7, input }],
      applications: [{ id: "app-acceptance", mode: "update", input: application }],
    }));
    assert.equal(result.stdout, "panel acceptance-panel\napplication app-acceptance\n");
    assert.deepEqual(requests.splice(0), [
      ["GET", "/api/apps-sdk/current", undefined, "author-key"],
      ["GET", `${sdkPath}/components.json`, undefined, "author-key"],
      ["GET", candidatePath, undefined, "author-key"],
      ["PUT", panelPath, { ...input, revision: 7 }, "author-key"],
      ["PUT", usesPath, application, "author-key"],
    ]);
    const stale = { id: "acceptance-panel", mode: "update", input, revision: 6 };
    await assert.rejects(run("panel", "register", JSON.stringify({
      panels: [stale, { ...stale, id: "later-panel", revision: 7 }],
    })), error => error.stderr.includes("409 Revision conflict"));
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url]) => url), [panelPath]);

    const manifest = { members: { tasks: { target: { projectionId: "tasks" } } }, state: {}, events: {} };
    await writeFile(join(directory, "panel.json"), JSON.stringify({ manifest }));
    const layout = join(directory, "panel.html");
    await writeFile(layout, '<panel-member ref="tasks"></panel-member>');
    const checked = await run("panel", "check", directory);
    assert.deepEqual(JSON.parse(checked.stdout), { status: "valid", version: sdkVersion, digest: release.digest, unchecked: [] });
    assert.deepEqual(new Map(requests.splice(0).map(([method, url]) => [url, method])), new Map([
      ["/api/apps-sdk/current", "GET"], [`${sdkPath}/node/panel-check.mjs`, "GET"],
      [`${sdkPath}/components.json`, "GET"], [projectionPath, "GET"],
    ]));
    const materialPath = join(directory, "registration.json");
    await writeFile(materialPath, JSON.stringify({
      projections: [{ id: "tasks", mode: "create", input: { componentId: "@ontomato/sdk:ObjectList" } }],
    }));
    const checkedMaterial = await run("panel", "check", directory, "--material", materialPath);
    assert.deepEqual(JSON.parse(checkedMaterial.stdout).unchecked, []);
    assert.equal(requests.splice(0).some(([method, url]) => method !== "GET" || url === projectionPath), false);
    await writeFile(layout, "<bad>");
    await assert.rejects(run("panel", "check", directory), error => error.stderr.includes(`${layout}:1:2: Rejected by the release parser`));
    assert.equal(requests.some(([method, url]) => method !== "GET" || url === projectionPath), false);
  } finally {
    await rm(directory, { recursive: true });
    await new Promise(resolve => server.close(resolve));
  }
});

test("App Builder Action generation tests and adopts the actual definition before an explicit save", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const sample = { objDatas: [], relDatas: [] };
  const definition = { name: "Action", function: { code: "print('ok')", parameters: [{ name: "value", type: "TYPE_STRING", value: "sample" }] } };
  const explained = { ...definition, explanationRef: "22222222-2222-4222-8222-222222222222" };
  const accepted = { ...explained, name: "Accepted definition" };
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push({ path: request.url, body, callback: request.headers["x-ontomato-callback-credential"], key: request.headers["x-api-key"] });
    response.setHeader("content-type", "application/json");
    const operation = request.url.split("/").at(-1);
    const replies = {
      prepare: { prepared: true }, reset: { reset: true }, test: { result: { result: "completed" } },
      "explain-draft": { explanationRef: explained.explanationRef }, adopt: { definition: accepted },
      save: { data: { ...accepted, id: "saved" } },
    };
    response.end(JSON.stringify(replies[operation] ?? { success: false, message: "Unexpected request" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const result = await promisify(execFile)(process.execPath, [
      "agent-skills/ontomato-app-builder/ontomato.mjs", "action", "generate", "--save", "--sample",
      JSON.stringify(sample), JSON.stringify(definition),
    ], {
      env: { ...process.env, ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_RUN_ID: runId,
        ONTOMATO_AUTHORING_URL: base + "/authoring", ONTOMATO_WORKBENCH_URL: base,
        ONTOMATO_ONTOLOGY_URL: base + "/ontology", ONTOMATO_EXECUTION_CALLBACK: "run-callback", ONTOMATO_API_KEY: "save-key" },
    });
    const author = (path, body) => ({ path: "/authoring/action/" + path, body, callback: "run-callback", key: undefined });
    const input = { code: definition.function.code, parameterDefs: definition.function.parameters };
    assert.deepEqual(requests, [
      author("prepare", sample), author("reset", {}), author("test", input),
      author("explain-draft", input), author("adopt", { definition: explained }),
      { path: "/ontology/action/save", body: accepted, callback: undefined, key: "save-key" },
    ]);
    assert.equal(JSON.parse(result.stdout).id, "saved");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("standalone MetricView authoring closes its window when a bound query package fails", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const contextId = "22222222-2222-4222-8222-222222222222";
  const definition = {
    function: { queryPackage: { manifest: { parameterDefs: [{ name: "count", value: 1 }] } } },
    bindings: [{ parameters: { count: 2 } }],
  };
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    const context = request.headers["x-ontomato-execution-context"];
    requests.push({ path: request.url, method: request.method, context, body });
    response.setHeader("content-type", "application/json");
    if (request.url.endsWith("/build-tests")) response.end(JSON.stringify({ contextId }));
    else if (request.url.endsWith("/gates")) response.end(JSON.stringify({ runId }));
    else if (request.url.endsWith("/close")) response.end(JSON.stringify({ closed: true }));
    else if (request.url.endsWith("/test")) {
      const count = body.queryPackage.manifest.parameterDefs[0].value;
      response.end(JSON.stringify({ result: { error: count === 2 ? "Sample query failed" : null } }));
    } else response.end(JSON.stringify({ success: false, message: "Unexpected request" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(promisify(execFile)(process.execPath, [
      "agent-skills/ontomato-app-builder/ontomato.mjs", "metric-view", "generate", "--save",
      "--workspace", "workspace", JSON.stringify(definition),
    ], { env: { ...process.env, ONTOMATO_SKILL_SCENARIO: "external", ONTOMATO_RUN_ID: "",
      ONTOMATO_AUTHORING_URL: "", ONTOMATO_EXECUTION_CALLBACK: "", ONTOMATO_WORKBENCH_URL: base,
      ONTOMATO_ONTOLOGY_URL: base + "/ontology", ONTOMATO_API_KEY: "external-key" } }), /Sample query failed/);
    const root = "/ontology/ontology/ai/generation";
    const context = JSON.stringify({ kind: "build-test", contextId });
    const trial = `${root}/${runId}/authoring/metric-view/test`;
    assert.deepEqual(requests, [
      { path: "/api/workspaces/workspace/build-tests", method: "GET", context: undefined, body: undefined },
      { path: root + "/gates", method: "POST", context, body: { kind: "metric" } },
      { path: trial, method: "POST", context, body: { queryPackage: definition.function.queryPackage } },
      { path: trial, method: "POST", context, body: { queryPackage: { manifest: { parameterDefs: [{ name: "count", value: 2 }] } } } },
      { path: `${root}/${runId}/close`, method: "POST", context: undefined, body: {} },
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
