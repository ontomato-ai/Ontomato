import {
  platformScheduleApplicationsSchema,
  platformScheduleErrorSchema,
  platformScheduleFormRequestSchema,
  platformScheduleFormSchema,
  platformScheduleIdempotencyKeySchema,
  platformSchedulesPath,
  platformTaskEnabledSchema,
  platformTaskIfMatchSchema,
  platformTaskInputSchema,
  platformTaskListSchema,
  platformTaskRunPageSchema,
  platformTaskRunSchema,
  platformTaskSchema,
  platformTaskUpdateSchema,
  type PlatformScheduleError,
  type PlatformScheduleFormRequest,
  type PlatformTaskEnabled,
  type PlatformTaskInput,
  type PlatformTaskUpdate,
} from "@ontomato/contracts/platform-schedules";
import type { PlatformSchedulesHost } from "./host";

const base = platformSchedulesPath;
const task = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** The service's own refusal: its machine code, message, field errors, replacement form or running execution. */
export type ScheduleRefusal = PlatformScheduleError["error"];

/**
 * A request that did not end in the answer the page asked for.
 *
 * `refusal` is the service's own answer when it gave one. Without it nothing came back that the page can rely on — no
 * connection, an answer from something in front of the service, or a body the contract does not describe — so the
 * request may or may not have taken effect, and a create or a manual run is retried with the key it was sent with.
 */
export class ScheduleRequestError extends Error {
  constructor(
    readonly status: number | null,
    readonly refusal: ScheduleRefusal | null,
    options?: { cause?: unknown },
  ) {
    super(refusal?.message ?? (status === null ? "No answer from the scheduled tasks service" : `HTTP ${status}`), options);
    this.name = "ScheduleRequestError";
  }

  get code() {
    return this.refusal?.code ?? null;
  }
}

/** Any failure of a call below, as the page reads it. */
export function scheduleFailure(error: unknown): ScheduleRequestError {
  return error instanceof ScheduleRequestError ? error : new ScheduleRequestError(null, null, { cause: error });
}

function refusalOf(body: unknown): ScheduleRefusal | null {
  const parsed = platformScheduleErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : null;
}

/** The host's thrown refusal carries the status and the parsed body (`payload`, or `body` for other hosts). */
function thrownFailure(error: unknown): ScheduleRequestError {
  const carried = error as { status?: unknown; payload?: unknown; body?: unknown } | null;
  const status = typeof carried?.status === "number" ? carried.status : null;
  return new ScheduleRequestError(status, status === null ? null : refusalOf(carried?.payload ?? carried?.body), {
    cause: error,
  });
}

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/**
 * The page's one way to the platform's scheduled tasks: the gateway resource the data engine owns. Every answer is
 * parsed with the contract and every request body is checked against it before it leaves, so a service or a page that
 * drifted from the contract fails here instead of half-rendering a card.
 */
export function createSchedulesApi(host: PlatformSchedulesHost) {
  async function send(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await host.request(path, init);
    } catch (error) {
      throw thrownFailure(error);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ScheduleRequestError(response.status, refusalOf(body));
    }
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }

  async function read<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } }, path: string, init?: RequestInit): Promise<T> {
    const answer = await send(path, init);
    const parsed = schema.safeParse(answer.body);
    if (!parsed.success) throw new ScheduleRequestError(answer.status, null, { cause: parsed.error });
    return parsed.data;
  }

  return {
    /**
     * Renews the caller's background credential, which the tasks of remote applications run with. The page calls it
     * before its first read so that tasks paused on an expired credential return once their creator visits with a
     * valid sign-in; the service does nothing when no task needs one.
     */
    async renewCredential(): Promise<void> {
      await send(`${base}/credential/renew`, { method: "POST" });
    },
    /** The applications that declare a schedule form, whether each is usable now, and the caller's task counts. */
    applications: () => read(platformScheduleApplicationsSchema, `${base}/applications`),
    /** The caller's tasks in the service's order, optionally of one application. */
    list: (appId?: string | null) =>
      read(platformTaskListSchema, appId ? `${base}?${new URLSearchParams({ appId })}` : base),
    task: (id: string) => read(platformTaskSchema, task(id)),
    /**
     * One application's form for the given draft. The answer is the whole form: fields a selection removed are gone
     * from it, together with their values, so a caller replaces its draft and never merges.
     */
    form: (appId: string, request: PlatformScheduleFormRequest) =>
      read(
        platformScheduleFormSchema,
        `${base}/applications/${encodeURIComponent(appId)}/form`,
        json("POST", platformScheduleFormRequestSchema.parse(request)),
      ),
    /** Registers a task, switched on; the service replays a repeated key instead of creating the task twice. */
    create: (input: PlatformTaskInput, idempotencyKey: string) =>
      read(
        platformTaskSchema,
        base,
        json("POST", platformTaskInputSchema.parse(input), {
          "Idempotency-Key": platformScheduleIdempotencyKeySchema.parse(idempotencyKey),
        }),
      ),
    update: (id: string, input: PlatformTaskUpdate) =>
      read(platformTaskSchema, task(id), json("PUT", platformTaskUpdateSchema.parse(input))),
    setEnabled: (id: string, change: PlatformTaskEnabled) =>
      read(platformTaskSchema, `${task(id)}/enabled`, json("PUT", platformTaskEnabledSchema.parse(change))),
    async remove(id: string, revision: number): Promise<void> {
      await send(task(id), { method: "DELETE", headers: { "If-Match": platformTaskIfMatchSchema.parse(`"${revision}"`) } });
    },
    /** Starts one run now; the schedule is untouched. The service replays a repeated key with the run it created. */
    runNow: (id: string, idempotencyKey: string) =>
      read(platformTaskRunSchema, `${task(id)}/runs`, {
        method: "POST",
        headers: { "Idempotency-Key": platformScheduleIdempotencyKeySchema.parse(idempotencyKey) },
      }),
    /** Newest first; `cursor` is the previous page's `nextCursor`, absent for the first page. */
    runs: (id: string, cursor?: string | null) =>
      read(platformTaskRunPageSchema, `${task(id)}/runs${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`),
    run: (id: string, runId: string) => read(platformTaskRunSchema, `${task(id)}/runs/${encodeURIComponent(runId)}`),
  };
}

export type SchedulesApi = ReturnType<typeof createSchedulesApi>;
