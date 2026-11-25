import { z } from "zod";

export const browserEventsPath = "/browser-events";
export const browserConnectionHeader = "X-Ontomato-Browser-Connection";
export const browserSubscriptionHeader = "X-Ontomato-Browser-Subscription";
export const browserEventIdSchema = z.string().uuid();

export const browserEventFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribed"), subscriptionId: browserEventIdSchema }).strict(),
  z.object({ type: z.literal("data"), subscriptionId: browserEventIdSchema, data: z.unknown() }).strict(),
  z.object({ type: z.literal("end"), subscriptionId: browserEventIdSchema }).strict(),
]);
export type BrowserEventFrame = z.infer<typeof browserEventFrameSchema>;

export function isAgentEventRequest(path: string, method: string): boolean {
  return method === "GET" &&
    /^\/(?:assistant|observe\/agent)\/sessions\/(?:run-events|[^/]+\/(?:runs\/[^/]+\/events|tasks\/(?:events|[^/]+\/process\/events)))$/.test(path.split("?", 1)[0]!);
}
