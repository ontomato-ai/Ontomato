import assert from "node:assert/strict";
import console from "node:console";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piPlugin } from "/app/packages/agent-runtime/src/adapters/pi/index.ts";
import { openSessionSandbox } from "/app/packages/agent-runtime/src/sandbox/launch.ts";
import { codeLimitsSchema } from "/app/packages/contracts/src/agent-runtime-code.ts";

const prompt = "Reply with PI ready";
const answer = "PI ready";
const model = "pi-smoke-model";
const token = "pi-smoke-lease";
const root = await mkdtemp(join(tmpdir(), "ontomato-pi-smoke-"));
const requests = [];
const gateway = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  requests.push({ path: request.url, authorization: request.headers.authorization,
    body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (delta, finish_reason) => response.write("data: " + JSON.stringify({
    id: "pi-smoke", object: "chat.completion.chunk", created: 1, model,
    choices: [{ index: 0, delta, finish_reason }],
  }) + "\n\n");
  emit({ role: "assistant", content: answer }, null);
  emit({}, "stop");
  response.end("data: [DONE]\n\n");
}).listen(0, "127.0.0.1");

let sandbox;
try {
  await once(gateway, "listening");
  const endpoint = { host: "127.0.0.1", port: gateway.address().port };
  const limits = codeLimitsSchema.parse({});
  sandbox = await openSessionSandbox({
    uid: 20001, sessionDirectory: root, skills: [],
    endpoints: { gateway: endpoint, callback: endpoint },
    processCount: limits.processCount, fileBytes: limits.fileBytes,
  });
  const signal = AbortSignal.timeout(30000);
  const engine = await piPlugin.open({
    sessionId: "pi-smoke", domainId: "pi-smoke", engineRef: null, previousContext: null,
    sandbox, directories: sandbox.directories,
    model: { baseUrl: sandbox.gatewayBaseUrl, token, model, contextWindow: 16000, maxOutputTokens: 256 },
    prompt: { system: "Answer only with the requested text." },
    tools: [], engineTools: false, limits, language: "en", signal,
  });
  const events = [];
  const consumed = [];
  const result = await engine.startTurn({
    runId: "pi-smoke", context: null,
    inputs: [{ id: "smoke-input", message: { role: "user", content: prompt, timestamp: Date.now() }, context: null }],
    host: {
      async emit(event) { events.push(event); },
      async consumed(id) { consumed.push(id); },
      async invokeTool() { throw new Error("Unexpected tool in the PI image smoke test"); },
    },
  }, signal);
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.deepEqual(consumed, ["smoke-input"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/chat/completions");
  assert.equal(requests[0].authorization, "Bearer " + token);
  assert.equal(requests[0].body.model, model);
  assert.ok(JSON.stringify(requests[0].body.messages).includes(prompt));
  const reply = events.find(event => event.type === "message_end" && event.message.role === "assistant");
  assert.deepEqual(reply.message.content, [{ type: "text", text: answer }]);
  console.log("PI extension loaded and returned a reply inside nsjail");
} finally {
  await sandbox?.stop();
  gateway.closeAllConnections();
  await new Promise(resolve => gateway.close(resolve));
  await rm(root, { recursive: true, force: true });
}
