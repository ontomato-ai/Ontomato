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
      await forward({ owner: "workbench", credentialHeader: "X-Ontomato-Callback-Credential", pathPrefix: new URL("http://workbench.test/api/executions/workbench").pathname, baseUrl: "http://workbench.test/api/executions/workbench", credential: "wbc1.fixture" },
        runId, new AbortController().signal);
    },
  });
  try {
    const { host, port } = callback.endpoint;
    const url = `http://${host}:${port}${businessPath}`;
    const body = Uint8Array.of(0, 1, 193, 127, 255);
    const response = await nativeFetch(url, {
      method, body, headers: { tk: sessionCredential, "Content-Type": "application/octet-stream",
        "X-Ontomato-Execution-Context": '{"kind":"preview"}' },
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
    expect(headers.get("X-Ontomato-Agent-Execution")).toBe(runId);
    expect(headers.get("X-Ontomato-Execution-Context")).toBe('{"kind":"preview"}');
    expect(headers.has("tk")).toBe(false);
  } finally {
    await callback.close();
  }
});

it("relays a provider-owned grant and the active run only to the declared path boundary", async () => {
  const nativeFetch = globalThis.fetch;
  const upstream = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", upstream);
  const callback = await openSkillCallback({
    async sessionChannelCommand() {},
    async withBusinessCallback(_scope, _session, kind, credential, forward) {
      expect(kind).toBe("ontology");
      expect(credential).toBe(sessionCredential);
      await forward({
        owner: "ontology", baseUrl: "http://ontology.test", pathPrefix: "/ontology/",
        credentialHeader: "tk", credential: "oq.fixture.signed",
      }, runId, new AbortController().signal);
    },
  });
  try {
    const { host, port } = callback.endpoint;
    const url = `http://${host}:${port}/v1/channel/hosts/host/domains/domain/sessions/${sessionId}/business/ontology`;
    const headers = { tk: sessionCredential, "X-Ontomato-Run-Id": "client-supplied" };
    expect((await nativeFetch(url + "/ontology/retrievals/runtime-context", { headers })).status).toBe(204);
    const [target, request] = upstream.mock.calls[0];
    expect(String(target)).toBe("http://ontology.test/ontology/retrievals/runtime-context");
    const forwarded = new Headers(request?.headers);
    expect(forwarded.get("tk")).toBe("oq.fixture.signed");
    expect(forwarded.get("X-Ontomato-Run-Id")).toBe(runId);
    expect(forwarded.has("X-Ontomato-Callback-Credential")).toBe(false);
    expect((await nativeFetch(url + "/ontology-admin/query", { headers })).status).toBe(403);
    expect((await nativeFetch(url + "/ontology/%2e%2e%2fsecret", { headers })).status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
  } finally {
    await callback.close();
  }
});
