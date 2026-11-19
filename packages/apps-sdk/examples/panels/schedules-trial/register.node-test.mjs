import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const ROOT = join(HERE, "..", "..", "..", "..", "..");

const SDK = "4.1.9-dev." + "a".repeat(64);
const panelPaths = [
  "/api/product-panels/panel-schedules-trial",
  "/api/product-panels/panel-schedules-summary",
];

const notFound = (response) => {
  response.writeHead(403, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "PRODUCT_FORBIDDEN", message: "Product use Grant required" } }));
};
const conflict = (response) => {
  response.writeHead(409, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "PRODUCT_CONFLICT", message: "Definition changed; reload before saving" } }));
};

function platform({ held = new Map(), existingApplications = false } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ method: request.method, url: request.url, body: parsed, credential: request.headers.tk });
      const answer = (status, value) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      const path = request.url;
      if (path === `/apps-sdk/${SDK}/sdk.json`) return answer(200, { version: SDK });
      if (path.includes("/platform/applications/")) {
        if (request.method === "GET") return existingApplications
          ? answer(200, { success: true, data: { panelUses: [] } }) : answer(404, {});
        return answer(200, { success: true, data: { panelUses: parsed.panelUses } });
      }
      const collection = path.startsWith("/api/product-projections/") ? "projection" : "panel";
      if (request.method === "GET") {
        const current = held.get(decodeURIComponent(path));
        // A definition nothing holds is refused for want of its use grant, before it is looked up at all.
        return current ? answer(200, { [collection]: { ...current, id: decodeURIComponent(path) } }) : notFound(response);
      }
      if (request.method === "PUT") {
        const id = decodeURIComponent(path);
        const current = held.get(id);
        if (current && parsed.revision === 0) return conflict(response);
        if (current && parsed.revision !== current.revision) return conflict(response);
        const revision = parsed.revision === 0 ? 1 : parsed.revision + 1;
        held.set(id, { ...parsed, revision });
        return answer(200, { [collection]: { ...parsed, id, revision } });
      }
      return answer(405, { error: { code: "METHOD_NOT_ALLOWED", message: "not here" } });
    });
  });
  return { requests, server, held };
}

/** Runs the script against an address, and answers with what it printed and how it ended. */
async function script(base, args) {
  try {
    const { stdout } = await run(process.execPath, [
      "--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs",
      join(HERE, "register.mjs"),
      "--base", base,
      ...args,
    ], { cwd: ROOT });
    return { stdout, error: null };
  } catch (failure) {
    return { stdout: failure.stdout ?? "", error: failure };
  }
}

/** Runs the script against a listening stand-in, and stops the stand-in afterwards. */
async function register(args, stand) {
  await new Promise((resolve) => stand.server.listen(0, "127.0.0.1", resolve));
  const { port } = stand.server.address();
  try {
    return await script(`http://127.0.0.1:${port}`, args);
  } finally {
    stand.server.close();
  }
}

test("registers the trial's projections, panels and applications in that order", async () => {
  const stand = platform();
  const { error } = await register(["--mode", "create", "--sdk-version", SDK, "--token", "a-credential"], stand);
  assert.equal(error, null, String(error?.stderr ?? ""));
  const { requests } = stand;
  const uses = requests.filter((request) => request.method === "PUT" && request.url.includes("/platform/applications/"))
    .flatMap((request) => request.body.panelUses);
  assert.deepEqual(uses.map(use => [use.path, use.names]), [
    ["/applications/app-panels-trial-a/tasks", { en: "Scheduled tasks", "zh-CN": "定时任务" }],
    ["/applications/app-panels-trial-b/tasks", { en: "Scheduled tasks", "zh-CN": "定时任务" }],
    ["/applications/app-panels-trial-b/summary", { en: "Task summary", "zh-CN": "任务摘要" }],
  ]);
  assert.ok(uses.every((use) => !Object.hasOwn(use, "skill")));

  const writes = requests.filter((request) => request.method === "PUT").map((request) => request.url);
  assert.deepEqual(
    writes.filter((url) => url.startsWith("/api/product-projections/")).map(decodeURIComponent),
    [
      "/api/product-projections/projection-schedules-summary",
      "/api/product-projections/projection-schedules-tasks",
      "/api/product-projections/projection-schedules-form",
      "/api/product-projections/projection-schedules-run",
    ],
  );
  assert.deepEqual(
    writes.filter((url) => url.startsWith("/api/product-panels/")).map(decodeURIComponent),
    ["/api/product-panels/panel-schedules-trial", "/api/product-panels/panel-schedules-summary"],
  );
  assert.deepEqual(
    writes.filter((url) => url.includes("/platform/applications/")).map(decodeURIComponent),
    [
      "/api/data-query/platform/applications/app-panels-trial-a/panel-uses",
      "/api/data-query/platform/applications/app-panels-trial-b/panel-uses",
    ],
  );
  // Every request carries the credential given on the command line, and none of them carries it in its body.
  assert.ok(requests.every((request) => request.credential === "a-credential"));
  assert.ok(requests.every((request) => !JSON.stringify(request.body ?? {}).includes("a-credential")));
  const productRequests = requests.filter((request) => request.url.startsWith("/api/product"));
  assert.ok(productRequests.every((request) => request.method === "PUT" && request.body.revision === 0));
  assert.ok(productRequests.filter((request) => request.url.startsWith("/api/product-panels/"))
    .every((request) => request.body.sdkVersion === SDK));
});

test("snapshots the pre-upgrade revisions and uses them without reading the legacy panels after the upgrade", async () => {
  const stand = platform({ held: new Map(panelPaths.map(path => [path, { revision: 3 }])), existingApplications: true });
  const snapshot = await register(["--mode", "snapshot"], stand);
  assert.equal(snapshot.error, null, String(snapshot.error?.stderr ?? ""));
  assert.deepEqual(stand.requests.map(({ method, url }) => [method, url]), panelPaths.map(path => ["GET", path]));
  assert.ok(stand.requests.every((request) => request.credential === undefined));
  stand.requests.length = 0;

  const { error } = await register(["--mode", "update", "--sdk-version", SDK, "--revisions", snapshot.stdout], stand);
  assert.equal(error, null, String(error?.stderr ?? ""));
  const writes = stand.requests.filter(request => request.method === "PUT");
  assert.deepEqual(writes.slice(0, 2).map(({ url, body }) => [url, body.revision]), panelPaths.map(path => [path, 3]));
  assert.ok(stand.requests.filter(request => request.method === "GET").every(request => !request.url.startsWith("/api/")));
  assert.equal(writes.length, 4);
  for (const { body } of writes.slice(2)) {
    assert.equal(Object.hasOwn(body, "declaration"), false);
    assert.equal(Object.hasOwn(body, "entryAccess"), false);
  }
});

test("stops at a stale owner revision, preserving the completed item and exposing the conflict", async () => {
  const stand = platform({
    held: new Map([[panelPaths[0], { revision: 3 }], [panelPaths[1], { revision: 4 }]]),
    existingApplications: true,
  });
  const revisions = JSON.stringify({ "panel-schedules-trial": 3, "panel-schedules-summary": 3 });
  const { stdout, error } = await register(["--mode", "update", "--sdk-version", SDK, "--revisions", revisions], stand);
  assert.equal(error?.code, 1);
  assert.match(stdout, /panel panel-schedules-trial/);
  assert.match(error.stderr, /panel panel-schedules-summary.*409.*PRODUCT_CONFLICT/);
  assert.deepEqual(stand.requests.filter(request => request.url.startsWith("/api")).map(({ method, url }) => [method, url]),
    panelPaths.map(path => ["PUT", path]));
  assert.equal(stand.held.get(panelPaths[0]).revision, 4);
  assert.equal(stand.held.get(panelPaths[1]).revision, 4);
});

test("does not update an occupied application in create mode", async () => {
  const stand = platform({ existingApplications: true });
  const { error } = await register(["--mode", "create", "--sdk-version", SDK], stand);
  assert.equal(error?.code, 1);
  assert.match(error.stderr, /application app-panels-trial-a.*already exists/);
  assert.deepEqual(stand.requests.filter(request => request.url.includes("/platform/applications/")).map(request => request.method), ["GET"]);
});

test("refuses before it sends anything when the token file names no file", async () => {
  const stand = platform();
  // No server is listening: if the script got as far as a request, this test would fail for the wrong reason.
  const { error } = await script("http://127.0.0.1:1", ["--mode", "create", "--sdk-version", SDK, "--token-file", join(HERE, "no-such-token-file")]);
  assert.notEqual(error, null);
  assert.equal(stand.requests.length, 0);
  assert.match(String(error?.stderr ?? ""), /ENOENT/);
});
