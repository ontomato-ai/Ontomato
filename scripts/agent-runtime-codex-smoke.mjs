import assert from "node:assert/strict";
import console from "node:console";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexPlugin } from "/app/packages/agent-runtime/src/adapters/codex/index.ts";
import { ModelGatewayClient } from "/app/packages/agent-runtime/src/gateway-client.ts";
import { ModelGatewayProcess } from "/app/packages/agent-runtime/src/gateway-process.ts";
import { openSessionSandbox } from "/app/packages/agent-runtime/src/sandbox/launch.ts";
import { codeLimitsSchema } from "/app/packages/contracts/src/agent-runtime-code.ts";

const prompt = "Reply with Codex ready";
const answer = "Codex ready";
const model = "codex-smoke-model";
const upstreamModel = "deepseek-chat";
const root = await mkdtemp(join(tmpdir(), "ontomato-codex-smoke-"));
const requests = [];
const upstream = createServer(async (request, response) => {
  const chunks = await Array.fromAsync(request);
  requests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (delta, finish_reason) => response.write("data: " + JSON.stringify({
    id: "codex-smoke", object: "chat.completion.chunk", created: 1, model: upstreamModel,
    choices: [{ index: 0, delta, finish_reason }],
  }) + "\n\n");
  emit({ role: "assistant", content: answer }, null);
  emit({}, "stop");
  response.end("data: [DONE]\n\n");
}).listen(0, "127.0.0.1");

let sandbox;
let gateway;
try {
  await once(upstream, "listening");
  gateway = await ModelGatewayProcess.start("python3");
  const client = new ModelGatewayClient(gateway.addresses.controlUrl, gateway.addresses.dataUrl);
  const lease = await client.lease({
    [model]: {
      litellm_params: {
        model: "deepseek/" + upstreamModel,
        api_base: `http://127.0.0.1:${upstream.address().port}/v1`,
        api_key: "fixture", timeout: 10, max_retries: 0,
      },
      model_info: { mode: "chat" },
    },
  });
  const data = new URL(gateway.addresses.dataUrl);
  const limits = codeLimitsSchema.parse({});
  sandbox = await openSessionSandbox({
    uid: 20001, sessionDirectory: root, skills: [],
    endpoints: {
      gateway: { host: data.hostname, port: Number(data.port) },
      callback: { host: "127.0.0.1", port: upstream.address().port },
    },
    processCount: limits.processCount, fileBytes: limits.fileBytes,
  });
  const signal = AbortSignal.timeout(30000);
  const engine = await codexPlugin.open({
    sessionId: "codex-smoke", domainId: "codex-smoke", engineRef: null, previousContext: null,
    sandbox, directories: sandbox.directories,
    model: { baseUrl: sandbox.gatewayBaseUrl, token: lease.token, model, contextWindow: 16000, maxOutputTokens: null },
    prompt: { system: "Answer only with the requested text." },
    tools: [], engineTools: true, limits, language: "en", signal,
  });
  const consumed = [];
  const events = [];
  const result = await engine.startTurn({
    runId: "codex-smoke", context: null,
    inputs: [{ id: "smoke-input", message: { role: "user", content: prompt, timestamp: Date.now() }, context: null }],
    host: {
      async emit(event) { events.push(event); },
      async consumed(id) { consumed.push(id); },
      async invokeTool() { throw new Error("Unexpected tool in the Codex image smoke test"); },
    },
  }, signal);
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.deepEqual(consumed, ["smoke-input"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/chat/completions");
  assert.equal(requests[0].body.model, upstreamModel);
  assert.ok(JSON.stringify(requests[0].body.messages).includes(prompt));
  const reply = events.find(event => event.type === "message_end" && event.message.role === "assistant" && event.message.phase === "answer");
  assert.deepEqual(reply.message.content, [{ type: "text", text: answer }]);
  await client.release(lease);
  console.log("Codex returned a reply through the Chat-only gateway inside nsjail");
} finally {
  await sandbox?.stop();
  await gateway?.stop();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  await rm(root, { recursive: true, force: true });
}
