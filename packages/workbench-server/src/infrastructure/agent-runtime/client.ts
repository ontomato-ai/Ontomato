import { correlationId as normalizeCorrelationId, getServiceLogContext, logHeaders, withServiceLogContext } from "@ontomato/service-logging";
import { createLogger } from "../../logging/logger";
const logger = createLogger("runtime-client");
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
import {
  mcpServiceOptionsSchema, mcpServiceListSchema, mcpServiceResponseSchema, mcpServiceToolsSchema,
  type McpServiceWrite,
} from "@ontomato/contracts/agent-runtime-mcp";

/** The workbench has only this HTTP boundary; it never imports the runtime implementation. */
export class RuntimeClient {
  constructor(
    readonly domainId: string | undefined,
    incomingCorrelationId: string | undefined = getServiceLogContext().correlationId ?? undefined,
    readonly userId = getServiceLogContext().userId,
  ) { this.correlationId = normalizeCorrelationId(incomingCorrelationId); }
  readonly correlationId: string;
  private headers(key?: string) {
    const config = environment.agentRuntime();
    if (!config.token)
      throw new Error("AGENT_RUNTIME_SERVICE_TOKEN is not configured");
    const headers: Record<string, string> = {
      authorization: `Bearer ${config.token}`,
      "x-correlation-id": this.correlationId,
      "content-type": "application/json",
      ...logHeaders({ ...getServiceLogContext(), correlationId: this.correlationId }),
    };
    if (this.userId) headers["x-ontomato-user-id"] = this.userId;
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
      const started = performance.now();
      let outcome = "success";
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
            (result as { error?: { code?: string } }).error?.code,
          );
        return result;
      } catch (error) {
        outcome = signal?.aborted ? "cancelled" : "failure";
        if (
          key &&
          attempt === 0 &&
          error instanceof TypeError &&
          !signal?.aborted
        )
          continue;
        if (error instanceof TypeError && !signal?.aborted)
          throw new HttpError(503, "Agent runtime is unavailable", "DEPENDENCY_UNAVAILABLE");
        throw error;
      } finally {
        if (!path.startsWith("/v1/logs")) withServiceLogContext({ correlationId: this.correlationId, domainId: this.domainId, userId: this.userId }, () =>
          logger.info("runtime call completed", { kind: "downstream", target: "agent-runtime", durationMs: Math.floor(performance.now() - started), outcome }));
      }
    }
  }
  async mcpOptions() {
    return mcpServiceOptionsSchema.parse(await this.request("/v1/mcp/services/names"));
  }
  async mcpServices() {
    return mcpServiceListSchema.parse(await this.request("/v1/mcp/services"));
  }
  async saveMcpService(input: McpServiceWrite, id?: string) {
    return mcpServiceResponseSchema.parse(await this.request(
      id === undefined ? "/v1/mcp/services" : `/v1/mcp/services/${encodeURIComponent(id)}`,
      id === undefined ? "POST" : "PUT", input,
    ));
  }
  async deleteMcpService(id: string) {
    await this.request(`/v1/mcp/services/${encodeURIComponent(id)}`, "DELETE");
  }
  async mcpTools(id: string, signal: AbortSignal) {
    return mcpServiceToolsSchema.parse(await this.request(
      `/v1/mcp/services/${encodeURIComponent(id)}/tools`, "GET", undefined, undefined, signal,
    ));
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
  async bytes(path: string, signal?: AbortSignal): Promise<Buffer> {
    const response = await fetch(
      environment.agentRuntime().url.replace(/\/$/, "") + path,
      { headers: this.headers(), signal },
    );
    if (!response.ok)
      throw new HttpError(response.status, "Runtime output read failed");
    return Buffer.from(await response.arrayBuffer());
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
    return withServiceLogContext({ runId, sessionId }, async () => runtimeAdmissionResponseSchema.parse(
      await this.request(
        `/v1/sessions/${encodeURIComponent(sessionId)}/runs`,
        "POST",
        input,
        runId,
      ),
    ));
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
