import { z } from "zod";
import type { RuntimeImage, RuntimeText } from "@ontomato/contracts/agent-runtime-messages";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { HarnessTurnInput } from "../contract";

export const text = (value: string): RuntimeText => ({ type: "text", text: value });
const imageUrl = (image: RuntimeImage) => `data:${image.mimeType};base64,${image.data}`;

export function userInput(input: HarnessTurnInput, turnContext: string | null = null) {
  const message = input.message;
  const parts = [turnContext, input.context].filter((value): value is string => Boolean(value)).map(text);
  if (message.role === "notification") return [
    ...parts, text(`[Agent notification: ${JSON.stringify({
      kind: message.kind, source: message.source, replyTo: message.replyTo, selectedOption: message.selectedOption,
      answerId: message.answerId, outcome: message.outcome,
    })}]\n${message.content}${message.defaultAssumption ? `\nDefault assumption: ${message.defaultAssumption}` : ""}`),
  ];
  if (message.role !== "user") throw new Error(`Invalid Codex input role ${message.role}`);
  const content = typeof message.content === "string" ? [text(message.content)] : message.content;
  return [...parts, ...content.map(block => block.type === "text"
    ? text(block.text)
    : { type: "image", url: imageUrl(block) })];
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
