import { afterEach, expect, it, vi } from "vitest";
import { businessCallbackEnvironment } from "../business-callback";
import { RuntimeError } from "../errors";
import { openSkillCallback } from "../skill-callback";

const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const sessionCredential = "session-callback-token";
const businessPath = `/v1/channel/hosts/host/domains/domain/sessions/${sessionId}/business/workbench/page`;

afterEach(() => { vi.unstubAllGlobals(); });

it("supplies the legacy tk variable using the session credential", () => {
  const env = businessCallbackEnvironment("http://sandbox.test/session", sessionCredential);
  expect(env.ONTOMATO_TK).toBe(env.ONTOMATO_EXECUTION_CALLBACK);
  expect(env).not.toHaveProperty("ONTOMATO_API_KEY");
});

it.each(["PUT", "DELETE"])("authenticates %s with tk and forwards the full body under the declared credential", async method => {
  const nativeFetch = globalThis.fetch;
  const upstream = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", upstream);
  const callback = await openSkillCallback({
    async sessionChannelCommand() {},
    async withBusinessCallback(_scope, _session, kind, credential, forward) {
      if (kind !== "workbench" || credential !== sessionCredential)
        throw new RuntimeError(401, "UNAUTHENTICATED", "Invalid session credential");
      await forward({ baseUrl: "http://workbench.test/api/executions/workbench", credential: "wbc1.fixture" },
        runId, new AbortController().signal);
    },
  });
  try {
    const { host, port } = callback.endpoint;
    const url = `http://${host}:${port}${businessPath}`;
    const body = Uint8Array.of(0, 1, 193, 127, 255);
    const response = await nativeFetch(url, {
      method, body, headers: { tk: sessionCredential, "Content-Type": "application/octet-stream" },
    });
    expect(response.status).toBe(204);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [target, forwarded] = upstream.mock.calls[0];
    expect(String(target)).toBe("http://workbench.test/api/executions/workbench/page");
    expect(forwarded?.method).toBe(method);
    expect(Buffer.from(forwarded?.body as Uint8Array)).toEqual(Buffer.from(body));
    const headers = new Headers(forwarded?.headers);
    expect(headers.get("X-Ontomato-Callback-Credential")).toBe("wbc1.fixture");
    expect(headers.get("X-Ontomato-Run-Id")).toBe(runId);
    expect(headers.has("tk")).toBe(false);
  } finally {
    await callback.close();
  }
});

it("rejects unsupported methods before dispatching a business request", async () => {
  const withBusinessCallback = vi.fn();
  const callback = await openSkillCallback({ async sessionChannelCommand() {}, withBusinessCallback });
  try {
    const { host, port } = callback.endpoint;
    for (const method of ["HEAD", "OPTIONS"]) {
      const response = await fetch(`http://${host}:${port}${businessPath}`, { method });
      expect(response.status).toBe(405);
    }
    expect(withBusinessCallback).not.toHaveBeenCalled();
  } finally {
    await callback.close();
  }
});
