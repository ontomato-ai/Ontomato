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
 * A body the platform would refuse fails in the script first, so this test is what keeps the two in step: it asserts the
 * requests, not the script's own reading of them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

/** The platform's answers: nothing exists yet, then every write succeeds and the use relations come back as sent. */
function platform() {
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
      if (request.method === "GET") return answer(404, { error: { code: "PRODUCT_UNAVAILABLE", message: "not registered yet" } });
      if (request.url.includes("/platform/applications/")) return answer(200, { data: { panelUses: parsed.panelUses } });
      return answer(200, { ok: true });
    });
  });
  return { requests, server };
}

test("registers the trial's projections, panels and applications in that order", async () => {
  const { requests, server } = platform();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(process.execPath, [
      "--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs",
      join(HERE, "register.mjs"),
      "--base", `http://127.0.0.1:${port}`,
      "--token", "a-credential",
    ], { cwd: join(HERE, "..", "..", "..", "..", "..") });
  } finally {
    server.close();
  }

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
});

test("sends bodies the platform's own contracts accept", async () => {
  const { requests, server } = platform();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(process.execPath, [
      "--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs",
      join(HERE, "register.mjs"),
      "--base", `http://127.0.0.1:${port}`,
      "--token-file", "/dev/stdin",
    ].slice(0, 6), { cwd: join(HERE, "..", "..", "..", "..", "..") });
  } catch {
    // The credential file names no file: the script must refuse before it sends anything.
  } finally {
    server.close();
  }
  assert.equal(requests.length, 0);
});
