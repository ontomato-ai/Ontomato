import { describe, expect, it, vi } from "vitest";
import { createAgentHostClient, SessionRunStreamError, type SessionRunHandlers } from "../host";

/*
 * The notice port of the shared client. Only a frame off the contract ends the notices for good; a stream that could not
 * be opened, dropped or ended is a line to open again, which the page's feed does on its reconnect cadence. The endpoint
 * names no resource, so a failed open is never "no access to this conversation".
 */

const a = "11111111-1111-4111-8111-111111111111";

/** A stream the test writes into, so a frame arrives after the port has opened it. */
function stream() {
  let push!: (chunk: string) => void;
  let close!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      push = (chunk) => controller.enqueue(encoder.encode(chunk));
      close = () => controller.close();
    },
  });
  return { response: () => new Response(body, { status: 200 }), push, close };
}

function client(opened: () => Promise<Response>) {
  const request = vi.fn(opened);
  return { client: createAgentHostClient({ request }), request };
}

/** Lets the port's read of the stream reach the point the test waits for. */
async function until(reached: () => boolean) {
  for (let index = 0; index < 40 && !reached(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The handlers of one subscription, and the first error it reported. */
function firstError() {
  const errors: unknown[] = [];
  const handlers: SessionRunHandlers = { frame: async () => {}, error: (error) => errors.push(error) };
  const settled = async () => {
    await until(() => errors.length > 0);
    return errors[0];
  };
  return { handlers, settled };
}

describe("the notice port", () => {
  it("hands a failed open back as a dropped line, not as a refusal, so the page opens it again", async () => {
    const { client: host } = client(() => Promise.reject(Object.assign(new Error("Bad Gateway"), { status: 502 })));
    const { handlers, settled } = firstError();

    host.sessionRuns.subscribe(handlers);

    const error = await settled();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SessionRunStreamError);
  });

  it("ends a stream the host closed as a dropped line too", async () => {
    const opened = stream();
    const { client: host } = client(() => Promise.resolve(opened.response()));
    const { handlers, settled } = firstError();

    host.sessionRuns.subscribe(handlers);
    opened.close();

    const error = await settled();
    expect(error).not.toBeInstanceOf(SessionRunStreamError);
  });

  it("reports a frame that breaks the contract as a refusal, so the page stops", async () => {
    const opened = stream();
    const { client: host } = client(() => Promise.resolve(opened.response()));
    const { handlers, settled } = firstError();

    host.sessionRuns.subscribe(handlers);
    opened.push('event: session-run\ndata: {"type":"run_finished"}\n\n');

    const error = await settled();
    expect(error).toBeInstanceOf(SessionRunStreamError);
  });

  it("delivers the contract's frames in order and reads the light snapshot for the ids it is given", async () => {
    const opened = stream();
    const request = vi.fn((path: string, _init: RequestInit) =>
      path === "/sessions/run-events"
        ? Promise.resolve(opened.response())
        : Promise.resolve(
            new Response(JSON.stringify({ sessions: [{ sessionId: a, latestRun: null }] }), { status: 200 }),
          ),
    );
    const host = createAgentHostClient({ request });
    const frames: string[] = [];
    const detach = host.sessionRuns.subscribe({ frame: async (frame) => void frames.push(frame.type), error: () => {} });
    opened.push('event: session-run\ndata: {"type":"ready"}\n\n');
    opened.push(`event: session-run\ndata: {"type":"run_started","sessionId":"${a}","runId":"${a}"}\n\n`);
    await until(() => frames.length === 2);
    detach();

    expect(frames).toEqual(["ready", "run_started"]);

    // A conversation that is no longer readable is simply absent, as the host returns it; the other rows still apply.
    const snapshot = await host.sessionRuns.read([a, "22222222-2222-4222-8222-222222222222"]);
    expect(snapshot.sessions.map((entry) => entry.sessionId)).toEqual([a]);
    expect(JSON.parse(String(request.mock.calls.at(-1)![1].body))).toEqual({
      sessionIds: [a, "22222222-2222-4222-8222-222222222222"],
    });
  });
});
