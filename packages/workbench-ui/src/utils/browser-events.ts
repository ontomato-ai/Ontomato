import { isAgentEventRequest, type BrowserEventFrame } from "@ontomato/contracts/browser-events";

export interface BrowserEventRequest {
  base: string;
  path: string;
  headers: [string, string][];
}

export type BrowserEventMessage =
  | BrowserEventFrame
  | { type: "refused"; status: number; headers: [string, string][]; body: string }
  | { type: "error"; message: string };

let sharedWorker: SharedWorker | undefined;
const encoder = new TextEncoder();

function subscribe(request: BrowserEventRequest, signal?: AbortSignal | null): Promise<Response> {
  signal?.throwIfAborted();
  const worker = sharedWorker ??= new SharedWorker(
    new URL("./browser-events.worker.ts", import.meta.url), { type: "module" },
  );
  const { port1, port2 } = new MessageChannel();

  return new Promise((resolve, reject) => {
    let active = true;
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    function detach(unsubscribe: boolean) {
      if (!active) return;
      active = false;
      signal?.removeEventListener("abort", abort);
      window.removeEventListener("pagehide", abort);
      worker.removeEventListener("error", workerError);
      if (unsubscribe) port1.postMessage(null);
      port1.close();
    }

    function fail(error: unknown, unsubscribe: boolean) {
      if (!active) return;
      detach(unsubscribe);
      controller.error(error);
      reject(error);
    }

    function abort() {
      fail(signal?.reason ?? new DOMException("Browser event subscription was closed", "AbortError"), true);
    }

    function workerError() {
      fail(new Error("The shared browser event worker could not start"), false);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { detach(true); },
    });
    signal?.addEventListener("abort", abort, { once: true });
    window.addEventListener("pagehide", abort, { once: true });
    worker.addEventListener("error", workerError, { once: true });

    port1.onmessage = ({ data }: MessageEvent<BrowserEventMessage>) => {
      switch (data.type) {
        case "subscribed":
          resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
          break;
        case "data":
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data.data)}\n\n`));
          break;
        case "end":
          detach(false);
          controller.close();
          break;
        case "refused":
          detach(false);
          controller.close();
          resolve(new Response(data.body, { status: data.status, headers: data.headers }));
          break;
        case "error":
          fail(new Error(data.message), false);
          break;
      }
    };
    worker.port.postMessage(request, [port2]);
  });
}

/** The same authenticated request port serves native shells and the platform side of the SDK bridge. */
export function fetchWorkbench(base: string, path: string, init: RequestInit): Promise<Response> {
  if (!isAgentEventRequest(path, init.method ?? "GET")) return fetch(`${base}${path}`, init);
  const apiBase = new URL(base, window.location.href).href;
  return subscribe({ base: apiBase, path, headers: [...new Headers(init.headers)] }, init.signal);
}
