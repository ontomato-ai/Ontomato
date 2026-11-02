import { randomId } from "@ontomato/contracts/random-id";
import { agentHostAgentListSchema, type AgentHostAgent } from "@ontomato/contracts/agent-host";
import {
  scheduledTaskListSchema,
  scheduledTaskRunPageSchema,
  scheduledTaskRunSchema,
  scheduledTaskSchema,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskList,
  type ScheduledTaskRun,
  type ScheduledTaskRunPage,
} from "@ontomato/contracts/scheduled-tasks";
import { ApiRequestError, nodeApiFetch, nodeApiGet, nodeApiPost, nodeApiPut } from "../../utils/api";

const base = "/scheduled-tasks";
const task = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** The caller's own scheduled tasks in the current domain. */
export const scheduledTasksApi = {
  async list(): Promise<ScheduledTaskList> {
    return scheduledTaskListSchema.parse(await nodeApiGet(base));
  },
  async create(input: ScheduledTaskInput): Promise<ScheduledTask> {
    return scheduledTaskSchema.parse(await nodeApiPost(base, input, { headers: { "Idempotency-Key": randomId() } }));
  },
  async update(id: string, input: ScheduledTaskInput): Promise<ScheduledTask> {
    return scheduledTaskSchema.parse(await nodeApiPut(task(id), input));
  },
  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return scheduledTaskSchema.parse(await nodeApiPut(`${task(id)}/enabled`, { enabled }));
  },
  async remove(id: string): Promise<void> {
    await nodeApiFetch(task(id), "DELETE");
  },
  async runNow(id: string): Promise<ScheduledTaskRun> {
    return scheduledTaskRunSchema.parse(
      await nodeApiPost(`${task(id)}/runs`, {}, { headers: { "Idempotency-Key": randomId() } }),
    );
  },
  async runs(id: string, cursor: string | null): Promise<ScheduledTaskRunPage> {
    const query = new URLSearchParams(cursor ? { cursor } : {});
    return scheduledTaskRunPageSchema.parse(await nodeApiGet(`${task(id)}/runs?${query}`));
  },
  /** The agents a task may use: the same list the conversation shell offers. */
  async agents(): Promise<AgentHostAgent[]> {
    return agentHostAgentListSchema.parse(await nodeApiGet("/assistant/agents")).agents;
  },
};

/** The host's machine code of a failed request ({error:{code}} bodies), if any. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const body: unknown = error.payload.error;
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : error.code;
}
