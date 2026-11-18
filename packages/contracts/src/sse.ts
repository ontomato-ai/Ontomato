/** Named SSE control payloads; open/heartbeat are SSE event names, not JSON type values. */
export type SseOpenData = { ok: true };
export type SseHeartbeatData = { ts: number };

const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000] as const;

/** Backoff for SSE consumers that reopen until explicitly stopped. A ready frame resets their attempt to zero. */
export function sseReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]!;
}

/**
 * Reads the `data:` payloads of an SSE stream until `handle` says the stream is done with one. Returns true when it
 * ended that way, false when the body ended first. Malformed payloads throw.
 */
export async function readSseData(
  response: Response,
  handle: (data: unknown) => boolean | Promise<boolean>,
  current: () => boolean,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The event stream has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (current()) {
      const { done, value } = await reader.read();
      if (done) return false;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line.startsWith("data:")) {
          data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
          continue;
        }
        if (line !== "" || data.length === 0) continue;
        const payload = JSON.parse(data.join("\n"));
        data = [];
        if (await handle(payload)) return true;
      }
    }
    return false;
  } finally {
    void reader.cancel().catch(() => {});
  }
}
