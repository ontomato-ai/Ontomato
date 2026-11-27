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
        "agent-skills/ontomato-app-builder/scripts/ontomato.mjs", ...command, option, value,
      ], {
        encoding: "utf8",
        env: { ...process.env, ONTOMATO_URL: "http://127.0.0.1:1", ONTOMATO_API_KEY: "test-only" },
      });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(command[0].startsWith("prod-") ? "PREVIEW_WRITE_FORBIDDEN" : `${option}: expected a finite number`), result.stderr);
      assert.ok(!result.stderr.includes("fetch failed"), result.stderr);
    });
  }
}

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { analystCommand } from "../agent-skills/ontomato-analyst/client.mjs";
import { panelRegistrationClient } from "../agent-skills/ontomato-app-builder/scripts/panel-registration.mjs";

test("deletes a panel by ID without loading its obsolete definition", async () => {
  const received = [];
  const server = createServer((request, response) => {
    received.push([request.method, request.url]);
    response.setHeader("content-type", "application/json");
    response.statusCode = request.method === "DELETE" ? 200 : 422;
    response.end(JSON.stringify(request.method === "DELETE" ? { success: true } : { error: "Old manifest" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = panelRegistrationClient({ workbenchUrl: `http://127.0.0.1:${server.address().port}` });
    assert.deepEqual(await client.deletePanel("old-panel"), { success: true });
    assert.deepEqual(received, [["DELETE", "/api/product-panels/old-panel"]]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


test("shared analyst numeric options reject invalid values before HTTP", async () => {
  for (const command of [["distinct-values", "person", "id"], ["metrics", "question"], ["knowledge", "question"]])
    await assert.rejects(analystCommand({ envUrl: "http://127.0.0.1:1" }, [...command, "--limit", "NaN"]), /--limit: expected a finite number/);
});

test("skill Action execution preserves complete explicit parameters and owner errors", async () => {
  let sent;
  const server = createServer(async (request, response) => {
    if (request.url === "/api/app-builder/workspace") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({workspaceId:"11111111-1111-4111-8111-111111111111"}));
      return;
    }
    assert.equal(request.headers["x-ontomato-execution-context"], undefined);
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
  const run = parameters => promisify(execFile)(process.execPath, ["agent-skills/ontomato-app-builder/scripts/ontomato.mjs", "action", "execute", "test", JSON.stringify(parameters)], {
    env: { ...process.env, ONTOMATO_URL: `http://127.0.0.1:${server.address().port}`, ONTOMATO_TK: "session-callback", ONTOMATO_EXECUTION_CALLBACK: "session-callback" },
  });
  try {
    const parameters = { optional: null, text: "", count: 0 };
    await run(parameters);
    assert.deepEqual(sent, parameters);
    await assert.rejects(run({ text: "", count: 0 }), error => error.stderr.includes("Missing parameter: optional"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test("agent dispatch preserves the entry-point refusal",async()=>{
  const paths=[];
  const server=createServer((request,response)=>{
    paths.push(request.url);response.setHeader("content-type","application/json");
    assert.equal(request.headers["x-ontomato-execution-context"], undefined);
    response.writeHead(422);response.end(JSON.stringify({success:false,code:"PREVIEW_WRITE_FORBIDDEN",message:"Agent commands are unavailable in previews"}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    await assert.rejects(promisify(execFile)(process.execPath,["agent-skills/ontomato-app-builder/scripts/ontomato.mjs","agent","list","--workspace","11111111-1111-4111-8111-111111111111"],{
      env:{...process.env,ONTOMATO_URL:`http://127.0.0.1:${server.address().port}`,ONTOMATO_API_KEY:"test-only"},
    }),error=>error.stderr.includes("Agent commands are unavailable in previews"));
    assert.equal(paths.length,1);assert.ok(paths[0].endsWith("/platform/agent-channel/commands"));
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test("the app-builder CLI checks a workspace and registers with the current SDK", async t => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const ref = "f".repeat(40);
  const sdkVersion = "4.1.9-dev." + "a".repeat(64);
  const panel = {
    content: {
      html: '<div id="app"></div>',
      module: 'import {mountPanel} from "@ontomato/sdk/panel"; await mountPanel({});',
      messages: { en: { "settings.title": "Settings for {name}" } },
    },
    manifest: { members: {}, state: {} },
  };
  const source = {
    kind: "candidate", workspace: { id: workspaceId, ref }, panel,
    previewContext: { kind: "preview" },
  };
  const requests = [];
  const sdkPath = "/apps-sdk/current";
  const release = {
    version: sdkVersion, digest: "b".repeat(64), publicBasePath: "/public",
    sdkBasePath: "/public" + sdkPath, checkPath: "/public" + sdkPath + "/node/panel-check.mjs",
    componentsPath: "/public" + sdkPath + "/components.json",
  };
  const typeTable = {
    resultSchemas: {
      panelRecordList: { type: "array" },
      panelRecord: { type: "object" },
      panelRecordQuery: { type: "object", required: ["rows"], properties: { rows: { type: "array" } } },
      panelGroupCounts: { type: "array", items: { type: "object", required: ["key", "label", "count"] } },
      panelFormDescription: { type: "object", required: ["fields"] },
    },
    unavailableActions: [
      { id: "legacy-action", reason: "Stored function is missing" },
      { id: "bad-action", objectType: "ReviewQueue", reason: "target: invalid field" },
    ],
    customerTypesUnavailable: { reason: "Object type catalogue permission required" },
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
          counts: {
            source: "type", parameterMode: "fixed", params: { by: "countField", search: "keyword" },
            requiredParams: ["by"], result: "panelGroupCounts",
          },
          record: { source: "object", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecord" },
        },
        operations: [{ id: "reviews.approve", kind: "action", effect: "write", target: { source: "input", input: "review" }, inputSchema: {}, batch: true }],
      },
    },
  };
  const datum = (...results) => ({ results, required: false });
  const catalogue = { version: sdkVersion, components: [
    { componentId: "ObjectList", data: { rows: datum("panelRecordList", "panelRecordQuery") } },
    { componentId: "ObjectHeader", data: { record: datum("panelRecord") } },
    { componentId: "ObjectSummary", data: { record: datum("panelRecord") } },
    { componentId: "ObjectForm", data: { form: datum("panelFormDescription"), createForm: datum("panelFormDescription") }, config: [{ name: "actions", type: "string", description: "Form actions", required: false }] },
    { componentId: "SegmentedControl", data: { counts: datum("panelGroupCounts") } },
    { componentId: "OperationButton", data: {}, config: [{ name: "operation", type: "string", description: "Local operation", required: true }] },
    { componentId: "PanelData", data: { "*": datum("panelRecordList") } },
    { componentId: "MetricChart", data: {} },
    { componentId: "AgentChat", data: {}, inputs: { sessionId: { kind: "scalar", type: "string" } }, outputs: { sessionId: { kind: "scalar", type: "string" } } },
  ] };
  const checkModule = `
    const ok = data => ({ success: true, data });
    const invalid = issues => ({ success: false, error: { issues } });
    const parse = value => value;
    export const registerProductPanelRequestSchema = {
      omit: () => panelDefinitionContentSchema,
      safeParse: value => "sdkVersion" in value
        ? invalid([{ path: ["sdkVersion"], message: "The current SDK refuses sdkVersion" }])
        : ok(value),
    };
    export const productProjectionInputSchema = { safeParse: ok };
    export const registerProductProjectionRequestSchema = {
      safeParse: value => value.config !== undefined ? ok({ data: {}, ...value }) : invalid([{
        code: "invalid_union",
        unionErrors: [
          { issues: [{ code: "invalid_type", received: "undefined", path: ["config"], message: "Required" }] },
          { issues: [{ code: "invalid_literal", path: ["componentId"], message: "Expected chart" }] },
        ],
      }]),
    };
    export const platformTypeTableResponseSchema = { parse };
    export const COMPONENT_PACKAGES_PATH = "/api/component-packages";
    export const componentPackageNameSchema = { parse };
    export const componentPackageResponseSchema = { parse };
    export const panelAuthoringManifestSchema = { parse, safeParse: ok };
    export const draftReadOperationIds = [];
    export const panelAuthoringMemberSchema = { safeParse: member => member.sourceCard && member.id
      ? invalid([{ message: "MetricChart takes its projection definition from the source card" }]) : ok(member) };
    export const BUILTIN_PRODUCT_ID_PREFIX = "builtin-product-";
    export const domainProductIdSchema = { safeParse: id => id.startsWith(BUILTIN_PRODUCT_ID_PREFIX)
      ? invalid([{ message: "IDs beginning with builtin-product- are reserved for platform products" }]) : ok(id) };
    export const builtinProductIdSchema = { safeParse: id => id?.startsWith(BUILTIN_PRODUCT_ID_PREFIX)
      ? ok(id) : invalid([{ message: "Expected a platform product ID with prefix builtin-product-" }]) };
    export const appsSdkComponentCatalogSchema = { parse };
    export const domainApplicationIconKeys = ["app-window", "folder", "calendar"];
    export const applicationCatalogueRecordSchema = { parse };
    export const applicationSourceManifestSchema = { safeParse: ok };
    export const applicationIdentityUpdateSchema = { parse, partial: () => ({ strict: () => ({ parse }) }) };
    export async function panelModuleImports(source) {
      if (source.includes("element-plus")) throw new Error("A panel's module imports element-plus, which the platform does not give it");
    }
    export const CHART_PROJECTION_SOURCES_PATH = "/product-projections/chart-sources";
    export const chartProjectionLookupResponseSchema = { parse };
    export const registerChartProjectionResponseSchema = { parse };
    export const productProjectionResponseSchema = { parse };
    export const productProjectionUsedBySchema = { parse };
    export const PROJECTION_REUSE_PANEL_HEADER = "X-Ontomato-Projection-Reuse-Panel";
    export function bindPanelAuthoringChart(key, member, { state, projection }) {
      if (projection.componentId !== "@ontomato/sdk:MetricChart" || !state[member.state.range]) {
        throw new Error("member " + key + ": cannot connect chart range");
      }
      return { target: { projectionId: projection.id }, inputs: { range: { state: member.state.range } } };
    }
    export function expandPanelAuthoringMember(key, member, { state, components, typeTable }) {
      if (!components.some(component => component.componentId === member.component)) throw new Error("member " + key + ": component unavailable");
      if (member.component === "AgentChat") {
        const projection = {
          componentId: "@ontomato/sdk:AgentChat",
          data: {},
          inputs: member.state?.sessionId ? { sessionId: { kind: "scalar", type: "string" } } : {},
          outputs: member.state?.sessionId ? { sessionId: { kind: "scalar", type: "string" } } : {},
          config: member.config ?? {},
          conversationEntry: { target: member.agent === "page-default" ? { kind: "page-default" } : member.agent },
        };
        const placement = member.state?.sessionId
          ? { inputs: { sessionId: { state: member.state.sessionId } }, outputs: { sessionId: { state: member.state.sessionId } } }
          : {};
        return { projection, placement };
      }
      const target = state[member.target]?.type;
      const type = member.type ?? target?.objectType ?? target?.items?.objectType;
      const owner = typeTable.objectTypes[type];
      if (!owner) throw new Error("member " + key + ": invalid target " + member.target);
      const data = Object.fromEntries(Object.entries(member.data ?? {}).map(([name, datum]) => {
        const read = typeof datum === "string" ? datum : datum.read;
        const source = owner.reads[read].source === "type"
          ? { type: { kind: "PlatformObjectType", id: type } } : { object: { input: "item" } };
        return [name, { source, read, params: datum.params ?? {} }];
      }));
      const projection = { componentId: "@ontomato/sdk:" + member.component, data, inputs: {}, outputs: {}, config: {} };
      const placement = {};
      if (member.operation) {
        const operation = owner.operations.find(operation => operation.id === member.operation);
        if (!operation) throw new Error("member " + key + ": operation " + member.operation + " is not declared");
        if (operation.target.source === "draft") return { projection, placement };
        const name = operation.id.split(".").at(-1);
        const input = operation.target.input;
        projection.inputs = { [input]: target };
        projection.config = { operation: name };
        projection.operations = { [name]: { operation: { kind: "PlatformOperation", id: operation.id }, target: { input } } };
        placement.inputs = { [input]: { state: member.target } };
      }
      return { projection, placement };
    }
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
        return typeof value.content.html === "string" && (value.content.module === undefined || typeof value.content.module === "string")
          ? ok(value)
          : invalid([{ path: ["content", "html"], message: "Required" }]);
      }
    };
  `;
  const installedPackage = { name: "@example/tools", version: "2.0.0", components: [] };
  const installedPackagePath = "/api/component-packages/" + encodeURIComponent(installedPackage.name);
  const candidatePath = `/api/workspaces/${workspaceId}/panel-candidate?ref=${ref}`;
  const panelPath = "/api/product-panels/acceptance-panel";
  const projectionPath = "/api/product-projections/tasks";
  const applicationPath = "/owner/platform/applications/app-acceptance";
  const usesPath = applicationPath + "/panel-uses";
  const applicationRecordPath = "/owner/platform/applications/catalogue/app-acceptance";
  const identityPath = "/owner/platform/applications/app-acceptance/identity";
  let identity = { names: { en: "Original" }, descriptions: { en: "Keep the description" }, icon: "settings" };
  const inlinePanelPath = "/api/product-panels/inline-panel";
  const chartPath = "/api/product-projections/chart-sources";
  const chartProjection = { id: "source-owned-chart", componentId: "@ontomato/sdk:MetricChart", data: {} };
  const storedChartPath = "/api/product-projections/" + chartProjection.id;
  const chartSource = { dashboardId: "dashboard-a", cardId: "card-b" };
  const chartQuery = chartPath + "?" + new URLSearchParams(chartSource);
  let registeredChart = false;
  const inlineRecords = new Map();
  const projectionReuseGuards = [];
  let projectionUsage = { panels: [{ id: "inline-panel", name: "Inline" }], hiddenCount: 0 };
  let rejectInlinePanel = false;
  let panelInUse = true;
  const deletedPanel = {
    success: true, deletedProjectionIds: ["exclusive-projection"], retainedProjectionIdsWithoutEdit: ["owner-projection"],
  };
  const server = createServer(async (request, response) => {
    let content = "";
    for await (const chunk of request) content += chunk;
    const body = content ? JSON.parse(content) : undefined;
    requests.push([request.method, request.url, body, request.headers["x-api-key"]]);
    if (request.headers["x-ontomato-projection-reuse-panel"]) {
      projectionReuseGuards.push(request.headers["x-ontomato-projection-reuse-panel"]);
    }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/apps-sdk/current") response.end(JSON.stringify(release));
    else if (request.url === "/api/app-builder/type-table") response.end(JSON.stringify(typeTable));
    else if (request.url === installedPackagePath) response.end(JSON.stringify(installedPackage));
    else if (request.url === `${sdkPath}/components.json`) response.end(JSON.stringify(catalogue));
    else if (request.url === `${sdkPath}/node/panel-check.mjs`) response.end(checkModule);
    else if (request.url === chartQuery && request.method === "GET") {
      response.end(JSON.stringify({ projectionId: registeredChart ? chartProjection.id : null }));
    } else if (request.url === chartPath && request.method === "POST") {
      registeredChart = true;
      response.end(JSON.stringify({ projection: chartProjection }));
    } else if (request.url === storedChartPath && request.method === "GET" && registeredChart) {
      response.end(JSON.stringify({ projection: chartProjection }));
    } else if ([projectionPath, "/api/product-projections/builtin-product-reusable"].includes(request.url)) {
      response.end(JSON.stringify({ projection: { componentId: "@ontomato/sdk:ObjectList" } }));
    }
    else if (request.url === "/api/product-projections/unwritten") {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "PRODUCT_UNAVAILABLE" } }));
    } else if (request.url === "/api/product-projections/hidden") {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: { message: "Product use Grant required" } }));
    } else if (request.method === "DELETE" && request.url === inlinePanelPath) {
      if (panelInUse) {
        response.statusCode = 409;
        response.end(JSON.stringify({ error: { code: "PRODUCT_IN_USE", message: "Panel is still in use" } }));
      } else {
        inlineRecords.delete(inlinePanelPath);
        response.end(JSON.stringify(deletedPanel));
      }
    } else if (request.url.startsWith("/api/product-projections/") && request.url.endsWith("/used-by")) {
      response.end(JSON.stringify(projectionUsage));
    } else if (request.url === inlinePanelPath || request.url.startsWith("/api/product-projections/")) {
      const kind = request.url === inlinePanelPath ? "panel" : "projection";
      const existing = inlineRecords.get(request.url);
      if (request.method === "PUT" && !(kind === "panel" && rejectInlinePanel) && body.revision === (existing?.revision ?? 0)) {
        const record = { ...body, revision: body.revision + 1, editable: true };
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
    else if (request.url === applicationRecordPath) response.end(JSON.stringify({ success: true, data: identity }));
    else if (request.url === applicationPath && request.method === "DELETE") {
      response.statusCode = 204;
      response.end();
    } else if (request.url === identityPath && request.method === "PUT") {
      identity = body;
      response.end(JSON.stringify({ success: true, data: identity }));
    } else if (request.url === usesPath) response.end(JSON.stringify({ success: true, data: { panelUses: [] } }));
    else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Unexpected request" }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "ontomato-panel-check-"));
  const run = (...args) => promisify(execFile)(process.execPath, ["agent-skills/ontomato-app-builder/scripts/ontomato.mjs", ...args, "--workspace", workspaceId], {
    env: { ...process.env, ONTOMATO_WORKBENCH_URL: base, ONTOMATO_ONTOLOGY_URL: base + "/owner",
      ONTOMATO_API_KEY: "author-key" },
  });
  try {
    const catalog = await run("sdk", "read", "components.json");
    assert.equal(JSON.parse(catalog.stdout).version, sdkVersion);
    const preview = JSON.parse((await run("panel", "preview", ref)).stdout);
    assert.deepEqual(preview, source);
    const input = { ...preview.panel, name: "Acceptance", description: "", visibility: "private" };
    const application = { entry: { path: "/applications/app-acceptance/manage", renderer: "panels" }, panelUses: [] };
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
    await assert.rejects(run("panel", "register", JSON.stringify({
      panels: [{ id: "acceptance-panel", mode: "update", revision: 7, input }],
      applications: [{ id: "acceptance", mode: "create", input: application }],
    })), error => error.stderr.includes("Application ID must start with app-"));
    assert.equal(requests.splice(0).filter(([method]) => method === "PUT").length, 0);
    const renamed = { applications: [{ id: "app-acceptance", mode: "update", input: {
      ...application, declaration: { names: { en: "Renamed" } },
    } }] };
    await run("panel", "register", JSON.stringify(renamed));
    assert.deepEqual(requests.splice(0).filter(([, url]) => url === identityPath), [
      ["PUT", identityPath, { names: { en: "Renamed" }, descriptions: { en: "Keep the description" }, icon: "settings" }, "author-key"],
    ]);
    const identityMaterial = { applications: [{ id: "app-acceptance", mode: "update", input: {
      ...application, declaration: { names: { en: "Updated" }, icon: "folder" },
    } }] };
    await run("panel", "register", JSON.stringify(identityMaterial));
    assert.deepEqual(requests.splice(0).slice(2).map(([method, url, body]) => [method, url, body]), [
      ["GET", applicationRecordPath, undefined],
      ["PUT", usesPath, application],
      ["PUT", identityPath, { names: { en: "Updated" }, descriptions: { en: "Keep the description" }, icon: "folder" }],
    ]);
    await run("panel", "register", JSON.stringify(identityMaterial));
    assert.deepEqual(requests.splice(0).slice(2).map(([method, url]) => [method, url]), [
      ["GET", applicationRecordPath], ["PUT", usesPath],
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

    const manifest = { members: { tasks: { target: { projectionId: "tasks" } } }, state: {} };
    await writeFile(join(directory, "panel.json"), JSON.stringify({ manifest }));
    const layout = join(directory, "panel.html");
    const tasksTemplate = '<div id="app"><projection slot="tasks"></projection></div>';
    await writeFile(layout, tasksTemplate);
    const moduleFile = join(directory, "panel.mjs");
    await writeFile(moduleFile, panel.content.module);
    const offlineSdk = join(directory, "sdk");
    await mkdir(offlineSdk);
    await writeFile(join(offlineSdk, "sdk.json"), JSON.stringify({ version: sdkVersion, check: "check.mjs", components: "components.json" }));
    await writeFile(join(offlineSdk, "check.mjs"), checkModule);
    await writeFile(join(offlineSdk, "components.json"), JSON.stringify(catalogue));
    const oldChecker = checkModule.replace("export const domainProductIdSchema", "const domainProductIdSchema");
    await writeFile(join(offlineSdk, "check.mjs"), oldChecker);
    const offlineUnchecked = JSON.parse((await run("panel", "check", directory, "--sdk-dir", offlineSdk)).stdout);
    assert.equal(offlineUnchecked.typeTableChecked, false);
    assert.deepEqual(offlineUnchecked.unchecked, [{ kind: "projection", id: "tasks" }]);
    await writeFile(join(offlineSdk, "check.mjs"), checkModule);
    const builtin = join(directory, "builtin");
    await mkdir(builtin);
    const builtinFile = join(builtin, "panel.json");
    const builtinRegistration = join(builtin, "registration.json");
    const registrationBody = { panels: [{ id: "builtin-product-catalogue", mode: "create", input: {} }] };
    await writeFile(builtinRegistration, JSON.stringify(registrationBody));
    const builtinManifest = { ...manifest, members: {
      catalogue: { component: "ObjectList", type: "platform:ReviewQueue", data: { rows: "query" } },
      reuse: { target: { projectionId: "builtin-product-reusable" } },
    } };
    await writeFile(builtinFile, JSON.stringify({ manifest: builtinManifest }));
    const prepared = JSON.parse((await run("panel", "check", builtin, "--builtin", "--sdk-dir", offlineSdk)).stdout);
    const builtinId = prepared.assigned.catalogue;
    assert.match(builtinId, /^builtin-product-[0-9a-f-]{36}$/u);
    assert.equal(prepared.panelId, registrationBody.panels[0].id);
    const published = JSON.parse(await readFile(builtinFile, "utf8"));
    assert.equal(published.manifest.members.catalogue.id, builtinId);
    assert.deepEqual(published.manifest.members.reuse, builtinManifest.members.reuse);
    published.manifest.members.renamed = published.manifest.members.catalogue;
    delete published.manifest.members.catalogue;
    await writeFile(builtinFile, JSON.stringify(published));
    const unchanged = JSON.parse((await run("panel", "check", builtin, "--builtin", "--sdk-dir", offlineSdk)).stdout);
    assert.deepEqual(unchanged.assigned, {});
    assert.equal(JSON.parse(await readFile(builtinFile, "utf8")).manifest.members.renamed.id, builtinId);
    const chart = JSON.stringify({ manifest: { ...builtinManifest, members: {
      chart: { component: "MetricChart", sourceCard: { dashboardId: "domain-dashboard", cardId: "card" } },
    } } });
    await writeFile(builtinFile, chart);
    await assert.rejects(run("panel", "check", builtin, "--builtin", "--sdk-dir", offlineSdk), error =>
      error.stderr.includes("manifest.members.chart.id") && error.stderr.includes("takes its projection definition from the source card"));
    assert.equal(await readFile(builtinFile, "utf8"), chart);
    await writeFile(builtinFile, JSON.stringify(published));
    await assert.rejects(run("panel", "check", builtin, "--sdk-dir", offlineSdk), error =>
      error.stderr.includes("builtin-product-catalogue") && error.stderr.includes("reserved for platform products"));
    const trialMaterial = join(builtin, "trial.json");
    await writeFile(trialMaterial, JSON.stringify({ panels: [{ ...registrationBody.panels[0], id: "trial-panel" }] }));
    await assert.rejects(run("panel", "check", builtin, "--material", trialMaterial, "--sdk-dir", offlineSdk), error =>
      error.stderr.includes("Member renamed") && error.stderr.includes("reserved for platform products"));
    assert.deepEqual(requests, []);
    await assert.rejects(run("panel", "register", JSON.stringify(registrationBody)), error =>
      error.stderr.includes("builtin-product-catalogue") && error.stderr.includes("reserved for platform products"));
    assert.equal(requests.splice(0).every(([method]) => method === "GET"), true);
    await writeFile(join(directory, "panel.json"), JSON.stringify({ manifest: { ...manifest, members: { reuse: builtinManifest.members.reuse } } }));
    await run("panel", "check", directory);
    assert.equal(requests.splice(0).some(([method, url]) =>
      method === "GET" && url === "/api/product-projections/builtin-product-reusable"), true);
    await writeFile(join(directory, "panel.json"), JSON.stringify({ manifest }));
    const checked = await run("panel", "check", directory);
    assert.equal(checked.stderr,
      "Action legacy-action is unavailable. Stored function is missing\n" +
      "Action bad-action (ReviewQueue) is unavailable. target: invalid field\n" +
      "Customer type catalogue is unavailable. Object type catalogue permission required\n");
    assert.deepEqual(JSON.parse(checked.stdout), { status: "valid", version: sdkVersion, digest: release.digest, typeTableChecked: true, unchecked: [] });
    assert.deepEqual(new Map(requests.splice(0).map(([method, url]) => [url, method])), new Map([
      ["/api/apps-sdk/current", "GET"], [`${sdkPath}/node/panel-check.mjs`, "GET"],
      [`${sdkPath}/components.json`, "GET"], ["/api/app-builder/type-table", "GET"], [projectionPath, "GET"],
    ]));
    const typeId = "platform:ReviewQueue";
    const { reads, ...metadata } = typeTable.objectTypes[typeId];
    const type = await run("panel", "type", typeId);
    assert.deepEqual(JSON.parse(type.stdout), { id: typeId, reads: {
      query: { ...reads.query, resultSchema: typeTable.resultSchemas.panelRecordQuery },
      counts: { ...reads.counts, resultSchema: typeTable.resultSchemas.panelGroupCounts },
      record: { ...reads.record, resultSchema: typeTable.resultSchemas.panelRecord },
    }, ...metadata });
    const typeReadRequests = [
      ["GET", "/api/apps-sdk/current"], ["GET", `${sdkPath}/node/panel-check.mjs`], ["GET", "/api/app-builder/type-table"],
    ];
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), typeReadRequests);
    const singleRead = await run("panel", "type", typeId, "--read", "counts");
    assert.deepEqual(JSON.parse(singleRead.stdout), {
      id: typeId, read: "counts", ...reads.counts, resultSchema: typeTable.resultSchemas.panelGroupCounts,
    });
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), typeReadRequests);
    const allTypes = await run("panel", "type", "--all");
    assert.deepEqual(JSON.parse(allTypes.stdout), typeTable);
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), typeReadRequests);
    const currentPackage = await run("sdk", "package", installedPackage.name);
    assert.deepEqual(JSON.parse(currentPackage.stdout), installedPackage);
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), [
      ...typeReadRequests.slice(0, 2), ["GET", installedPackagePath],
    ]);
    await writeFile(moduleFile, 'import { ElButton } from "element-plus";');
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("panel.mjs: A panel's module imports element-plus"));
    await writeFile(moduleFile, panel.content.module);
    const badIconFile = join(directory, "bad-icon.json");
    const badIcon = structuredClone(identityMaterial);
    badIcon.applications[0].input.declaration.icon = "graph";
    await writeFile(badIconFile, JSON.stringify(badIcon));
    await assert.rejects(run("panel", "check", directory, "--material", badIconFile), error =>
      error.stderr.includes("application app-acceptance: declaration.icon 'graph' is not available"));
    await assert.rejects(run("panel", "register", JSON.stringify(badIcon)), error =>
      error.stderr.includes("application app-acceptance: declaration.icon 'graph' is not available"));
    badIcon.applications[0].mode = "create";
    badIcon.applications[0].input.initialOpenEntryIds = [];
    badIcon.applications[0].input.declaration.icon = "settings";
    await writeFile(badIconFile, JSON.stringify(badIcon));
    await assert.rejects(run("panel", "check", directory, "--material", badIconFile), error =>
      error.stderr.includes("application app-acceptance: declaration.icon 'settings' is not available for a domain application"));
    const icons = await run("sdk", "icons");
    assert.deepEqual(JSON.parse(icons.stdout), ["app-window", "folder", "calendar"]);
    assert.equal(requests.splice(0).some(([method]) => method !== "GET"), false);
    await rm(moduleFile);
    const noModuleCheck = await run("panel", "check", directory);
    assert.equal(JSON.parse(noModuleCheck.stdout).status, "valid");
    await writeFile(moduleFile, panel.content.module);
    assert.equal(requests.some(([method]) => method !== "GET"), false);
    requests.length = 0;
    const draft = join(directory, "manager");
    const scaffold = await run("panel", "scaffold", "platform:AgentDefinition", draft, "--id", "app-template-two-entry", "--operation", "platform:AgentDefinition.save");
    const readJson = async file => JSON.parse(await readFile(file, "utf8"));
    const scaffoldApp = await readJson(join(draft, "application.json"));
    assert.equal(JSON.parse(scaffold.stdout).entry, scaffoldApp.entry.path);
    assert.equal(requests.some(([method]) => method !== "GET"), false);
    assert.equal(JSON.parse((await run("panel", "check", draft)).stdout).status, "valid");
    await assert.rejects(run("panel", "register", draft), error =>
      error.stderr.includes("Publish application source through the Application Builder page"));
    assert.equal(requests.some(([method]) => method !== "GET"), false);

    const review = join(directory, "review");
    await run("panel", "scaffold", "platform:ReviewQueue", review, "--operation", "reviews.approve", "--batch", "reviews.approve");
    const reviewApp = await readJson(join(review, "application.json"));
    const [reviewCatalog, reviewDetail] = reviewApp.panelUses.map(({ panelId }) => join(review, "panels", panelId));
    const reviewPanel = join(reviewCatalog, "panel.json");
    const reviewDescriptor = await readJson(reviewPanel);
    const { manifest: reviewManifest } = reviewDescriptor;
    const { manifest: detailManifest } = await readJson(join(reviewDetail, "panel.json"));
    assert.equal(detailManifest.state.search.type.type, "string");
    const batchId = reviewManifest.members.batch2.target.projectionId;
    const batchPath = join(review, "projections", batchId + ".json");
    const batch = await readJson(batchPath);
    assert.equal(batch.operations.approve.operation.id, "reviews.approve");
    assert.equal(reviewManifest.members.batch2.inputs.review.state, "checked");
    await run("panel", "check", review);
    reviewManifest.members.batch2.inputs.review.state = "search";
    await writeFile(reviewPanel, JSON.stringify(reviewDescriptor));
    await assert.rejects(run("panel", "check", review), error =>
      error.stderr.includes("bind operation approve (reviews.approve)"));
    reviewManifest.members.batch2.inputs.review.state = "checked";
    await writeFile(reviewPanel, JSON.stringify(reviewDescriptor));
    batch.operations.approve.operation.id = "reviews.undeclared";
    await writeFile(batchPath, JSON.stringify(batch));
    await assert.rejects(run("panel", "check", review), error =>
      error.stderr.includes("operation approve (reviews.undeclared) is not declared"));

    // The legacy registration validator is still exercised with a legacy input fixture.
    const detailDir = join(directory, "legacy-detail");
    await mkdir(detailDir);
    const detailId = scaffoldApp.panelUses.at(-1).panelId;
    const { name, description, visibility, ...legacyDescriptor } = await readJson(join(draft, "panels", detailId, "panel.json"));
    await writeFile(join(detailDir, "panel.json"), JSON.stringify(legacyDescriptor));
    await writeFile(join(detailDir, "panel.html"), await readFile(join(draft, "panels", detailId, "panel.html")));
    const projectionsDir = join(draft, "projections");
    const projections = await Promise.all((await readdir(projectionsDir)).map(async file => ({
      id: file.slice(0, -5), mode: "create", input: await readJson(join(projectionsDir, file)),
    })));
    await writeFile(join(detailDir, "registration.json"), JSON.stringify({
      panels: [{ id: detailId, mode: "create", input: { name, description, visibility } }],
      applications: [{ id: "app-template-two-entry", mode: "create", input: scaffoldApp }],
      projections,
    }));

    const detailMaterialFile = join(detailDir, "registration.json");
    const detailMaterial = JSON.parse(await readFile(detailMaterialFile, "utf8"));
    const [app] = detailMaterial.applications;
    const { declaration, initialOpenEntryIds, ...updateInput } = app.input;
    app.mode = "update";
    app.input = updateInput;
    requests.length = 0;
    for (const [key, value] of Object.entries({
      initialOpenEntryIds, entryAccess: ["domain-member"], groups: declaration.groups, permissions: [],
    })) {
      await writeFile(detailMaterialFile, JSON.stringify({
        ...detailMaterial, applications: [{ ...app, input: { ...updateInput, [key]: value } }],
      }));
      for (const command of ["check", "register"]) {
        await assert.rejects(run("panel", command, detailDir), error =>
          error.stderr.includes(`Application update does not accept ${key}`) && error.stderr.includes("optional framePanelId"));
      }
    }
    assert.equal(requests.filter(([method]) => method === "PUT").length, 0);

    await writeFile(detailMaterialFile, JSON.stringify({
      ...detailMaterial,
      applications: [{
        ...app,
        input: {
          ...updateInput,
          panelUses: updateInput.panelUses.map((use, index) => index === 0 ? { ...use, pageComposer: "inline" } : use),
        },
      }],
    }));
    await assert.rejects(run("panel", "check", detailDir), error =>
      error.stderr.includes("panelUses[0].pageComposer 'inline' must be 'bottom' or 'none'"));
    await writeFile(detailMaterialFile, JSON.stringify({
      ...detailMaterial,
      applications: [{
        ...app,
        input: {
          ...updateInput,
          panelUses: updateInput.panelUses.map((use, index) => index === 0 ? { ...use, pageComposer: "none" } : use),
        },
      }],
    }));
    assert.equal(JSON.parse((await run("panel", "check", detailDir)).stdout).status, "valid");

    // A panel mounting AgentChat must declare pageComposer: "none" on its application entry.
    const chatDir = join(directory, "chat-app");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "panel.html"), '<div id="app"><projection slot="chat"></projection></div>\n');
    await writeFile(join(chatDir, "panel.mjs"), 'import { mountPanel } from "@ontomato/sdk/panel"; mountPanel({});\n');
    await writeFile(join(chatDir, "panel.json"), JSON.stringify({
      manifest: {
        state: { sessionId: { type: { kind: "scalar", type: "string" }, deepLink: true } },
        members: {
          chat: {
            component: "AgentChat",
            agent: { kind: "preset", agentKind: "regular" },
            state: { sessionId: "sessionId" },
          },
        },
      },
    }));
    const chatRegistration = {
      panels: [{ id: "chat-panel", mode: "create", input: { name: "Chat", description: "", visibility: "domain" } }],
      applications: [{
        id: "app-chat-only",
        mode: "create",
        input: {
          declaration: { names: { en: "Chat" }, descriptions: { en: "Chat" }, groups: [] },
          initialOpenEntryIds: ["chat-use"],
          entry: { path: "/applications/app-chat-only", renderer: "panels" },
          panelUses: [{
            id: "chat-use",
            pageKey: "chat-home",
            panelId: "chat-panel",
            path: "/applications/app-chat-only/home",
            names: { en: "Home" },
          }],
        },
      }],
    };
    await writeFile(join(chatDir, "registration.json"), JSON.stringify(chatRegistration));
    await assert.rejects(run("panel", "check", chatDir), error =>
      error.stderr.includes('mounts AgentChat and must set "pageComposer": "none"'));
    chatRegistration.applications[0].input.panelUses[0].pageComposer = "none";
    await writeFile(join(chatDir, "registration.json"), JSON.stringify(chatRegistration));
    assert.equal(JSON.parse((await run("panel", "check", chatDir)).stdout).status, "valid");

    const detailPanelFile = join(detailDir, "panel.json");
    const detailPanel = JSON.parse(await readFile(detailPanelFile, "utf8"));
    const frameState = { type: { kind: "scalar", type: "string" } };
    detailPanel.manifest.state.term = frameState;
    app.input.framePanelId = detailMaterial.panels[0].id;
    app.input.panelUses[0].inputs = { term: { frameState: "term" } };
    await writeFile(detailMaterialFile, JSON.stringify(detailMaterial));
    await writeFile(detailPanelFile, JSON.stringify(detailPanel));
    const frameError = error => error.stderr.includes('references frameState "term"') && error.stderr.includes('"external": true');
    await assert.rejects(run("panel", "check", detailDir), frameError);
    frameState.external = true;
    await writeFile(detailPanelFile, JSON.stringify(detailPanel));
    assert.equal(JSON.parse((await run("panel", "check", detailDir)).stdout).status, "valid");

    app.input.framePanelId = "inline-panel";
    await writeFile(detailMaterialFile, JSON.stringify(detailMaterial));
    inlineRecords.set(inlinePanelPath, { manifest: { state: { term: { type: frameState.type } }, members: {} } });
    await assert.rejects(run("panel", "check", detailDir), frameError);
    inlineRecords.get(inlinePanelPath).manifest.state.term.external = true;
    assert.equal(JSON.parse((await run("panel", "check", detailDir)).stdout).status, "valid");
    inlineRecords.delete(inlinePanelPath);

    requests.length = 0;
    await writeFile(layout, tasksTemplate);
    const reference = async id => {
      manifest.members.tasks.target.projectionId = id;
      await writeFile(join(directory, "panel.json"), JSON.stringify({ manifest }));
    };
    const registration = join(directory, "registration.json");
    const localMaterial = { projections: [{
      id: "draft-list", mode: "create", input: { componentId: "@ontomato/sdk:ObjectList", config: {} },
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

    delete localMaterial.projections[0].input.config;
    await writeFile(registration, JSON.stringify(localMaterial));
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("projection draft-list: config: required field is missing") && !error.stderr.includes("Expected chart"));

    const authorProjection = { component: "PanelData", type: "platform:AgentDefinition", data: { agents: "list" } };
    manifest.members.tasks = authorProjection;
    const descriptor = join(directory, "panel.json");
    await writeFile(descriptor, JSON.stringify({ manifest }));
    const item = { id: "inline-panel", mode: "create", input: { name: "Inline", description: "", visibility: "private" } };
    await writeFile(registration, JSON.stringify({ panels: [item] }));
    requests.length = 0;
    await run("panel", "check", directory);
    assert.equal(requests.splice(0).some(([method, url]) => method !== "GET" || url.includes("/product-")), false);
    assert.equal(await readFile(descriptor, "utf8"), JSON.stringify({ manifest }));

    authorProjection.type = "platform:ReviewQueue";
    authorProjection.data.agents = "query";
    await writeFile(descriptor, JSON.stringify({ manifest }));
    await assert.rejects(run("panel", "check", directory), error =>
      error.stderr.includes("data.agents returns 'panelRecordQuery'") && error.stderr.includes("accepts panelRecordList"));
    authorProjection.type = "platform:AgentDefinition";
    authorProjection.data.agents = "list";
    await writeFile(descriptor, JSON.stringify({ manifest }));

    rejectInlinePanel = true;
    await assert.rejects(run("panel", "register", directory), error => error.stderr.includes("panel inline-panel: PUT"));
    const savedSource = JSON.parse(await readFile(descriptor, "utf8"));
    const savedMember = savedSource.manifest.members.tasks;
    assert.match(savedMember.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
    const inlineProjectionId = savedMember.id;
    const inlineProjectionPath = `/api/product-projections/${inlineProjectionId}`;
    assert.deepEqual(savedMember, { ...authorProjection, id: inlineProjectionId });
    const projection = inlineRecords.get(inlineProjectionPath);
    assert.deepEqual(projection.data, { agents: {
      source: { type: { kind: "PlatformObjectType", id: "platform:AgentDefinition" } }, read: "list", params: {},
    } });
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
    await writeFile(layout, '<div id="app"><projection slot="renamedTasks"></projection></div>');
    await writeFile(registration, JSON.stringify({ panels: [{ ...item, mode: "update", revision: 1 }] }));
    await run("panel", "register", directory);
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url, body]) => [url, body.revision]), [
      [inlineProjectionPath, 4], [inlinePanelPath, 1],
    ]);
    assert.equal(inlineRecords.get(inlineProjectionPath).name, "Renamed");
    assert.deepEqual(inlineRecords.get(inlinePanelPath).manifest.members.renamedTasks.target, { projectionId: inlineProjectionId });
    assert.equal(inlineRecords.size, 2);

    const member = savedSource.manifest.members.renamedTasks;
    const forgetId = async () => {
      delete member.id;
      await writeFile(descriptor, JSON.stringify(savedSource));
      await writeFile(registration, JSON.stringify({
        panels: [{ ...item, mode: "update", revision: inlineRecords.get(inlinePanelPath).revision }],
      }));
    };
    await forgetId();
    await run("panel", "register", directory);
    assert.equal(JSON.parse(await readFile(descriptor, "utf8")).manifest.members.renamedTasks.id, inlineProjectionId);
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url]) => url), [inlinePanelPath]);
    assert.equal(inlineRecords.get(inlineProjectionPath).revision, 5);

    member.description = "Updated list";
    await forgetId();
    const edited = await run("panel", "register", directory);
    assert.ok(edited.stdout.includes(`Updated projection ${inlineProjectionId}`));
    assert.equal(JSON.parse(await readFile(descriptor, "utf8")).manifest.members.renamedTasks.id, inlineProjectionId);
    assert.deepEqual(requests.splice(0).filter(([method]) => method === "PUT").map(([, url, body]) => [url, body.revision]), [
      [inlineProjectionPath, 5], [inlinePanelPath, 3],
    ]);
    assert.deepEqual(projectionReuseGuards, ["inline-panel"]);

    member.description = "Local changes to a shared list";
    await forgetId();
    projectionUsage = { panels: [...projectionUsage.panels, { id: "another-panel", name: "Another page" }], hiddenCount: 1 };
    await assert.rejects(run("panel", "register", directory), error =>
      error.stderr.includes("renamedTasks") && error.stderr.includes(`shared projection '${inlineProjectionId}'`) &&
      error.stderr.includes("Another page (another-panel)") && error.stderr.includes("1 panel(s) you cannot view") &&
      error.stderr.includes(`id: "${inlineProjectionId}"`) && error.stderr.includes("rename"));
    assert.equal(requests.splice(0).some(([method]) => method === "PUT"), false);
    assert.equal(JSON.parse(await readFile(descriptor, "utf8")).manifest.members.renamedTasks.id, undefined);

    const editable = inlineRecords.get(inlineProjectionPath);
    inlineRecords.set(inlineProjectionPath, { ...editable, editable: false });
    await assert.rejects(run("panel", "register", directory), error =>
      error.stderr.includes("renamedTasks") && error.stderr.includes(`no edit Grant for projection '${inlineProjectionId}'`) &&
      error.stderr.includes("Rename the member"));
    assert.equal(requests.splice(0).some(([method]) => method === "PUT"), false);
    inlineRecords.set(inlineProjectionPath, editable);


    const chartPanel = JSON.stringify({ manifest: {
      state: { window: { type: { kind: "scalar", type: "string" } } },
      members: { chart: { component: "MetricChart", sourceCard: chartSource, state: { range: "window" } } },
    } });
    await writeFile(descriptor, chartPanel);
    await writeFile(layout, '<div id="app"><projection slot="chart"></projection></div>');
    await writeFile(registration, JSON.stringify({
      panels: [{ ...item, mode: "update", revision: inlineRecords.get(inlinePanelPath).revision }],
    }));
    const unregistered = JSON.parse((await run("panel", "check", directory)).stdout);
    assert.deepEqual(unregistered.unchecked, [{
      kind: "chart-source", member: "chart", ...chartSource,
      reason: "Chart input types can be checked after the owner registers this source card",
    }]);
    assert.deepEqual(requests.splice(0).filter(([method, url]) => method !== "GET" || url.includes("/product-"))
      .map(([method, url]) => [method, url]), [["GET", chartQuery]]);

    await run("panel", "register", directory);
    assert.deepEqual(requests.splice(0).filter(([method]) => method !== "GET").map(([method, url, body]) =>
      [method, url, method === "POST" ? body : body.manifest.members.chart]), [
      ["POST", chartPath, chartSource],
      ["PUT", inlinePanelPath, { target: { projectionId: chartProjection.id }, inputs: { range: { state: "window" } } }],
    ]);
    assert.equal(await readFile(descriptor, "utf8"), chartPanel);

    const registered = JSON.parse((await run("panel", "check", directory)).stdout);
    assert.deepEqual(registered.unchecked, []);
    assert.deepEqual(requests.splice(0).filter(([method, url]) => method !== "GET" || url.includes("/product-"))
      .map(([method, url]) => [method, url]), [["GET", chartQuery], ["GET", storedChartPath]]);

    await assert.rejects(run("panel", "delete", "panel", "inline-panel"),
      error => error.stderr.includes("PRODUCT_IN_USE") && error.stderr.includes("Panel is still in use"));
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), [
      ["DELETE", inlinePanelPath],
    ]);
    const applicationDelete = await run("panel", "delete", "application", "app-acceptance");
    assert.deepEqual(JSON.parse(applicationDelete.stdout), { kind: "application", id: "app-acceptance", success: true });
    panelInUse = false;
    const panelDelete = await run("panel", "delete", "panel", "inline-panel");
    assert.deepEqual(JSON.parse(panelDelete.stdout), { kind: "panel", id: "inline-panel", ...deletedPanel });
    assert.equal(inlineRecords.has(inlinePanelPath), false);
    assert.deepEqual(requests.splice(0).map(([method, url]) => [method, url]), [
      ["DELETE", applicationPath], ["DELETE", inlinePanelPath],
    ]);

    await t.test("inline forms require their own operation or a sibling draft binding", async () => {
      const form = {
        component: "ObjectForm", type: "platform:AgentDefinition",
        data: { createForm: "createForm" }, config: { actions: "none" },
      };
      const operation = "platform:AgentDefinition.save";
      const save = { component: "PanelData", type: form.type, operation };
      const formHtml = '<div id="app"><projection slot="form"></projection></div>';
      await writeFile(layout, formHtml);
      await writeFile(join(builtin, "panel.html"), formHtml);
      for (const [dir, file, args] of [
        [directory, descriptor, []],
        [builtin, builtinFile, ["--builtin", "--sdk-dir", offlineSdk]],
      ]) {
        const writeMembers = members => writeFile(file, JSON.stringify({ manifest: { state: {}, members } }));
        await writeMembers({ form });
        await assert.rejects(run("panel", "check", dir, ...args), error =>
          error.stderr.includes("panel.json: member form: ObjectForm requires an operation"));
        await writeMembers({ form: { ...form, operations: {} } });
        await assert.rejects(run("panel", "check", dir, ...args), error =>
          error.stderr.includes("panel.json: member form: ObjectForm requires an operation"));

        for (const members of [
          { form: { ...form, operation } },
          { form: { ...form, operations: { save: operation } } },
          { form, save: { ...save, draft: "form" } },
          { form, save: { component: save.component, type: save.type, operations: { save: { operation, draft: "form" } } } },
          { form, save: {
            target: { projectionId: dir === builtin ? "builtin-product-reusable" : "tasks" },
            operationDrafts: { save: { slot: "form" } },
          } },
        ]) {
          await writeMembers(members);
          await run("panel", "check", dir, ...args);
        }
      }
    });
  } finally {
    await rm(directory, { recursive: true });
    await new Promise(resolve => server.close(resolve));
  }
});

test("App Builder uses the single save -> trial -> publish Action lifecycle without legacy authoring steps", async () => {
  const definition = { name: "Action", function: { code: "print('ok')" } };
  const sample = { objDatas: [{ className: "task", rows: [{ id: "t-1" }] }], relDatas: [], vectorDatas: [] };
  const parameters = { task_id: "t-1" };
  const requests = [];
  let publishAttempt = 0;
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push({ path: request.url, body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/ontology/action/save") {
      response.end(JSON.stringify({ success: true, data: { id: "saved", status: "PENDING_REVIEW" } }));
    } else if (request.url === "/ontology/action/trial") {
      if (body.id === "invalid") {
        response.end(JSON.stringify({ success: false, code: "ACTION_TRIAL_INVALID", message: "bad sample" }));
      } else if (body.parameters?.fail) {
        response.end(JSON.stringify({
          success: true,
          data: { trialId: "tr-2", actionId: body.id, status: "FAILED", passed: false, error: "boom", trialStatus: "failed" },
        }));
      } else {
        response.end(JSON.stringify({
          success: true,
          data: { trialId: "tr-1", actionId: body.id, status: "PASSED", passed: true, result: "{\"completed\":true}", error: null, trialStatus: "passed" },
        }));
      }
    } else if (request.url === "/ontology/action/setStatus") {
      publishAttempt += 1;
      const refusals = [
        { id: "saved", outcome: "refusal", code: "ACTION_EXPLANATION_REQUIRED", error: { message: "Explanation missing" } },
        { id: "saved", outcome: "refusal", code: "ACTION_TRIAL_REQUIRED", error: { message: "Trial required" } },
        { id: "saved", outcome: "success", data: { id: "saved", status: "PUBLISHED" } },
      ];
      response.end(JSON.stringify({ success: true, data: { items: [refusals[publishAttempt - 1]] } }));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const run = (...args) => promisify(execFile)(process.execPath, [
      "agent-skills/ontomato-app-builder/scripts/ontomato.mjs", "action", ...args,
    ], { env: { ...process.env, ONTOMATO_ONTOLOGY_URL: base + "/ontology", ONTOMATO_API_KEY: "save-key" } });

    const saved = await run("save", JSON.stringify(definition));
    assert.equal(JSON.parse(saved.stdout).status, "PENDING_REVIEW");
    await assert.rejects(run("generate", "--save", JSON.stringify(definition)), /usage: scripts\/ontomato\.mjs/);
    await assert.rejects(run("publish", "saved"), /ACTION_EXPLANATION_REQUIRED/);
    await assert.rejects(run("publish", "saved"), /ACTION_TRIAL_REQUIRED/);

    const pureTrial = await run("trial", "saved");
    assert.equal(JSON.parse(pureTrial.stdout).passed, true);
    const fullTrial = await run("trial", "saved", "--sample", JSON.stringify(sample), "--parameters", JSON.stringify(parameters));
    assert.equal(JSON.parse(fullTrial.stdout).trialStatus, "passed");
    await assert.rejects(run("trial", "saved", "--parameters", JSON.stringify({ fail: true })), error => {
      assert.equal(JSON.parse(error.stdout).passed, false);
      assert.equal(JSON.parse(error.stdout).error, "boom");
      return true;
    });
    await assert.rejects(run("trial", "invalid"), /ACTION_TRIAL_INVALID: bad sample/);

    const published = await run("publish", "saved");
    assert.equal(JSON.parse(published.stdout).status, "PUBLISHED");
    assert.deepEqual(requests, [
      { path: "/ontology/action/save", body: definition },
      { path: "/ontology/action/setStatus", body: { ids: ["saved"], status: "PUBLISHED" } },
      { path: "/ontology/action/setStatus", body: { ids: ["saved"], status: "PUBLISHED" } },
      { path: "/ontology/action/trial", body: { id: "saved" } },
      { path: "/ontology/action/trial", body: { id: "saved", sample, parameters } },
      { path: "/ontology/action/trial", body: { id: "saved", parameters: { fail: true } } },
      { path: "/ontology/action/trial", body: { id: "invalid" } },
      { path: "/ontology/action/setStatus", body: { ids: ["saved"], status: "PUBLISHED" } },
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("process-admin and workflow-maker clients call single POST /action/trial and surface failures", async () => {
  const sample = { objDatas: [{ className: "ticket", rows: [{ id: "tk-1" }] }], relDatas: [], vectorDatas: [] };
  const parameters = { ticket_id: "tk-1" };
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    response.setHeader("content-type", "application/json");
    if (request.url === "/ontology/user/getCur") {
      response.end(JSON.stringify({ success: true, data: { id: "u-1", loginCode: "admin", domainId: "d-1" } }));
    } else if (request.url === "/ontology/action/trial") {
      requests.push({ path: request.url, body });
      if (body.id === "refused") {
        response.end(JSON.stringify({ success: false, code: "ACTION_TRIAL_FORBIDDEN", message: "forbidden" }));
      } else if (body.parameters?.fail) {
        response.end(JSON.stringify({ success: true, data: { trialId: "tr-f", actionId: body.id, status: "FAILED", passed: false, error: "bad python", trialStatus: "failed" } }));
      } else {
        response.end(JSON.stringify({ success: true, data: { trialId: "tr-ok", actionId: body.id, status: "PASSED", passed: true, result: "{\"completed\":true}", error: null, trialStatus: "passed" } }));
      }
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, ONTOMATO_ONTOLOGY_URL: base + "/ontology", ONTOMATO_TK: "test-token" };
    const runClient = (script, ...args) => promisify(execFile)(process.execPath, [script, ...args], { env });

    const adminClient = "agent-skills/ontomato-process-admin/client.mjs";
    const wfClient = "agent-skills/ontomato-workflow-maker/wf-client.mjs";

    const adminOk = await runClient(adminClient, "action-trial", "act-1", JSON.stringify({ sample, parameters }));
    assert.equal(JSON.parse(adminOk.stdout).passed, true);
    await assert.rejects(runClient(adminClient, "action-trial", "act-1", JSON.stringify({ parameters: { fail: true } })), error => {
      assert.equal(JSON.parse(error.stdout).passed, false);
      return true;
    });
    await assert.rejects(runClient(adminClient, "action-trial", "refused"), /ACTION_TRIAL_FORBIDDEN/);
    await assert.rejects(runClient(adminClient, "action-trial", "act-1", JSON.stringify({ ticket_id: "tk-1" })), /仅接受 sample 和 parameters/);

    const wfOk = await runClient(wfClient, "action-trial", "act-2");
    assert.equal(JSON.parse(wfOk.stdout).passed, true);
    await assert.rejects(runClient(wfClient, "action-trial", "act-2", JSON.stringify({ parameters: { fail: true } })), error => {
      assert.equal(JSON.parse(error.stdout).passed, false);
      return true;
    });
    await assert.rejects(runClient(wfClient, "action-trial", "refused"), /ACTION_TRIAL_FORBIDDEN/);

    assert.deepEqual(requests, [
      { path: "/ontology/action/trial", body: { id: "act-1", sample, parameters } },
      { path: "/ontology/action/trial", body: { id: "act-1", parameters: { fail: true } } },
      { path: "/ontology/action/trial", body: { id: "refused" } },
      { path: "/ontology/action/trial", body: { id: "act-2" } },
      { path: "/ontology/action/trial", body: { id: "act-2", parameters: { fail: true } } },
      { path: "/ontology/action/trial", body: { id: "refused" } },
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("standalone MetricView authoring closes its window when a bound query package fails", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
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
    if (request.url.endsWith("/gates")) response.end(JSON.stringify({ runId }));
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
      "agent-skills/ontomato-app-builder/scripts/ontomato.mjs", "metric-view", "generate", "--save",
      "--workspace", "workspace", JSON.stringify(definition),
    ], { env: { ...process.env, ONTOMATO_SKILL_SCENARIO: "external", ONTOMATO_RUN_ID: "",
      ONTOMATO_AUTHORING_URL: "", ONTOMATO_EXECUTION_CALLBACK: "", ONTOMATO_WORKBENCH_URL: base,
      ONTOMATO_ONTOLOGY_URL: base + "/ontology", ONTOMATO_API_KEY: "external-key" } }), /Sample query failed/);
    const root = "/ontology/ontology/ai/generation";
    const trial = `${root}/${runId}/authoring/metric-view/test`;
    assert.deepEqual(requests, [
      { path: root + "/gates", method: "POST", context: undefined, body: { kind: "metric" } },
      { path: trial, method: "POST", context: undefined, body: { queryPackage: definition.function.queryPackage } },
      { path: trial, method: "POST", context: undefined, body: { queryPackage: { manifest: { parameterDefs: [{ name: "count", value: 2 }] } } } },
      { path: `${root}/${runId}/close`, method: "POST", context: undefined, body: {} },
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
