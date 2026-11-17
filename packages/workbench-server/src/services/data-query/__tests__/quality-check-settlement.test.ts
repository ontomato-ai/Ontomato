import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";
import { LATE_FACT_SETTLE_TIMEOUT_MS, startQualityCheckSettlement } from "../late-fact";

const saved = vi.hoisted(() => vi.fn(async (_input: any) => 1));
vi.mock("../query-run-store", () => ({ updateQueryRunQualityCheck: saved }));
vi.mock("../../../logging/logger", () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {} }),
}));
vi.mock("../../../config/data-query-api", () => ({
  getApiConfig: () => ({ endpoints: { check: "/check/queryBySessionId" } }),
  buildUrl: (_config: unknown, endpoint: string) => `http://backend${endpoint}`,
  buildHeaders: () => ({}),
}));

const input = {
  identity: { threadId: "thread", requestSeq: 0, sourceKind: "query" as const, sourceRef: "query" },
  sessionId: "session",
  abcQuestionMode: "harness" as const,
  locale: "en",
};

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  saved.mockClear();
});

function sse(body: string) {
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function pendingRequest() {
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    const abort = () => reject(init.signal!.reason);
    if (init.signal!.aborted) abort();
    else init.signal!.addEventListener("abort", abort, { once: true });
  }));
}

describe("quality-check settlement at the backend response boundary", () => {
  it("persists and publishes the actual permission failure returned as HTTP 200 JSON", async () => {
    const permission = "/check/queryBySessionId-v2";
    vi.stubGlobal("fetch", async () => Response.json({
      success: false, code: 403, message: `Permission denied: ${permission}`, data: null,
    }));
    const states: string[] = [];

    await startQualityCheckSettlement({ ...input, onState: (state) => states.push(state.status) });

    expect(states.at(-1)).toBe("failed");
    const record = saved.mock.calls[0]![0];
    expect(record.qcState.status).toBe("failed");
    expect(record.qcState.steps.some((step: any) => step.meaning?.includes(permission))).toBe(true);
    expect(record.qcResult).toBeUndefined();
  });

  it.each(["", 'data: {"summary":"Description ready"}\n\n'])(
    "ends as failed when the stream closes without a conclusion: %s", async (body) => {
      vi.stubGlobal("fetch", async () => sse(body));
      await startQualityCheckSettlement(input);
      expect(saved.mock.calls[0]![0].qcState.status).toBe("failed");
      expect(saved.mock.calls[0]![0].qcResult).toBeUndefined();
    }
  );

  it("persists a valid result as completed", async () => {
    vi.stubGlobal("fetch", async () => sse(
      'data: {"summary":"Description ready"}\n\ndata: {"conclusion":"Answered","score":95}\n\n'
    ));
    await startQualityCheckSettlement(input);
    expect(saved.mock.calls[0]![0].qcState.status).toBe("completed");
    expect(saved.mock.calls[0]![0].qcResult.score).toBe(95);
  });

  it("persists a timeout instead of leaving the quality check running", async () => {
    vi.useFakeTimers();
    pendingRequest();
    const settlement = startQualityCheckSettlement(input);
    await vi.advanceTimersByTimeAsync(LATE_FACT_SETTLE_TIMEOUT_MS);
    await settlement;
    expect(saved.mock.calls[0]![0].qcState.status).toBe("unsettled");
    expect(saved.mock.calls[0]![0].qcResult).toBeUndefined();
  });

  it("persists cancellation instead of leaving the quality check running", async () => {
    pendingRequest();
    const controller = new AbortController();
    const settlement = startQualityCheckSettlement({ ...input, signal: controller.signal });
    controller.abort();
    await settlement;
    expect(saved.mock.calls[0]![0].qcState.status).toBe("unsettled");
    expect(saved.mock.calls[0]![0].qcResult).toBeUndefined();
  });
});
