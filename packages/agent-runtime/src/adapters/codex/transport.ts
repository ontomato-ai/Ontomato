import { createInterface } from "node:readline";
import { z } from "zod";
import { NativeSessionMissing, type HarnessProcess } from "../contract";

const idSchema = z.union([z.string(), z.number().int()]);
const notice = z.object({ method: z.string(), params: z.record(z.unknown()).default({}), id: idSchema.optional() });
const answer = z.object({
  id: idSchema,
  result: z.unknown(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
export type CodexNotice = z.infer<typeof notice>;
export type RpcId = z.infer<typeof idSchema>;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class CodexRpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

export class CodexTransport {
  private readonly ended = new AbortController();
  readonly signal = this.ended.signal;
  private readonly pending = new Map<RpcId, ReturnType<typeof deferred<unknown>>>();
  private sequence = 0;

  constructor(private readonly process: HarnessProcess, receive: (frame: CodexNotice) => void) {
    let stderr = "";
    process.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4096); });
    const lines = createInterface({ input: process.stdout });
    lines.on("line", line => {
      try {
        const frame: unknown = JSON.parse(line);
        const notification = notice.safeParse(frame);
        if (notification.success) {
          if (notification.data.method === "ontomato/native_session_missing") this.end(new NativeSessionMissing());
          else receive(notification.data);
          return;
        }
        const reply = answer.parse(frame);
        const request = this.pending.get(reply.id);
        if (!request) throw new Error(`Unexpected Codex RPC response ${reply.id}`);
        this.pending.delete(reply.id);
        if (reply.error) request.reject(new CodexRpcError(reply.error.code, reply.error.message));
        else request.resolve(reply.result);
      } catch (error) {
        this.fail(error);
      }
    }).on("error", error => this.fail(error));
    process.stdin.on("error", error => this.fail(error));
    void process.exited.then(
      code => this.end(new Error(`Codex exited (${code ?? "signal"})${stderr.trim() ? `: ${stderr.trim()}` : ""}`)),
      error => this.end(error),
    );
  }

  private end(error: unknown) {
    if (this.signal.aborted) return;
    this.ended.abort(error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  fail(error: unknown) {
    this.end(error);
    this.process.kill();
  }

  send(frame: object) {
    this.signal.throwIfAborted();
    this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");
  }

  async request(method: string, params: object) {
    this.signal.throwIfAborted();
    const id = ++this.sequence;
    const request = deferred<unknown>();
    this.pending.set(id, request);
    this.send({ id, method, params });
    return request.promise;
  }
}
