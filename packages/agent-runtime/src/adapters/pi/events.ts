import { z } from "zod";
import type { RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import {
  runtimeAssistantMessageSchema, runtimeAssistantStreamEventSchema,
  runtimeSettledMessageSchema, runtimeToolCallSchema, runtimeToolResultMessageSchema,
  type RuntimeAssistantMessage,
} from "@ontomato/contracts/agent-runtime-messages";
import type { HarnessAssistantMessageEvent, HarnessTurnHost } from "../contract";
import type { PiRpcFrame } from "./transport";

const assistant = runtimeAssistantMessageSchema.omit({ origin: true }).strip();
const toolResult = runtimeToolResultMessageSchema.omit({ details: true }).strip();
const message = z.discriminatedUnion("role", [assistant, toolResult]);
const messageFrame = z.object({ nativeId: z.string(), message });

function parseDelta(value: unknown): HarnessAssistantMessageEvent {
  const { type, contentIndex, delta, reason } = z.object({
    type: z.string(),
    contentIndex: z.number().optional(),
    delta: z.string().optional(),
    reason: z.string().optional(),
  }).parse(value);
  const change = runtimeAssistantStreamEventSchema.parse({
    type,
    ...(contentIndex === undefined ? {} : { contentIndex }),
    ...(delta === undefined ? {} : { delta }),
    ...(reason === undefined ? {} : { reason }),
  });
  switch (change.type) {
    case "text_end":
    case "thinking_end":
      return { ...change, ...z.object({ content: z.string() }).parse(value) };
    case "toolcall_start":
      return { ...change, ...z.object({ id: z.string(), toolName: z.string() }).parse(value) };
    case "toolcall_end":
      return { ...change, ...z.object({ toolCall: runtimeToolCallSchema }).parse(value) };
    default:
      return change;
  }
}

export class PiEvents {
  private last?: RuntimeAssistantMessage;
  private detailSequence = 0;
  private compactionKey = "";
  constructor(private readonly host: HarnessTurnHost) {}

  async message(frame: PiRpcFrame) {
    switch (frame.type) {
      case "turn_start":
      case "turn_end":
        await this.host.emit({ type: frame.type });
        break;
      case "message_start": {
        const { nativeId, message } = messageFrame.parse(frame);
        await this.host.emit({ type: "message_start", nativeId, message });
        break;
      }
      case "message_update": {
        const nativeId = z.string().parse(frame.nativeId);
        await this.host.emit({
          type: "message_update", nativeId,
          assistantMessageEvent: parseDelta(frame.assistantMessageEvent),
        });
        break;
      }
      case "message_end": {
        const { nativeId, message } = messageFrame.parse(frame);
        runtimeSettledMessageSchema.parse(message);
        await this.host.emit({ type: "message_end", nativeId, message });
        if (message.role === "assistant") this.last = message;
        break;
      }
      default:
        throw new Error(`Unexpected PI lifecycle event ${frame.type}`);
    }
  }

  terminal(aborted: boolean): { stopReason: RuntimeStopReason; errorMessage: string | null } {
    if (aborted) return { stopReason: "aborted", errorMessage: null };
    if (!this.last || this.last.stopReason === "pending")
      return { stopReason: "error", errorMessage: "PI settled without a final model message" };
    return { stopReason: this.last.stopReason, errorMessage: this.last.errorMessage ?? null };
  }

  private key(category: string) {
    return `${category}:${++this.detailSequence}`;
  }

  async detail(frame: PiRpcFrame) {
    switch (frame.type) {
      case "compaction_start": {
        const reason = z.enum(["manual", "threshold", "overflow"]).parse(frame.reason);
        this.compactionKey = this.key("compaction");
        await this.host.emit({
          type: "run_detail",
          detail: {
            key: this.compactionKey, category: "compaction", scope: "run", ref: null,
            status: "started", text: `Compacting context (${reason})`,
          },
        });
        break;
      }
      case "compaction_end": {
        const { aborted, errorMessage } = z.object({
          aborted: z.boolean(), errorMessage: z.string().optional(),
        }).parse(frame);
        const status = aborted ? "Context compaction interrupted" : errorMessage ? "Context compaction failed" : "Context compacted";
        await this.host.emit({
          type: "run_detail",
          detail: {
            key: this.compactionKey, category: "compaction", scope: "run", ref: null,
            status: "completed", text: errorMessage ? `${status}. ${errorMessage}` : status,
          },
        });
        break;
      }
      case "extension_error": {
        const { event, error } = z.object({ event: z.string(), error: z.string() }).parse(frame);
        await this.host.emit({
          type: "run_detail",
          detail: {
            key: this.key("extension"), category: "diagnostic", scope: "run", ref: null,
            level: "error", action: null, text: `PI extension (${event}) reported an error. ${error}`,
          },
        });
        break;
      }
    }
  }
}
