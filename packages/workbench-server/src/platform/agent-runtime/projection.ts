import type { RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import {
  agentHostRunSchema,
  type AgentHostRun,
  type AgentHostRunSnapshot,
  type AgentHostRunStatus,
} from "@ontomato/contracts/agent-host";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
export const publicRun = (run: RuntimeRunSnapshot["run"] | AgentHostRun) =>
  agentHostRunSchema.parse(
    Object.fromEntries(
      Object.keys(agentHostRunSchema.shape).map((k) => [
        k,
        run[k as keyof typeof run],
      ]),
    ),
  );
/** A session row's latest run, without the run's messages, artifacts or definition. */
export function runStatusView(run: {
  id: string;
  status: AgentHostRunStatus["status"];
  stopReason: AgentHostRunStatus["stopReason"];
}): AgentHostRunStatus {
  return { id: run.id, status: run.status, stopReason: run.stopReason };
}
/**
 * The business outcome of a run: the runtime only reports running/stopped, the stop reason says why.
 * A length-limited run still delivered its answer, so it counts as completed, not failed.
 */
export type RunOutcome = "running" | "completed" | "cancelled" | "failed";
export function runOutcome(run: { status: "running" | "stopped"; stopReason: string | null }): RunOutcome {
  if (run.status === "running") return "running";
  if (run.stopReason === "stop" || run.stopReason === "length") return "completed";
  if (run.stopReason === "aborted") return "cancelled";
  return "failed";
}
export const publicMessages = (messages: RuntimeRunSnapshot["messages"]) => messages.filter((m) => m.message.role !== "system");
export const publicSnapshot = (s: RuntimeRunSnapshot | AgentHostRunSnapshot) => ({
  ...s,
  run: publicRun(s.run),
  messages: publicMessages(s.messages),
});

/** The host projection excludes supervisor prompts in both live and history reads. */
export function publicFrame(frame: RuntimeStreamFrame): RuntimeStreamFrame | null {
  if (frame.type !== "event") return frame;
  const event = frame.envelope.event;
  if ((event.type === "message_start" || event.type === "message_end" || event.type === "turn_end") && event.message.role === "system") return null;
  if (event.type === "agent_end") return { ...frame, envelope: { ...frame.envelope, event: { ...event, messages: event.messages.filter((m) => m.role !== "system") } } };
  return frame;
}
