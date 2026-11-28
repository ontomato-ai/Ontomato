import { z } from "zod";
import type { RuntimeImage, RuntimeMessage, RuntimeText } from "@ontomato/contracts/agent-runtime-messages";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { HarnessTurnInput } from "../contract";

export const text = (value: string): RuntimeText => ({ type: "text", text: value });
const imageUrl = (image: RuntimeImage) => `data:${image.mimeType};base64,${image.data}`;

function userContent(message: Extract<RuntimeMessage, { role: "user" | "notification" }>): (RuntimeText | RuntimeImage)[] {
  if (message.role === "notification") return [text(`[Agent notification: ${JSON.stringify({
    kind: message.kind, source: message.source, replyTo: message.replyTo, selectedOption: message.selectedOption,
    answerId: message.answerId, outcome: message.outcome,
  })}]\n${message.content}${message.defaultAssumption ? `\nDefault assumption: ${message.defaultAssumption}` : ""}`)];
  return typeof message.content === "string" ? [text(message.content)] : message.content;
}

export function userInput(input: HarnessTurnInput, turnContext: string | null = null) {
  const message = input.message;
  const parts = [turnContext, input.context].filter((value): value is string => Boolean(value)).map(text);
  if (message.role !== "user" && message.role !== "notification") throw new Error(`Invalid Codex input role ${message.role}`);
  return [...parts, ...userContent(message).map(block => block.type === "text"
    ? text(block.text)
    : { type: "image", url: imageUrl(block) })];
}

function inputItem(part: RuntimeText | RuntimeImage) {
  return part.type === "text"
    ? { type: "input_text", text: part.text }
    : { type: "input_image", image_url: imageUrl(part) };
}

export function historyItems(message: RuntimeMessage): object[] {
  switch (message.role) {
    case "user":
    case "notification":
      return [{ type: "message", role: "user", content: userContent(message).map(inputItem) }];
    case "assistant":
      return message.content.flatMap<object>(part => {
        if (part.type === "text") return [{
          type: "message", role: "assistant", content: [{ type: "output_text", text: part.text }],
        }];
        if (part.type === "toolCall") return [{
          type: "function_call", call_id: part.id, name: part.name, arguments: JSON.stringify(part.arguments),
        }];
        return []; // Provider-native reasoning cannot be reconstructed as portable conversation history.
      });
    case "toolResult":
      return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content.map(inputItem) }];
    case "system":
      return [{ type: "message", role: "system",
        content: (typeof message.content === "string" ? [text(message.content)] : message.content).map(inputItem) }];
  }
}

export function toolOutput(content: readonly (RuntimeText | RuntimeImage)[]) {
  return content.map(part => part.type === "text"
    ? { type: "inputText", text: part.text }
    : { type: "inputImage", imageUrl: imageUrl(part) });
}

export const itemSchema = z.object({ type: z.string(), id: z.string() }).passthrough();
export const toolRequest = z.object({
  turnId: z.string(), callId: z.string(), tool: z.string(), arguments: runtimeJsonObjectSchema,
});
export const command = z.object({
  command: z.string(), cwd: z.string(), status: z.string(), aggregatedOutput: z.string().nullish(),
  exitCode: z.number().nullish(), durationMs: z.number().nullish(),
});
export const patches = z.array(z.object({
  path: z.string(), diff: z.string(),
  kind: z.object({ type: z.enum(["add", "delete", "update"]) }),
}));
export const patch = z.object({ status: z.string(), changes: patches });
