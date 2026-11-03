import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

test("Object View CLI discovers assets and reports an unpublished dependency as failure", async () => {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    calls.push({ path: request.url, body: text ? JSON.parse(text) : null });
    response.setHeader("Content-Type", "application/json");
    const data = request.url.endsWith("/list") ? { views: [{ className: "Order", revision: 4 }] }
      : request.url.endsWith("/resolve") ? {
        revision: 4, document: { tabs: [] },
        dependencies: { metricViews: ["summary"], actions: [], skills: [], classes: ["Order"] },
      }
      : request.url.endsWith("/queryById") ? { status: "PENDING_REVIEW", function: { parameters: [] } }
      : ["Order"];
    response.end(JSON.stringify({ success: true, data }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const run = async args => {
    const child = spawn(process.execPath, ["agent-skills/ontomato-app-builder/ontomato.mjs", "object-view", ...args], {
      env: { ...process.env, ONTOMATO_URL: `http://127.0.0.1:${server.address().port}` },
    });
    let output = "", error = "";
    child.stdout.on("data", chunk => output += chunk);
    child.stderr.on("data", chunk => error += chunk);
    const [code] = await once(child, "close");
    return { code, output, error };
  };
  try {
    const listed = await run(["list", "Order"]);
    assert.equal(listed.code, 0, listed.error);
    assert.equal(JSON.parse(listed.output).views[0].revision, 4);
    const validated = await run(["validate", "Order", "--revision", "4"]);
    assert.equal(validated.code, 1, validated.error);
    assert.equal(JSON.parse(validated.output).valid, false);
    assert.match(JSON.parse(validated.output).issues[0], /not published/);
    assert.deepEqual(calls.find(call => call.path.endsWith("/resolve")).body, { className: "Order", form: "full", revision: 4 });
    assert.ok(calls.every(call => !call.path.endsWith("/execute")));
  } finally {
    server.close();
    await once(server, "close");
  }
});
