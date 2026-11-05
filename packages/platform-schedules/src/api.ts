import { randomId } from "@ontomato/contracts/random-id";
import {
  platformSchedulesPath,
  platformTaskFunctionTargetsSchema,
  platformTaskListSchema,
  platformTaskRunPageSchema,
  platformTaskRunSchema,
  platformTaskSchema,
  type PlatformTask,
  type PlatformTaskFunctionTarget,
  type PlatformTaskInput,
  type PlatformTaskList,
  type PlatformTaskRun,
  type PlatformTaskRunPage,
} from "@ontomato/contracts/platform-schedules";
import type { PlatformSchedulesHost } from "./host";

const base = platformSchedulesPath;
const task = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** The host answered non-2xx; the page reads the status to tell a refusal from a failure. */
export class SchedulesRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SchedulesRequestError";
  }
}

/**
 * The page's one way to the platform's scheduled tasks: the gateway resource the data engine owns
 * (`/api/data-query/platform/scheduled-tasks`). Every response is parsed with the contract, so a service that changed
 * its shape fails here instead of half-rendering a row.
 */
export function createSchedulesApi(host: PlatformSchedulesHost) {
  async function read(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await host.request(path, init);
    if (response.status === 204) return null;
    if (!response.ok) throw new SchedulesRequestError(`Request failed: HTTP ${response.status}`, response.status);
    return response.json();
  }

  /** The host's error code of a failed request (`{error:{code}}` or `{code}` bodies), if it carries one. */
  function errorCode(error: unknown): string | null {
    const body = (error as { body?: unknown } | null)?.body ?? (error as { payload?: unknown } | null)?.payload;
    const candidate = (body as { error?: unknown; code?: unknown } | null) ?? null;
    const nested = candidate?.error;
    if (nested && typeof nested === "object") {
      const code = (nested as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    return typeof candidate?.code === "string" ? candidate.code : null;
  }

  return {
    /**
     * Lists what the caller may see, optionally narrowed: `appId` picks agent or function tasks, `agentId` only the
     * tasks of one agent (the agent platform's own scheduled tasks entry uses that). The service already decides which
     * function tasks this account may see, and withholds their latest result when it may not read results.
     */
    async list(narrow: { appId?: string; agentId?: string } = {}): Promise<PlatformTaskList> {
      const query = new URLSearchParams();
      if (narrow.appId) query.set("appId", narrow.appId);
      if (narrow.agentId) query.set("agentId", narrow.agentId);
      const suffix = query.size ? `?${query}` : "";
      return platformTaskListSchema.parse(await read(`${base}${suffix}`));
    },
    /**
     * Renews the caller's background credential, which a task needs to run the agent on its owner's behalf; the data
     * engine re-signs only credentials that went invalid. The page calls it on open, before reading the list, and a
     * renewal that fails leaves the list readable, so its failure is never shown.
     */
    async renewCredential(): Promise<void> {
      await read(`${base}/credential/renew`, { method: "POST" });
    },
    /**
     * The write functions this caller may schedule, as the service picks them: the same rule it enforces when a function
     * task is saved or run, so the picker offers nothing the service would refuse. An account without the function tasks'
     * list permission is refused (403); that is a refusal, not a failure, and callers show no function choice for it.
     */
    async functionTargets(): Promise<PlatformTaskFunctionTarget[]> {
      return platformTaskFunctionTargetsSchema.parse(await read(`${base}/function-targets`));
    },
    /** `enabled: false` registers the task switched off; the service replays a repeated ID instead of creating twice. */
    async create(input: PlatformTaskInput, enabled = true): Promise<PlatformTask> {
      const suffix = enabled ? "" : "?enabled=false";
      return platformTaskSchema.parse(
        await read(`${base}${suffix}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": randomId() },
          body: JSON.stringify(input),
        }),
      );
    },
    async update(id: string, input: PlatformTaskInput): Promise<PlatformTask> {
      return platformTaskSchema.parse(
        await read(task(id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
    },
    async setEnabled(id: string, enabled: boolean): Promise<PlatformTask> {
      return platformTaskSchema.parse(
        await read(`${task(id)}/enabled`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }),
      );
    },
    async remove(id: string): Promise<void> {
      await read(task(id), { method: "DELETE" });
    },
    /** Starts one run now; the schedule is untouched. 202 carries the run this request created. */
    async runNow(id: string): Promise<PlatformTaskRun> {
      return platformTaskRunSchema.parse(
        await read(`${task(id)}/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": randomId() },
          body: JSON.stringify({}),
        }),
      );
    },
    /** Newest first; `cursor` is the previous page's `nextCursor`, null for the first page. */
    async runs(id: string, cursor: string | null): Promise<PlatformTaskRunPage> {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      return platformTaskRunPageSchema.parse(await read(`${task(id)}/runs${query}`));
    },
    /** One run's own record: a function run's result and duration, an agent run's session. */
    async run(id: string, runId: string): Promise<PlatformTaskRun> {
      return platformTaskRunSchema.parse(await read(`${task(id)}/runs/${encodeURIComponent(runId)}`));
    },
    errorCode,
    /** The status of a request this layer refused, or null when the failure came from elsewhere. */
    statusOf(error: unknown): number | null {
      return error instanceof SchedulesRequestError ? error.status : null;
    },
  };
}

export type SchedulesApi = ReturnType<typeof createSchedulesApi>;
