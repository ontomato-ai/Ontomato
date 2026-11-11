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
