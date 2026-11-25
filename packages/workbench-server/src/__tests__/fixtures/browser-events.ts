import { randomUUID } from "node:crypto";
import {
  browserConnectionHeader, browserEventFrameSchema, browserEventIdSchema, browserEventsPath, browserSubscriptionHeader,
} from "@ontomato/contracts/browser-events";
import { readSseData } from "@ontomato/contracts/sse";

export async function openBrowserEventConnection(base: string, headers: Record<string, string>) {
  const abort = new AbortController();
  const eventsUrl = `${base}/api${browserEventsPath}`;
  const response = await fetch(eventsUrl, { headers, signal: abort.signal });
  if (!response.ok) throw new Error(`Browser event stream: ${response.status} ${await response.text()}`);
  const connectionId = browserEventIdSchema.parse(response.headers.get(browserConnectionHeader));
  const subscriptions = new Map<string, ReadableStreamDefaultController<unknown>>();
  void readSseData(response, raw => {
    const frame = browserEventFrameSchema.parse(raw);
    const controller = subscriptions.get(frame.subscriptionId)!;
    if (frame.type === "data") controller.enqueue(frame.data);
    if (frame.type === "end") {
      controller.close();
      subscriptions.delete(frame.subscriptionId);
    }
    return false;
  }, () => !abort.signal.aborted).catch(error => {
    if (abort.signal.aborted) return;
    for (const controller of subscriptions.values()) controller.error(error);
  });

  return {
    close: () => abort.abort(),
    async subscribe(url: string, credential: Record<string, string> = headers) {
      const subscriptionId = randomUUID();
      const requestHeaders = new Headers(credential);
      requestHeaders.set(browserConnectionHeader, connectionId);
      requestHeaders.set(browserSubscriptionHeader, subscriptionId);
      const stream = new ReadableStream<unknown>({
        start(controller) { subscriptions.set(subscriptionId, controller); },
      });
      const registration = await fetch(url, { method: "POST", headers: requestHeaders });
      if (!registration.ok) subscriptions.delete(subscriptionId);
      return {
        registration,
        reader: stream.getReader(),
        async unsubscribe() {
          const result = await fetch(`${eventsUrl}/${subscriptionId}`, { method: "DELETE", headers: requestHeaders });
          if (!result.ok) throw new Error(`Unsubscribe returned ${result.status}`);
          subscriptions.delete(subscriptionId);
        },
      };
    },
  };
}
