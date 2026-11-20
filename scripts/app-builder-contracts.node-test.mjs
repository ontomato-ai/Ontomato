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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("the app-builder CLI checks a workspace and registers with the current SDK", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const ref = "f".repeat(40);
  const sdkVersion = "4.1.9-dev." + "a".repeat(64);
  const panel = {
    content: {
      html: '<div id="app"></div>',
      module: 'import {mountPanel} from "@ontomato/sdk/panel"; await mountPanel({});',
      messages: { en: { "settings.title": "Settings for {name}" } },
    },
    manifest: { members: {}, state: {}, events: {} },
  };
  const source = {
    kind: "candidate", workspace: { id: workspaceId, ref }, panel,
    previewContext: { kind: "build-test", test: null },
  };
  const requests = [];
  const sdkPath = "/apps-sdk/current";
  const release = {
    version: sdkVersion, digest: "b".repeat(64), publicBasePath: "/public",
    sdkBasePath: "/public" + sdkPath, checkPath: "/public" + sdkPath + "/node/panel-check.mjs",
    componentsPath: "/public" + sdkPath + "/components.json",
  };
  const typeTable = {
    objectTypes: {
      "platform:AgentDefinition": {
        reads: {
          list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
          record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
          form: { source: "object", parameterMode: "fixed", params: {}, result: "panelFormDescription" },
          createForm: { source: "type", parameterMode: "fixed", params: {}, result: "panelFormDescription" },
        },
        operations: [{ id: "platform:AgentDefinition.save", kind: "form.save", effect: "write", target: { source: "draft" }, inputSchema: {}, batch: false }],
      },
      "platform:ReviewQueue": {
        reads: {
          query: { source: "type", parameterMode: "fixed", params: { search: "keyword", status: "reviewStatus" }, result: "panelRecordQuery" },
          counts: { source: "type", parameterMode: "fixed", params: { by: "countField", search: "keyword" }, result: "panelGroupCounts" },
          record: { source: "object", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecord" },
        },
        operations: [{ id: "reviews.approve", kind: "action", effect: "write", target: { source: "input", input: "review" }, inputSchema: {}, batch: true }],
      },
    },
  };
  const datum = (...results) => ({ results, required: false });
  const catalogue = { version: sdkVersion, components: [
    { componentId: "ObjectList", data: { rows: datum("panelRecordList", "panelRecordQuery") } },
    { componentId: "ObjectSummary", data: { record: datum("panelRecord") } },
    { componentId: "ObjectForm", data: { form: datum("panelFormDescription"), createForm: datum("panelFormDescription") } },
    { componentId: "SegmentedControl", data: { counts: datum("panelGroupCounts") } },
    { componentId: "OperationButton", data: {} },
    { componentId: "Data", data: { "*": datum("panelRecordList") } },
  ] };
  const checkModule = `
    const ok = data => ({ success: true, data });
    const invalid = issues => ({ success: false, error: { issues } });
    const parse = value => value;
    export const registerProductPanelRequestSchema = {
      safeParse: value => "sdkVersion" in value
        ? invalid([{ path: ["sdkVersion"], message: "The current SDK refuses sdkVersion" }])
        : ok(value),
    };
    export const registerProductProjectionRequestSchema = {
      safeParse: value => value.data !== undefined ? ok(value) : invalid([{
        code: "invalid_union",
        unionErrors: [
          { issues: [{ code: "invalid_type", received: "undefined", path: ["data"], message: "Required" }] },
          { issues: [{ code: "invalid_literal", path: ["componentId"], message: "Expected chart" }] },
        ],
      }]),
    };
    export const platformTypeTableResponseSchema = { parse };
    export const appsSdkComponentDatum = (data, name) => data[name] ?? data["*"];
    export const directReadDeclaration = (_projection, read) => ({ result: {
      list: "panelRecordList", query: "panelRecordQuery", record: "panelRecord", counts: "panelGroupCounts",
      form: "panelFormDescription", createForm: "panelFormDescription",
    }[read.read] });
    export const panelOperationTargetPort = (port, type, batch) =>
      port?.objectType === type || (batch && port?.kind === "list" && port.items.objectType === type) ? port : undefined;
    export const projectionOperationTargetMatches = (projection, binding, declaration, type) =>
      Boolean(panelOperationTargetPort(projection.inputs[binding.target?.input], type, declaration.batch));
    export const panelReadParameterSchemas = {
      reviewStatus: { safeParse: value => ({ success: value === "all" }) },
      countField: { safeParse: value => ({ success: value === "status" }) },
    };
    export const panelDefinitionContentSchema = {
      parse,
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
  const inlinePanelPath = "/api/product-panels/inline-panel";
  const inlineRecords = new Map();
  let rejectInlinePanel = false;
  const server = createServer(async (request, response) => {
    let content = "";
    for await (const chunk of request) content += chunk;
    const body = content ? JSON.parse(content) : undefined;
    requests.push([request.method, request.url, body, request.headers["x-api-key"]]);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/apps-sdk/current") response.end(JSON.stringify(release));
    else if (request.url === "/api/app-builder/type-table") response.end(JSON.stringify(typeTable));
    else if (request.url === `${sdkPath}/components.json`) response.end(JSON.stringify(catalogue));
    else if (request.url === `${sdkPath}/node/panel-check.mjs`) response.end(checkModule);
    else if (request.url === projectionPath) response.end(JSON.stringify({ projection: { componentId: "@ontomato/sdk:ObjectList" } }));
    else if (request.url === "/api/product-projections/unwritten") {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "PRODUCT_UNAVAILABLE" } }));
    } else if (request.url === "/api/product-projections/hidden") {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: { message: "Product use Grant required" } }));
    } else if (request.url === inlinePanelPath || request.url.startsWith("/api/product-projections/")) {
      const kind = request.url === inlinePanelPath ? "panel" : "projection";
      const existing = inlineRecords.get(request.url);
      if (request.method === "PUT" && !(kind === "panel" && rejectInlinePanel) && body.revision === (existing?.revision ?? 0)) {
        const record = { ...body, revision: body.revision + 1 };
        inlineRecords.set(request.url, record);
        response.end(JSON.stringify({ [kind]: record }));
      } else if (request.method === "GET" && existing) response.end(JSON.stringify({ [kind]: existing }));
      else {
        response.statusCode = request.method === "GET" ? 404 : 409;
        response.end(JSON.stringify({ error: { message: "Record missing or changed" } }));
      }
    } else if (request.url === candidatePath) response.end(JSON.stringify(source));
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
    const input = { ...preview.panel, name: "Acceptance", description: "", visibility: "private" };
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
      ["GET", "/api/apps-sdk/current", undefined, "author-key"],
      ["GET", `${sdkPath}/node/panel-check.mjs`, undefined, "author-key"],
      ["PUT", panelPath, { ...input, revision: 7 }, "author-key"],
      ["PUT", usesPath, application, "author-key"],
    ]);
    const material = { panels: [{ id: "acceptance-panel", mode: "update", revision: 7, input: { ...input, sdkVersion } }] };
    await assert.rejects(run("panel", "register", JSON.stringify(material)), error => error.stderr.includes("The current SDK refuses sdkVersion"));
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), [
      ["GET", "/api/apps-sdk/current"], ["GET", `${sdkPath}/node/panel-check.mjs`],
    ]);
    const stale = { ...material.panels[0], input, revision: 6 };
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
      [`${sdkPath}/components.json`, "GET"], ["/api/app-builder/type-table", "GET"], [projectionPath, "GET"],
    ]));
    await writeFile(layout, "<bad>");
    await assert.rejects(run("panel", "check", directory), error => error.stderr.includes(`${layout}:1:2: Rejected by the release parser`));
    assert.equal(requests.some(([method, url]) => method !== "GET" || url === projectionPath), false);
    requests.length = 0;
    const draft = join(directory, "manager");
    const scaffold = await run("panel", "scaffold", "platform:AgentDefinition", draft, "--id", "example-agent-management", "--operation", "platform:AgentDefinition.save");
    assert.equal(JSON.parse(scaffold.stdout).entry, "/applications/example-agent-management/manage");
    for (const name of ["panel.html", "panel.json", "registration.json"]) {
      const sample = await readFile(join("agent-skills/ontomato-app-builder/examples/agent-management", name), "utf8");
      assert.equal(await readFile(join(draft, name), "utf8"), sample);
    }
    assert.deepEqual(requests.map(([method, url]) => [method, url]), [
      ["GET", "/api/apps-sdk/current"], ["GET", `${sdkPath}/node/panel-check.mjs`], ["GET", "/api/app-builder/type-table"],
    ]);
    const review = join(directory, "review");
    await run("panel", "scaffold", "platform:ReviewQueue", review, "--operation", "reviews.approve", "--batch", "reviews.approve");
    const { manifest: reviewManifest } = JSON.parse(await readFile(join(review, "panel.json"), "utf8"));
    const { projections: reviewProjections } = JSON.parse(await readFile(join(review, "registration.json"), "utf8"));
    const queries = Object.fromEntries(reviewProjections.flatMap(({ input }) => Object.entries(input.data)));
    assert.deepEqual(queries.rows.params, {});
    assert.deepEqual(queries.record.params, {});
    assert.deepEqual(queries.counts.params, { by: { literal: "status" } });
    assert.deepEqual(reviewManifest.members.list.outputs.search, { state: "search" });
    assert.deepEqual(reviewManifest.members.list.inputs, { status: { state: "status" } });
    assert.deepEqual(reviewManifest.members.tabs.outputs.value, { state: "status" });
    assert.deepEqual(reviewManifest.members.detail.inputs.search, { state: "search" });
    assert.deepEqual(reviewManifest.members.list.outputs.checked, { state: "checked" });
    assert.deepEqual(reviewManifest.members.action1.inputs, { review: { state: "selected" } });
    assert.deepEqual(reviewManifest.members.batch2.inputs, { review: { state: "checked" } });
    const reviewButton = reviewProjections.find(({ id }) => id.endsWith("-batch2")).input;
    assert.deepEqual(reviewButton.config, { operation: "approve" });
    assert.deepEqual(reviewButton.operations, { approve: {
      operation: { kind: "PlatformOperation", id: "reviews.approve" }, target: { input: "review" },
    } });
    assert.deepEqual(reviewButton.data, {});
    const reviewLayout = await readFile(join(review, "panel.html"), "utf8");
    assert(reviewLayout.indexOf('ref="batch2"') < reviewLayout.indexOf('ref="list"'));
    const reviewMaterial = join(review, "registration.json");
    await run("panel", "check", review, "--material", reviewMaterial);
    const reviewPanel = join(review, "panel.json");
    const incorrectPanel = JSON.parse(await readFile(reviewPanel, "utf8"));
    incorrectPanel.manifest.members.batch2.inputs = { entry: { state: "checked" } };
    await writeFile(reviewPanel, JSON.stringify(incorrectPanel));
    await assert.rejects(run("panel", "check", review, "--material", reviewMaterial), error =>
      error.stderr.includes("member batch2 (projection review-queue-manager-batch2): bind operation approve (reviews.approve)'s target input review"));
    await writeFile(reviewPanel, JSON.stringify({ manifest: reviewManifest }));
    const incorrect = JSON.parse(await readFile(reviewMaterial, "utf8"));
    const batch = incorrect.projections.find(({ id }) => id.endsWith("-batch2"));
    delete batch.input.inputs.review;
    await writeFile(reviewMaterial, JSON.stringify(incorrect));
    await assert.rejects(run("panel", "check", review, "--material", reviewMaterial), error =>
      error.stderr.includes(`projection ${batch.id}: operation approve (reviews.approve) has an invalid target input review`));
    batch.input.operations.approve.operation.id = "reviews.undeclared";
    await writeFile(reviewMaterial, JSON.stringify(incorrect));
    await assert.rejects(run("panel", "check", review, "--material", reviewMaterial), error =>
      error.stderr.includes(`projection ${batch.id}: operation approve (reviews.undeclared) is not declared in the type table`));
    requests.length = 0;
    await writeFile(layout, '<panel-member ref="tasks"></panel-member>');
    const reference = async id => {
      manifest.members.tasks.target.projectionId = id;
      await writeFile(join(directory, "panel.json"), JSON.stringify({ manifest }));
    };
    const registration = join(directory, "registration.json");
    const localMaterial = { projections: [{
      id: "draft-list", mode: "create", input: { componentId: "@ontomato/sdk:ObjectList", data: {} },
    }] };
    await writeFile(registration, JSON.stringify(localMaterial));
    await reference("draft-list");
    await run("panel", "check", directory);
    assert.equal(requests.splice(0).some(([method, url]) => method !== "GET" || url.includes("/product-")), false);

    await reference("unwritten");
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("projection unwritten was not found in the material or on the platform"));
    await reference("hidden");
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("projection hidden: 403") && error.stderr.includes("Product use Grant required"));

    delete localMaterial.projections[0].input.data;
    await writeFile(registration, JSON.stringify(localMaterial));
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("projection draft-list: data: required field is missing") && !error.stderr.includes("Expected chart"));

    const authorProjection = { componentId: "@ontomato/sdk:Data", data: { agents: {
      source: { type: { kind: "PlatformObjectType", id: "platform:AgentDefinition" } }, read: "list", params: {},
    } } };
    manifest.members.tasks.target = { projection: authorProjection };
    const descriptor = join(directory, "panel.json");
    await writeFile(descriptor, JSON.stringify({ manifest }));
    const item = { id: "inline-panel", mode: "create", input: { name: "Inline", description: "", visibility: "private" } };
    await writeFile(registration, JSON.stringify({ panels: [item] }));
    requests.length = 0;
    await run("panel", "check", directory);
    assert.equal(requests.splice(0).some(([method, url]) => method !== "GET" || url.includes("/product-")), false);
    assert.equal(await readFile(descriptor, "utf8"), JSON.stringify({ manifest }));

    const originalRead = authorProjection.data.agents;
    authorProjection.data.agents = {
      source: { type: { kind: "PlatformObjectType", id: "platform:ReviewQueue" } }, read: "query", params: {},
    };
    await writeFile(descriptor, JSON.stringify({ manifest }));
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("data.agents returns 'panelRecordQuery'") && error.stderr.includes("accepts panelRecordList"));
    authorProjection.data.agents = originalRead;
    await writeFile(descriptor, JSON.stringify({ manifest }));

    rejectInlinePanel = true;
    await assert.rejects(run("panel", "register", directory), error => error.stderr.includes("panel inline-panel: PUT"));
    const savedSource = JSON.parse(await readFile(descriptor, "utf8"));
    const savedTarget = savedSource.manifest.members.tasks.target;
    assert.match(savedTarget.projection.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
    const inlineProjectionId = savedTarget.projection.id;
    const inlineProjectionPath = `/api/product-projections/${inlineProjectionId}`;
    assert.deepEqual(savedTarget.projection, { ...authorProjection, id: inlineProjectionId });
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url, body]) => [url, body.revision]), [
      [inlineProjectionPath, 0], [inlinePanelPath, 0],
    ]);

    rejectInlinePanel = false;
    await run("panel", "register", directory);
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url, body]) => [url, body.revision]), [
      [inlineProjectionPath, 1], [inlinePanelPath, 0],
    ]);
    assert.equal(inlineRecords.get(inlineProjectionPath).name, "tasks");
    assert.equal(inlineRecords.get(inlineProjectionPath).visibility, "private");
    assert.deepEqual(inlineRecords.get(inlinePanelPath).manifest.members.tasks.target, { projectionId: inlineProjectionId });

    inlineRecords.set(inlineProjectionPath, { ...inlineRecords.get(inlineProjectionPath), name: "Renamed", revision: 4 });
    savedSource.manifest.members = { renamedTasks: savedSource.manifest.members.tasks };
    await writeFile(descriptor, JSON.stringify(savedSource));
    await writeFile(layout, '<panel-member ref="renamedTasks"></panel-member>');
    await writeFile(registration, JSON.stringify({ panels: [{ ...item, mode: "update", revision: 1 }] }));
    await run("panel", "register", directory);
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url, body]) => [url, body.revision]), [
      [inlineProjectionPath, 4], [inlinePanelPath, 1],
    ]);
    assert.equal(inlineRecords.get(inlineProjectionPath).name, "Renamed");
    assert.deepEqual(inlineRecords.get(inlinePanelPath).manifest.members.renamedTasks.target, { projectionId: inlineProjectionId });
    assert.equal(inlineRecords.size, 2);
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
