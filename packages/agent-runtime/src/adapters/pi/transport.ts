import { createInterface } from "node:readline";
import type { Duplex, Readable } from "node:stream";
import { z } from "zod";
import {
  runtimeJsonObjectSchema, runtimeJsonValueSchema,
} from "@ontomato/contracts/agent-runtime-values";
import {
  runtimeImageSchema, runtimeTextSchema,
} from "@ontomato/contracts/agent-runtime-messages";
import { NativeSessionMissing, type HarnessProcess } from "../contract";

const rpcFrame = z.object({ type: z.string(), id: z.string().optional() }).passthrough();
const rpcResponse = z.object({ success: z.boolean(), data: z.unknown(), error: z.string().optional() });
const tool = z.object({ toolCallId: z.string(), toolName: z.string(), args: runtimeJsonObjectSchema });
const result = tool.extend({
  result: z.object({
    content: z.array(z.union([runtimeTextSchema, runtimeImageSchema])),
    details: z.object({ data: runtimeJsonValueSchema.optional() }),
  }),
  isError: z.boolean().nullable(),
});
const request = z.discriminatedUnion("method", [
  z.object({ method: z.literal("event"), data: z.object({ type: z.string() }).passthrough() }),
  z.object({ method: z.literal("consume"), data: z.array(z.string()) }),
  z.object({ method: z.literal("steer"), data: z.object({ id: z.string(), accepted: z.boolean() }) }),
  z.object({ method: z.literal("toolStart"), data: tool }),
  z.object({ method: z.literal("toolEnd"), data: result }),
  z.object({ method: z.literal("toolUpdate"), data: z.object({ toolCallId: z.string(), partialResult: z.object({ text: z.string(), data: runtimeJsonValueSchema.optional() }) }) }),
  z.object({ method: z.literal("invoke"), data: tool }),
]);
const sessionMissing = z.object({ type: z.literal("native_session_missing") });
const bridgeFrame = z.union([
  z.object({ type: z.literal("request"), id: z.number().int() }).and(request),
  z.object({ type: z.literal("cancel"), id: z.number().int() }),
]);

export type PiRpcFrame = z.infer<typeof rpcFrame>;
export type PiBridgeFrame = z.infer<typeof bridgeFrame>;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class PiTransport {
  private readonly exit = new AbortController();
  readonly exited = this.exit.signal;
  private readonly pending = new Map<string, ReturnType<typeof deferred<z.infer<typeof rpcResponse>>>>();
  private sequence = 0;
  private failure?: Error;

  constructor(
    private readonly process: HarnessProcess,
    private readonly channel: Duplex,
    onRpc: (event: PiRpcFrame) => void,
    onFrame: (frame: PiBridgeFrame) => void,
  ) {
    let stderr = "";
    process.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    void process.exited.then(
      code => this.end(new Error(`PI process ended (${code ?? "killed"})${stderr ? `: ${stderr.trim()}` : ""}`)),
      error => this.end(error),
    );
    this.read(process.stdout, line => {
      const event = rpcFrame.parse(JSON.parse(line));
      if (event.type === "response") {
        const id = z.string().parse(event.id);
        const response = rpcResponse.parse(event);
        const pending = this.pending.get(id);
        if (!pending) throw new Error(`Unexpected PI RPC response ${id}`);
        this.pending.delete(id);
        pending.resolve(response);
      } else onRpc(event);
    });
    this.read(channel, line => {
      const frame: unknown = JSON.parse(line);
      if (sessionMissing.safeParse(frame).success) this.end(new NativeSessionMissing());
      else onFrame(bridgeFrame.parse(frame));
    });
    process.stdin.on("error", error => this.fail(error));
  }

  private read(input: Readable, receive: (line: string) => void) {
    createInterface({ input }).on("line", line => {
      try {
        receive(line);
      } catch (error) {
        this.fail(error);
      }
    }).on("error", error => this.fail(error));
  }

  private end(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const response of this.pending.values()) response.reject(error);
    this.pending.clear();
    this.exit.abort(error);
  }

  fail(error: unknown) {
    this.end(error instanceof Error ? error : new Error(String(error)));
    this.process.kill();
  }

  send(frame: object) {
    if (!this.failure) this.channel.write(JSON.stringify(frame) + "\n");
  }

  async rpc(type: string, fields: object = {}) {
    if (this.failure) throw this.failure;
    const id = String(++this.sequence);
    const response = deferred<z.infer<typeof rpcResponse>>();
    this.pending.set(id, response);
    this.process.stdin.write(JSON.stringify({ type, id, ...fields }) + "\n");
    return response.promise;
  }
}
