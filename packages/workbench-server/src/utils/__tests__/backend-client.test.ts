import { afterEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../i18n";
import { appTextEn } from "../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import {
  AuthFailedError,
  BackendResponseError,
  BackendUnavailableError,
  backendGet,
  checkBackendResponse,
  getCircuitStatus,
} from "../../utils/backend-client";
import { extractJson, truncateText } from "../../utils/prompt-context";
import { HttpError } from "../errors";
import { DashboardMetricClient } from "../../services/dashboard/metric-client";
import { OntologyRetrievalClient } from "../../services/assistant/ontology-retrieval";
import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { WorkspaceBuildTests } from "../../services/app-builder/build-tests";
import { getDashboardConditions, queryDashboardData } from "../../services/dashboard/dsl-execution";
import { wrap } from "../../api/utils/agent-host";
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });

vi.mock("../../logging/logger", () => ({ createLogger: () => ({ error() { }, warn() { }, info() { }, debug() { } }) }));
vi.mock("../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://engine" } } }));

function fakeResponse(status: number, body: string | null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "x-trace": "t5c" }),
    text: async () => {
      if (body === null) throw new Error("body gone");
      return body;
    },
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("backend HTTP failures and recovery", () => {
  it("distinguishes authentication from permission refusal and preserves HTTP details", async () => {
    const auth = await checkBackendResponse(fakeResponse(401, "gone")).then(
      () => null,
      (error: unknown) => error
    );
    expect(auth).toBeInstanceOf(AuthFailedError);

    expect((auth as AuthFailedError).status).toBe(401);
    expect((auth as AuthFailedError).detail).toBe("gone");
    expect((auth as AuthFailedError).headers?.get("x-trace")).toBe("t5c");

    const unreadable = await checkBackendResponse(fakeResponse(403, null)).then(
      () => null,
      (error: unknown) => error
    );
    expect(unreadable).toBeInstanceOf(BackendResponseError);
    expect(unreadable).not.toBeInstanceOf(AuthFailedError);
    expect(unreadable).toMatchObject({ status: 403, code: "FORBIDDEN" });

    expect((unreadable as AuthFailedError).detail).toBe("");

    const http = await checkBackendResponse(fakeResponse(404, "gone")).then(
      () => null,
      (error: unknown) => error
    );
    expect(http).toBeInstanceOf(BackendResponseError);

    expect((http as BackendResponseError).status).toBe(404);
    expect((http as BackendResponseError).detail).toBe("gone");
    expect((http as BackendResponseError).headers?.get("x-trace")).toBe("t5c");
  });

  it.each([false, true])("preserves a Java permission refusal before buffered/stream consumption (%s)", async (stream) => {
    const message = "Operation permission is required: /dashboard/getConditionsFromDsls";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: false, code: 403, message }), { status: 403 }));
    vi.stubGlobal("fetch", fetchSpy);
    const error = await backendGet(`permission-${stream}`, "http://engine/denied", { stream, retries: 3 } as Parameters<typeof backendGet>[2]).catch(error => error);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toBeInstanceOf(BackendResponseError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", message });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getCircuitStatus(`permission-${stream}`).consecutiveFailures).toBe(0);
  });

  it("parses the complete error envelope before limiting the retained raw detail", async () => {
    const message = "Permission refused: " + "resource ".repeat(50);
    const error = await checkBackendResponse(fakeResponse(403, JSON.stringify({ error: { code: "RESOURCE_FORBIDDEN", message } })), 20).catch(error => error);
    expect(error).toMatchObject({ status: 403, code: "RESOURCE_FORBIDDEN", message });
    expect(error.detail).toHaveLength(20);
    const expired = await checkBackendResponse(fakeResponse(401, JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Credential expired" } }))).catch(error => error);
    expect(expired).toBeInstanceOf(AuthFailedError);
    expect(expired).toBeInstanceOf(HttpError);
    expect(expired).toMatchObject({ status: 401, code: "UNAUTHENTICATED", message: "Credential expired" });
  });

  const owner = { domainId: "domain", userId: "limited" };
  const retrieval = new OntologyRetrievalClient(owner, "caller");
  it.each([
    ["metric", () => new DashboardMetricClient("domain", {}).describe("metric")],
    ["retrieval JSON", () => retrieval.links()],
    ["retrieval SSE", () => retrieval.events("session", "run", { seq: 0, streamId: "stream" }, new AbortController().signal)],
    ["application admission", () => assertAppBuilderAccess({})],
    ["build test", () => new WorkspaceBuildTests(owner, {}, "workspace").java("GET", "/current")],
    ["dashboard conditions", () => getDashboardConditions([{}], "token")],
    ["dashboard DSL rows", () => queryDashboardData({ dsl: {}, fields: { x: "name" } }, "token")],
    ["dashboard ABC rows", () => queryDashboardData({ abcProgram: { code: "print(1)", outKeyRefs: [{ key: "k" }] }, fields: { x: "name" } }, "token")],
  ] as const)("keeps the Java refusal through %s and the agent-host HTTP boundary", async (_name, operation) => {
    const message = "Operation permission is required: /protected/read";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, code: 403, message }, { status: 403 })));
    const response = await new Promise<{ status: number; body: unknown }>((resolve) => {
      let status = 0;
      const res = { status(value: number) { status = value; return this; }, json(body: unknown) { resolve({ status, body }); } };
      wrap(async () => { await operation(); throw new Error("Refusal was accepted"); })({} as never, res as never, () => {});
    });
    expect(response).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN", message } } });
  });

  it.each([[404, "METRIC_UNAVAILABLE"], [409, "METRIC_SPEC_CHANGED"]])("keeps the metric-specific HTTP %i mapping", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "SOURCE_ERROR", message: "Metric changed" } }, { status: Number(status) })));
    await expect(new DashboardMetricClient("domain", {}).describe("metric")).rejects.toMatchObject({ status, code, message: "Metric changed" });
  });

  it("reports cancellation before any network use", async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(200, "ok"));
    vi.stubGlobal("fetch", fetchSpy);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await backendGet("t5c-cancel", "http://127.0.0.1:9/x", {
      signal: controller.signal,
      retries: 1,
    }).then(
      () => null,
      (error: unknown) => error as Error
    );

    expect(cancelled).toBeInstanceOf(Error);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("backs off, records, and recovers the circuit on a fake endpoint", async () => {
    const endpoint = "t5c-circuit";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fake-net-down");
      })
    );
    const failed = await backendGet(endpoint, "http://127.0.0.1:9/x", {
      retries: 2,
      timeoutMs: 5000,
    }).then(
      () => null,
      (error: unknown) => error
    );
    expect(failed).toBeInstanceOf(BackendUnavailableError);

    expect((failed as BackendUnavailableError).cause).toBeInstanceOf(Error);

    expect(getCircuitStatus(endpoint).consecutiveFailures).toBe(1);

    for (let i = 0;i < 4;i += 1) {
      await backendGet(endpoint, "http://127.0.0.1:9/x", { retries: 1, timeoutMs: 5000 }).then(
        () => null,
        () => null
      );
    }
    expect(getCircuitStatus(endpoint).isOpen).toBe(true);

    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, "ok")));
      const recovered = await backendGet(endpoint, "http://127.0.0.1:9/x", {
        retries: 1,
        timeoutMs: 5000,
      });
      expect((recovered as { status: number }).status).toBe(200);
      expect(getCircuitStatus(endpoint).isOpen).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("preserves short content and rejects missing JSON", async () => {

    expect(truncateText("short", 60)).toBe("short");

    expect(extractJson('```json\n{"marker": 1}\n```', "marker")).toBe('{"marker": 1}');
    const missing = (() => {
      try {
        extractJson("no json here", "marker");
        return null;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(missing).toBeInstanceOf(Error);

  });

});
