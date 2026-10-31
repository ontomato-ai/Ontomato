import type { RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import { agentHostRunSchema, type AgentHostRun, type AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
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
/** The business outcome of a run: the runtime only reports running/stopped, the stop reason says why. */
export type RunOutcome = "running" | "completed" | "cancelled" | "failed";
export function runOutcome(run: { status: "running" | "stopped"; stopReason: string | null }): RunOutcome {
  if (run.status === "running") return "running";
  if (run.stopReason === "stop") return "completed";
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
