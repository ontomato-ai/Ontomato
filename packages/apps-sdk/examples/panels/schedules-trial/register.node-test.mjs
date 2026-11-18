import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

/*
 * The trial's registration script, against a server that answers as the platform does: every body it sends is one the
 * contracts accept, and the order is the order the definitions have to exist in — the projections the panels name, then
 * the panels, then the applications whose use relations name those panels.
 *
 * The answers are the platform's own, code for code, because the mistakes this catches are in the reading of them:
 *
 * - A read of an ID nothing holds is 403 `PRODUCT_FORBIDDEN`, not 404: the use grant is checked before the definition is
 *   looked up, and an ID never registered has no grant. A script that reads first and takes 404 for "not registered yet"
 *   therefore fails on a real platform while passing against a server that answers 404.
 * - A revision-0 write over an ID something holds is 409 `PRODUCT_CONFLICT`, and that is how a definition that exists is
 *   told apart from one that does not. The write is where the answer is, so the script asks with a write.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const ROOT = join(HERE, "..", "..", "..", "..", "..");

const notFound = (response) => {
  response.writeHead(403, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "PRODUCT_FORBIDDEN", message: "Product use Grant required" } }));
};
const conflict = (response) => {
  response.writeHead(409, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "PRODUCT_CONFLICT", message: "Definition changed; reload before saving" } }));
};

/**
 * The platform, holding the definitions it was given. `held` is what already exists before the script runs: `{}` is a
 * first run, and a map with entries is a platform that has them at the revisions given. A revision-0 write over an ID in
 * it is refused, as the platform refuses it.
 */
function platform({ held = new Map() } = {}) {
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
      // The applications are Java's: their use relations come back as sent.
      if (path.includes("/platform/applications/")) return answer(200, { data: { panelUses: parsed.panelUses } });
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
  const { error } = await register(["--token", "a-credential"], stand);
  assert.equal(error, null, String(error?.stderr ?? ""));
  const { requests } = stand;
  const uses = requests.filter((request) => request.url.includes("/platform/applications/"))
    .flatMap((request) => request.body.panelUses);
  assert.ok(uses.length > 0);
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
  // Nothing existing: every product is created, and no read is needed to find that out.
  assert.deepEqual(
    requests.filter((request) => request.method === "GET").map((request) => request.url),
    [],
  );
  assert.ok(requests.filter((request) => request.url.startsWith("/api/product")).every((request) => request.method === "PUT" && request.body.revision === 0));
});

test("replaces what already exists, reading its revision only after a create is refused", async () => {
  // The projections and panels are already there, as a second run on a platform that has them finds them.
  const stand = platform();
  const ids = [
    "/api/product-projections/projection-schedules-summary",
    "/api/product-projections/projection-schedules-tasks",
    "/api/product-projections/projection-schedules-form",
    "/api/product-projections/projection-schedules-run",
    "/api/product-panels/panel-schedules-trial",
    "/api/product-panels/panel-schedules-summary",
  ];
  ids.forEach((id) => stand.held.set(id, { revision: 3 }));

  const { error } = await register(["--token", "a-credential"], stand);
  assert.equal(error, null, String(error?.stderr ?? ""));

  for (const id of ids) {
    const forId = stand.requests.filter((request) => request.url === id);
    // A create is tried first and refused, then the revision is read, then the write is repeated with it.
    assert.deepEqual(forId.map((request) => [request.method, request.body?.revision]), [
      ["PUT", 0],
      ["GET", undefined],
      ["PUT", 3],
    ], id);
    // The platform now holds what the script last sent.
    assert.equal(stand.held.get(id).revision, 4, id);
  }
});

test("sends no credential header when none is given, as the anonymous platform expects", async () => {
  const stand = platform();
  const { error } = await register([], stand);
  assert.equal(error, null, String(error?.stderr ?? ""));
  assert.ok(stand.requests.length > 0);
  // The open-source platform has no login token: the requests go out without one rather than with an empty one.
  assert.ok(stand.requests.every((request) => request.credential === undefined));
});

test("refuses before it sends anything when the token file names no file", async () => {
  const stand = platform();
  // No server is listening: if the script got as far as a request, this test would fail for the wrong reason.
  const { error } = await script("http://127.0.0.1:1", ["--token-file", join(HERE, "no-such-token-file")]);
  assert.notEqual(error, null);
  assert.equal(stand.requests.length, 0);
  assert.match(String(error?.stderr ?? ""), /ENOENT/);
});
