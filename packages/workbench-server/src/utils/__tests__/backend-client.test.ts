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
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });

vi.mock("../../logging/logger", () => ({ createLogger: () => ({ error() { }, warn() { }, info() { }, debug() { } }) }));

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
  it("classifies 401/403 with detail and header preservation", async () => {
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
    expect(unreadable).toBeInstanceOf(AuthFailedError);

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
