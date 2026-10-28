import { randomUUID } from "node:crypto";
import {
  runtimeRunSnapshotSchema,
  runtimeSessionSnapshotSchema,
  runtimeAdmissionResponseSchema,
  runtimeCreateSessionResponseSchema,
  runtimeCancelResponseSchema,
  runtimeSessionStatusesResponseSchema,
  type RuntimeStartRunRequest,
} from "@ontomato/contracts/agent-runtime";
import {
  runtimeStreamFrameSchema,
  type RuntimeCursor,
  type RuntimeStreamFrame,
} from "@ontomato/contracts/agent-runtime-events";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";

/** The workbench has only this HTTP boundary; it never imports the runtime implementation. */
export class RuntimeClient {
  constructor(
    readonly domainId: string | undefined,
    readonly correlationId: string = randomUUID(),
  ) {}
  private headers(key?: string) {
    const config = environment.agentRuntime();
    if (!config.token)
      throw new Error("AGENT_RUNTIME_SERVICE_TOKEN is not configured");
    const headers: Record<string, string> = {
      authorization: `Bearer ${config.token}`,
      "x-correlation-id": this.correlationId,
      "content-type": "application/json",
    };
    if (this.domainId) headers["x-domain-id"] = this.domainId;
    if (key) headers["idempotency-key"] = key;
    return headers;
  }
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // Only idempotent admission requests are retried after a lost transport response.
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(
          environment.agentRuntime().url.replace(/\/$/, "") + path,
          {
            method,
            headers: this.headers(key),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
          },
        );
        if (response.status === 204) return undefined;
        const result = await response.json();
        if (!response.ok)
          throw new HttpError(
            response.status,
            (result as { error?: { message?: string } }).error?.message ||
              "Agent runtime request failed",
          );
        return result;
      } catch (error) {
        if (
          key &&
          attempt === 0 &&
          error instanceof TypeError &&
          !signal?.aborted
        )
          continue;
        throw error;
      }
    }
  }
  async text(path: string, signal?: AbortSignal) {
    const response = await fetch(
      environment.agentRuntime().url.replace(/\/$/, "") + path,
      { headers: this.headers(), signal },
    );
    if (!response.ok)
      throw new HttpError(response.status, "Runtime output read failed");
    return response.text();
  }
  async createSession(id: string) {
    return runtimeCreateSessionResponseSchema.parse(
      await this.request("/v1/sessions", "POST", {}, id),
    );
  }
  async session(id: string) {
    return runtimeSessionSnapshotSchema.parse(
      await this.request(`/v1/sessions/${encodeURIComponent(id)}`),
    );
  }
  async sessionStatuses(sessionIds: string[]) {
    return runtimeSessionStatusesResponseSchema.parse(
      await this.request("/v1/sessions/status", "POST", { sessionIds }),
    ).sessions;
  }
  async run(id: string) {
    return runtimeRunSnapshotSchema.parse(
      await this.request(`/v1/runs/${encodeURIComponent(id)}`),
    );
  }
  async start(sessionId: string, runId: string, input: RuntimeStartRunRequest) {
    return runtimeAdmissionResponseSchema.parse(
      await this.request(
        `/v1/sessions/${encodeURIComponent(sessionId)}/runs`,
        "POST",
        input,
        runId,
      ),
    );
  }
  async cancel(id: string) {
    return runtimeCancelResponseSchema.parse(
      await this.request(
        `/v1/runs/${encodeURIComponent(id)}/cancel`,
        "POST",
        {},
      ),
    );
  }
  async deleteSession(id: string) {
    await this.request(`/v1/sessions/${encodeURIComponent(id)}`, "DELETE");
  }
  async stream(
    cursor: RuntimeCursor,
    onFrame: (frame: RuntimeStreamFrame) => Promise<void>,
    signal: AbortSignal,
  ) {
    const response = await fetch(
      `${environment.agentRuntime().url.replace(/\/$/, "")}/v1/runs/${cursor.runId}/events?afterSeq=${cursor.seq}&streamId=${cursor.streamId}`,
      { headers: this.headers(), signal },
    );
    if (!response.ok)
      throw new HttpError(response.status, "Agent runtime stream failed");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Runtime event stream has no body");
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("data: "))
            await onFrame(
              runtimeStreamFrameSchema.parse(JSON.parse(line.slice(6))),
            );
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}
