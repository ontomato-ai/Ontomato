import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import type {
  HarnessEvent, HarnessOpenRequest, HarnessProcess, HarnessSession, HarnessTurnHost, HarnessTurnInput,
} from "../adapters/contract";
import { randomUUID } from "node:crypto";
import { HarnessRegistry } from "../adapters/registry";
import type { ModelGatewayClient } from "../gateway-client";
import { resolvedModel } from "../model";
import { SessionEngines } from "../session-engines";
import type { RuntimeStore } from "../store";
import { piPlugin } from "../adapters/pi";
import { PiEvents } from "../adapters/pi/events";
import { deferred } from "../adapters/pi/transport";

const program = fileURLToPath(new URL("../adapters/pi/import.mjs", import.meta.url));
const text = (value: string) => ({ type: "text" as const, text: value });
const user = (value: string): RuntimeMessage => ({ role: "user", content: value, timestamp: Date.now() });
const input = (id: string, value: string, context: string | null = null): HarnessTurnInput =>
  ({ id, message: user(value), context });
const declaration = {
  name: "platform_probe",
  description: "Invoke the platform.",
  parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
};

interface ChatRequest {
  model: string;
  messages: { role: string; content: string | { text: string }[] | null; tool_call_id?: string; reasoning_content?: string }[];
  tools: { function: { name: string } }[];
  max_completion_tokens?: number;
  max_tokens?: number;
}

type Reply =
  | { status: "answer" | "length" | "error"; text: string }
  | { status: "tool"; name: string; id: string; args: object };

function gateway(reply: (request: ChatRequest, index: number) => Reply) {
  const requests: ChatRequest[] = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body: ChatRequest = JSON.parse(Buffer.concat(chunks).toString());
      expect(incoming.url).toBe("/v1/chat/completions");
      expect(incoming.headers.authorization).toBe("Bearer test-lease");
      requests.push(body);
      const next = reply(body, requests.length - 1);
      if (next.status === "error") {
        outgoing.writeHead(400, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: { message: next.text } }));
        return;
      }
      outgoing.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (choices: object[], usage?: object) => outgoing.write("data: " + JSON.stringify({
        id: `response-${requests.length}`, object: "chat.completion.chunk", created: 1,
        model: body.model, choices, usage,
      }) + "\n\n");
      emit([{ index: 0, delta: { role: "assistant", reasoning_content: "considering" }, finish_reason: null }]);
      const delta = next.status === "tool"
        ? { tool_calls: [{
            index: 0, id: next.id, type: "function",
            function: { name: next.name, arguments: JSON.stringify(next.args) },
          }] }
        : { content: next.text };
      emit([{ index: 0, delta, finish_reason: null }]);
      emit([{ index: 0, delta: {}, finish_reason: next.status === "tool" ? "tool_calls" : next.status === "length" ? "length" : "stop" }]);
      emit([], { prompt_tokens: 25, completion_tokens: 9, total_tokens: 34 });
      outgoing.end("data: [DONE]\n\n");
    } catch (error) {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  return { server, requests };
}

describe("PI 1.4.0 RPC plugin", () => {
  let root: string;
  let directories: HarnessOpenRequest["directories"];
  let server: ReturnType<typeof gateway>["server"];
  let processes: (HarnessProcess & { channel: Duplex })[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pi-plugin-test-"));
    directories = { state: join(root, "state"), workspace: join(root, "work"), skills: [] };
    await Promise.all([mkdir(directories.state), mkdir(directories.workspace)]);
    processes = [];
  });

  afterEach(async () => {
    for (const child of processes) child.kill();
    await Promise.all(processes.map(child => child.exited));
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true });
  });

  async function configure(reply: Parameters<typeof gateway>[0]) {
    const result = gateway(reply);
    server = result.server;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return result.requests;
  }

  function fixtureSandbox(): HarnessOpenRequest["sandbox"] {
    return {
      spawn(command, args, env) {
        expect(command).toBe("/usr/local/bin/node");
        expect(args).toEqual(["/usr/local/lib/ontomato-pi/import.mjs"]);
        expect(JSON.stringify(env)).not.toContain("test-lease");
        const child = spawn(process.execPath, [program], {
          cwd: directories.workspace,
          env: { PATH: process.env.PATH, TMPDIR: root, ...env },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        });
        const handle = {
          stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
          channel: child.stdio[3] as Duplex,
          exited: new Promise<number | null>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
          }),
          kill() { child.kill(); },
        };
        processes.push(handle);
        return handle;
    },
    };
  }

  async function open(overrides: Partial<HarnessOpenRequest> = {}) {
    const session = await piPlugin.open({
      sessionId: "platform-session", domainId: "domain", engineRef: null, previousContext: null,
      directories, model: {
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        token: "test-lease", model: "public-model", contextWindow: 262144, maxOutputTokens: 4096,
      },
      prompt: { system: "Only use platform resources." },
      tools: [declaration], engineTools: true, limits: codeLimitsSchema.parse({}), language: "en",
      signal: new AbortController().signal,
      sandbox: fixtureSandbox(),
      ...overrides,
    });
    return session;
  }

  function host(overrides: Partial<HarnessTurnHost> = {}) {
    const events: HarnessEvent[] = [];
    const consumed: string[] = [];
    const callbacks: HarnessTurnHost = {
      async emit(event) { events.push(event); await overrides.emit?.(event); },
      async consumed(id) { consumed.push(id); await overrides.consumed?.(id); },
      async invokeTool(call) {
        if (!overrides.invokeTool) throw new Error(`Unexpected platform tool ${call.toolName}`);
        return overrides.invokeTool(call);
      },
    };
    return { events, consumed, callbacks };
  }

  function turn(session: HarnessSession, target: ReturnType<typeof host>, ...inputs: HarnessTurnInput[]) {
    return session.startTurn({
      runId: "run", inputs, context: "Initial host context", host: target.callbacks,
    }, new AbortController().signal);
  }

  it("rebuilds uncommitted PI state, preserves workspace files and resumes the committed reference after idle", async () => {
    const requests = await configure(() => ({ status: "answer", text: "From the model" }));
    const gatewayBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const id = randomUUID();
    const scope = { hostId: "host", domainId: "domain" };
    const refs: string[] = [];
    const store = {
      session: async () => ({ workspaceId: null, latestRunId: "run" }),
      sessionEngine: async () => ({ engineRef: refs.at(-1) ?? null }),
      saveEngineRef: async (_scope: unknown, _id: string, ref: string) => { refs.push(ref); },
    } as unknown as RuntimeStore;
    const released = deferred<void>();
    const gateway = {
      lease: async () => ({ id: "lease", token: "test-lease", url: gatewayBaseUrl }),
      release: async () => { released.resolve(); },
    } as unknown as ModelGatewayClient;
    const owner = new SessionEngines(store, root, gateway, new HarnessRegistry([piPlugin]),
      async ({ callback }) => ({
        ...fixtureSandbox(), directories, hostWorkspace: directories.workspace, hostState: directories.state,
        gatewayBaseUrl: gatewayBaseUrl + "/v1", callbackBaseUrl: `http://${callback.host}:${callback.port}`,
        async stop() {},
      }), async (_scope, _id, operation) => operation(), {
        async sessionChannelCommand() {},
        async withBusinessCallback() {},
      }, error => { throw error; });
    const options = {
      config: async () => resolvedModel("public-model", "fixture",
        { apiBase: gatewayBaseUrl, apiKey: "host-only-key", provider: "custom_openai" },
        { type: "chat", connection: "fixture", model: "native-model" }),
      plugin: owner.plugin("pi"),
      skills: [], tools: [declaration],
      prompt: () => ({ system: "Use the test model." }), previousContext: async () => null,
      limits: codeLimitsSchema.parse({}), language: "en", engineTools: false,
      signal: new AbortController().signal,
    };

    try {
      const uncommitted = await open();
      expect(await readFile(join(directories.state, "pi.jsonl"), "utf8")).toContain(uncommitted.engineRef);
      const interruptedProcess = processes.at(-1)!;
      interruptedProcess.kill();
      await interruptedProcess.exited;
      const output = join(directories.workspace, "outputs", "keep.txt");
      await mkdir(join(directories.workspace, "outputs"));
      await writeFile(output, "A workspace artifact");

      const opened = await owner.open(scope, id, options);
      expect(refs).toEqual([opened.handle.engineRef]);
      expect(opened.handle.engineRef).not.toBe(uncommitted.engineRef);
      expect(await readFile(output, "utf8")).toBe("A workspace artifact");
      const first = host();
      expect(await turn(opened.handle, first, input("first", "Keep this context"))).toMatchObject({ stopReason: "stop" });
      expect(first.consumed).toEqual(["first"]);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      owner.idle(scope, id);
      owner.admitted(scope, id);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(owner.needsOpen(scope, id)).toBe(false);
      owner.idle(scope, id);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
      expect(owner.needsOpen(scope, id)).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      await released.promise;

      const resumed = await owner.open(scope, id, options);
      expect(resumed.handle.engineRef).toBe(opened.handle.engineRef);
      expect(await turn(resumed.handle, host(), input("second", "Use earlier context"))).toMatchObject({ stopReason: "stop" });
      expect(JSON.stringify(requests.at(-1)?.messages)).toContain("Keep this context");

      owner.idle(scope, id);
      await owner.delivered(scope, id, "older-run", async () => false);
      await owner.delivered(scope, id, "run", async () => true);
      expect(owner.needsOpen(scope, id)).toBe(false);
      await owner.delivered(scope, id, "run", async () => false);
      expect(owner.needsOpen(scope, id)).toBe(true);
    } finally {
      vi.useRealTimers();
      await owner.close();
    }
  });

  it("opens persisted native state, resumes the same ref and declarations, and rejects missing state", async () => {
    const requests = await configure(() => ({ status: "answer", text: "Done" }));
    const session = await open();
    expect(await readFile(join(directories.state, "pi.jsonl"), "utf8")).toContain(session.engineRef);
    await session.close();
    expect(await processes[0]!.exited).toBe(0);

    const resumed = await open({ engineRef: session.engineRef, tools: [{ ...declaration, name: "new_tool" }] });
    expect(resumed.engineRef).toBe(session.engineRef);
    expect((await turn(resumed, host(), input("resume", "continue"))).stopReason).toBe("stop");
    expect(requests[0]!.tools.map(tool => tool.function.name)).toContain("platform_probe");
    expect(requests[0]!.tools.map(tool => tool.function.name)).not.toContain("new_tool");
    await resumed.close();

    await rm(join(directories.state, "pi.jsonl"));
    await expect(open({ engineRef: session.engineRef })).rejects.toThrow(/ENOENT/);
  }, 15000);

  it("keeps product sessions on platform tools after reopening", async () => {
    const requests = await configure(() => ({ status: "answer", text: "Done" }));
    const session = await open({ engineTools: false });
    expect((await turn(session, host(), input("first", "List the available tools"))).stopReason).toBe("stop");
    await session.close();

    const resumed = await open({ engineRef: session.engineRef, engineTools: true });
    expect((await turn(resumed, host(), input("resume", "List the tools again"))).stopReason).toBe("stop");
    await resumed.close();

    expect(requests.map(request => request.tools.map(tool => tool.function.name)))
      .toEqual([[declaration.name], [declaration.name]]);
  }, 15000);

  it("awaits platform tool start and result, streams messages and usage, and consumes steer only at the next step", async () => {
    const requests = await configure((_request, index) => index === 0
      ? { status: "tool", name: declaration.name, id: "call_platform", args: { value: "first" } }
      : { status: "answer", text: "Finished" });
    const atStart = deferred<void>();
    const journalStart = deferred<void>();
    const invoked = deferred<void>();
    const toolResult = deferred<void>();
    const atEnd = deferred<void>();
    const journalEnd = deferred<void>();
    let invokedCount = 0;
    const target = host({
      async emit(event) {
        if (event.type === "tool_execution_start") {
          atStart.resolve();
          await journalStart.promise;
        }
        if (event.type === "tool_execution_end") {
          atEnd.resolve();
          await journalEnd.promise;
        }
      },
      async invokeTool(call) {
        expect(call.args).toEqual({ value: "first" });
        invokedCount++;
        call.onUpdate({ text: "working", data: { step: 1 } });
        invoked.resolve();
        await toolResult.promise;
        return { isError: false, result: { content: [text("platform result")], details: { data: { finished: true } } } };
      },
    });
    const session = await open();
    const completion = turn(session, target, input("first", "Question"));
    await atStart.promise;
    expect(invokedCount).toBe(0);
    journalStart.resolve();
    await invoked.promise;
    expect(await session.steer(input("inserted", "Question", "Changed context"))).toEqual({ accepted: true });
    expect(target.consumed).toEqual(["first"]);
    toolResult.resolve();
    await atEnd.promise;
    expect(requests).toHaveLength(1);
    expect(target.consumed).toEqual(["first"]);
    journalEnd.resolve();

    expect(await completion).toMatchObject({ stopReason: "stop", unsettledToolCalls: [] });
    expect(target.consumed).toEqual(["first", "inserted"]);
    expect(await session.steer(input("late", "too late"))).toMatchObject({ accepted: false });
    expect(requests[0]).toMatchObject({ model: "public-model", max_completion_tokens: 4096 });
    const messages = requests[1]!.messages;
    expect(messages.map(message => message.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(JSON.stringify(messages[4]!.content)).toMatch(/Changed context.*Question/);
    expect(messages[2]!.reasoning_content).toBe("considering");

    const assistant = target.events.filter((event) =>
      (event.type === "message_start" || event.type === "message_end") && event.message.role === "assistant");
    expect(assistant.map(event => event.type)).toEqual(["message_start", "message_end", "message_start", "message_end"]);
    expect(assistant[0]).toHaveProperty("nativeId", (assistant[1] as { nativeId: string }).nativeId);
    expect(target.events).toContainEqual(expect.objectContaining({
      type: "message_end", message: expect.objectContaining({ role: "assistant", usage: expect.objectContaining({ totalTokens: 34 }) }),
    }));
    expect(target.events.some(event => event.type === "usage_updated")).toBe(false);
    expect(target.events.filter(event => event.type === "turn_start" || event.type === "turn_end"))
      .toEqual([{ type: "turn_start" }, { type: "turn_end" }, { type: "turn_start" }, { type: "turn_end" }]);
    expect(target.events).toContainEqual(expect.objectContaining({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", id: "call_platform", toolName: declaration.name, contentIndex: 1 },
    }));
    expect(target.events).toContainEqual(expect.objectContaining({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_end", content: "considering", contentIndex: 0 },
    }));
    expect(target.events).toContainEqual(expect.objectContaining({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end", contentIndex: 1,
        toolCall: { type: "toolCall", id: "call_platform", name: declaration.name, arguments: { value: "first" } },
      },
    }));
    expect(target.events.filter(event => event.type === "message_update").every(event => !("message" in event))).toBe(true);
    expect(target.events).toContainEqual(expect.objectContaining({
      type: "tool_execution_update", partialResult: { text: "working", data: { step: 1 } },
    }));
    expect(target.events).toContainEqual(expect.objectContaining({
      type: "tool_execution_end", isError: false,
      result: { content: [text("platform result")], details: { data: { finished: true } } },
    }));
    await session.close();
  }, 15000);

  it("gates native file effects on the same awaited tool hook", async () => {
    await configure((_request, index) => index === 0
      ? { status: "tool", name: "write", id: "call_write", args: { path: "marker.txt", content: "native write" } }
      : { status: "answer", text: "Written" });
    const atStart = deferred<void>();
    const release = deferred<void>();
    const target = host({
      async emit(event) {
        if (event.type !== "tool_execution_start") return;
        atStart.resolve();
        await release.promise;
      },
    });
    const session = await open();
    const completion = turn(session, target, input("first", "Write a file"));
    await atStart.promise;
    const marker = join(directories.workspace, "marker.txt");
    expect(existsSync(marker)).toBe(false);
    release.resolve();
    expect((await completion).stopReason).toBe("stop");
    expect(await readFile(marker, "utf8")).toBe("native write");
    await session.close();
  }, 15000);

  it("interrupts a platform call, leaves it unsettled, and resumes without replay", async () => {
    const requests = await configure((_request, index) => index === 0
      ? { status: "tool", name: declaration.name, id: "call_abort", args: { value: "running" } }
      : { status: "answer", text: "Resumed" });
    const invoked = deferred<void>();
    const target = host({
      async invokeTool(call) {
        invoked.resolve();
        await once(call.signal, "abort");
        throw call.signal.reason;
      },
    });
    const session = await open();
    const completion = turn(session, target, input("first", "Start"));
    await invoked.promise;
    expect(await session.steer(input("queued", "queued during the call"))).toEqual({ accepted: true });
    await session.interrupt("test abort");
    expect(await completion).toMatchObject({
      stopReason: "aborted",
      unsettledToolCalls: [{ toolCallId: "call_abort" }],
    });
    expect(target.consumed).toEqual(["first"]);
    expect(target.events.some(event => event.type === "tool_execution_end")).toBe(false);
    await session.close();

    const resumed = await open({ engineRef: session.engineRef });
    const newTurn = host();
    expect((await turn(resumed, newTurn, input("resume", "Continue"))).stopReason).toBe("stop");
    expect(newTurn.events.some(event => event.type === "tool_execution_start")).toBe(false);
    expect(requests[1]!.messages).toContainEqual(expect.objectContaining({
      role: "tool", tool_call_id: "call_abort", content: expect.stringContaining("outcome is unknown"),
    }));
    await resumed.close();
  }, 15000);

  it("reports an invocation rejected without a result as unsettled and makes no further model request", async () => {
    const requests = await configure(() => ({
      status: "tool", name: declaration.name, id: "call_rejected", args: { value: "execute" },
    }));
    const session = await open();
    const target = host({ async invokeTool() { throw new Error("Tool request disconnected"); } });
    expect(await turn(session, target, input("first", "Call the tool"))).toMatchObject({
      stopReason: "error", errorMessage: "Tool request disconnected", unsettledToolCalls: [{ toolCallId: "call_rejected" }],
    });
    expect(target.events.some(event => event.type === "tool_execution_end")).toBe(false);
    expect(requests).toHaveLength(1);
    await session.close();
  }, 15000);

  it("stops native bash during execution and reports its missing result", async () => {
    await configure(() => ({
      status: "tool", name: "bash", id: "call_bash",
      args: { command: "sleep 60 & echo $!; wait" },
    }));
    const running = deferred<number>();
    const target = host({
      async emit(event) {
        if (event.type === "tool_execution_update" && /^\d+$/.test(event.partialResult.text.trim()))
          running.resolve(Number(event.partialResult.text));
      },
    });
    const session = await open();
    const completion = turn(session, target, input("first", "Start a command"));
    const pid = await running.promise;
    await session.interrupt(null);
    expect(await completion).toMatchObject({
      stopReason: "aborted",
      unsettledToolCalls: [{ toolCallId: "call_bash" }],
    });
    const ps = spawn("ps", ["-o", "stat=", "-p", String(pid)]);
    let status = "";
    ps.stdout.setEncoding("utf8").on("data", chunk => { status += chunk; });
    const [exit] = await once(ps, "close");
    expect(exit === 1 || status.trim().startsWith("Z")).toBe(true);
    await session.close();
  }, 15000);

  it("returns an explicit model failure without retrying it", async () => {
    const requests = await configure(() => ({ status: "error", text: "Gateway rejected this model request" }));
    const session = await open();
    const result = await turn(session, host(), input("first", "Fail"));
    expect(result).toMatchObject({
      stopReason: "error", errorMessage: expect.stringContaining("Gateway rejected this model request"),
    });
    expect(requests).toHaveLength(1);
    await session.close();
  }, 15000);

  it("imports older context once before open returns and sends it with a resumed prompt", async () => {
    const requests = await configure(() => ({ status: "length", text: "Cut short" }));
    const interrupted: RuntimeMessage[] = JSON.parse(await readFile(new URL("./fixtures/interrupted-history.json", import.meta.url), "utf8"));
    const session = await open({ previousContext: [user("Old context lifted from storage"), ...interrupted] });
    await session.close();
    const resumed = await open({ engineRef: session.engineRef });
    expect(await turn(resumed, host(), input("new", "Continue the old turn"))).toMatchObject({ stopReason: "length" });
    expect(JSON.stringify(requests[0]!.messages)).toContain("Old context lifted from storage");
    await resumed.close();
  }, 15000);

  it("discovers only the mounted skills and passes the explicit system prompt", async () => {
    const requests = await configure(() => ({ status: "answer", text: "Done" }));
    const selected = join(root, "selected", "selected-probe");
    const external = join(directories.workspace, ".pi", "skills", "unselected-probe");
    await Promise.all([mkdir(selected, { recursive: true }), mkdir(external, { recursive: true })]);
    const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} description\n---\n# Probe\n`;
    await Promise.all([
      writeFile(join(selected, "SKILL.md"), skill("selected-probe")),
      writeFile(join(external, "SKILL.md"), skill("unselected-probe")),
    ]);
    const session = await open({ directories: { ...directories, skills: [{ name: "selected-probe", directory: selected }] } });
    expect((await turn(session, host(), input("start", "Choose skill"))).stopReason).toBe("stop");
    const system = JSON.stringify(requests[0]!.messages[0]!.content);
    expect(system).toContain("Only use platform resources.");
    expect(system).toContain("selected-probe");
    expect(system).not.toContain("unselected-probe");
    await session.close();
  }, 15000);
});

it("maps native compaction and extension diagnostics with stable keys", async () => {
  const emitted: HarnessEvent[] = [];
  const events = new PiEvents({ emit: async event => { emitted.push(event); } } as HarnessTurnHost);
  await events.detail({ type: "compaction_start", reason: "overflow" });
  await events.detail({ type: "compaction_end", aborted: true, errorMessage: "Summary request was cancelled" });
  await events.detail({ type: "extension_error", event: "tool_call", error: "No callback" });
  expect(emitted).toEqual([
    expect.objectContaining({ detail: expect.objectContaining({ category: "compaction", key: "compaction:1", status: "started" }) }),
    expect.objectContaining({ detail: expect.objectContaining({ category: "compaction", key: "compaction:1", status: "completed", text: "Context compaction interrupted. Summary request was cancelled" }) }),
    expect.objectContaining({ detail: expect.objectContaining({ category: "diagnostic", text: expect.stringContaining("No callback") }) }),
  ]);
});
