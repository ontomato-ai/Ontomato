import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import en from "element-plus/es/locale/lang/en";
import { panelHostPaths } from "../panel-host";

/*
 * The panel host's addresses (design 10.3): each request goes to the owner it belongs to, and the two owners differ.
 *
 * The mistake this guards: an address assembled from the wrong owner's habit. Java's use relations live under
 * `/api/data-query/platform/...`; Node's own routes are mounted at `/api` with no data-query prefix, so the SDK's current
 * version is `/api/apps-sdk/current`. A host test with a stand-in port cannot see this — it never builds the address —
 * so the addresses themselves are asserted here.
 */

installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
});

// The request layer sends the reader's language with every call, so the page it is called from has one installed.
installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});

const requested: { method: string; url: string }[] = [];
let subscriptionSignal: AbortSignal | undefined;
const target = { kind: "panel", id: "panel-a" } as const;

beforeEach(() => {
  requested.length = 0;
  subscriptionSignal = undefined;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  vi.stubGlobal("fetch", async (input: string | URL, init?: { method?: string; signal?: AbortSignal }) => {
    const url = String(input);
    requested.push({ method: init?.method ?? "GET", url: new URL(url, "http://localhost").pathname + new URL(url, "http://localhost").search });
    if (url.includes("/definition-stream")) {
      subscriptionSignal = init?.signal;
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    }
    const body = url.endsWith("/apps-sdk/current")
        ? { version: "1.1.0", publicBasePath: "", sdkBasePath: "/apps-sdk/1.1.0", manifestPath: "", docsPath: "", referencePath: "" }
        : url.includes("/panel-uses")
          ? { data: { applicationId: "app-a", entry: { path: "/tasks", renderer: "panels" }, panelUses: [] } }
          : url.endsWith("/snapshot") ? { panel: { id: "panel-a", revision: 1 }, projections: [] } : { panel: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the panel host's addresses", () => {
  it("asks Node for the SDK's current version under /api, with no data-query prefix", () => {
    expect(panelHostPaths.appsSdkCurrent).toBe("/api/apps-sdk/current");
  });

  it("asks Java for an application's use relations under /api/data-query", () => {
    expect(panelHostPaths.applicationPanelUses("app-a")).toBe("/api/data-query/platform/applications/app-a/panel-uses");
  });

  it("asks Node for panels, projections and subscriptions under /api", () => {
    expect(panelHostPaths.panel("panel-a")).toBe("/api/product-panels/panel-a");
    expect(panelHostPaths.definitionStream).toBe("/api/product-assets/definition-stream");
  });

  it("sends each read to the address its owner serves", async () => {
    const { candidatePanelHost, panelAuthorDefinitions, platformPanelHost, panelUsesOf } = await import("../panel-host");
    const use = { id: "use-a", pageKey: "tasks", panelId: "panel-a", path: "/applications/app-a/tasks", access: { kind: "domain-member" as const } };
    const port = platformPanelHost("app-a", use);
    await panelUsesOf("app-a");
    // The record's contents are the stand-in's business, not this test's: what it asserts is the address each read went
    // to. A read that refuses is as good an observation as one that answers.
    await port.panel("panel-a").catch(() => {});
    // The SDK's root is where Node serves its builds; a frame loads the exact version its definition names under it.
    expect(await port.sdkRoot()).toBe("/apps-sdk");
    await port.snapshot("panel-a");
    const observer = panelAuthorDefinitions().observe([target], () => {}, error => { throw error; });
    await candidatePanelHost({ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", ref: "working", pageKey: "tasks" }).source().catch(() => {});
    await vi.waitFor(() => expect(requested.length).toBe(6));
    expect(requested.map((one) => `${one.method} ${one.url}`)).toEqual([
      "GET /api/data-query/platform/applications/app-a/panel-uses",
      "GET /api/product-panels/panel-a",
      "GET /api/apps-sdk/current",
      "GET /api/product-panels/panel-a/snapshot",
      "POST /api/product-assets/definition-stream",
      "GET /api/workspaces/7c9e6679-7425-40de-944b-e07fc1f90ae7/panel-candidate?ref=working",
    ]);
    observer.close();
    expect(subscriptionSignal?.aborted).toBe(true);
    expect(requested).toHaveLength(6);
  });
});

it.each([403, 404, "bad-frame"] as const)("reports %s and stops instead of reopening the subscription", async refusal => {
  const onError = vi.fn();
  const request = vi.fn(async () => refusal === "bad-frame"
    ? new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })
    : Response.json({ error: { message: "Panel unavailable" } }, { status: refusal }));
  vi.stubGlobal("fetch", request);
  const { panelAuthorDefinitions } = await import("../panel-host");
  const observer = panelAuthorDefinitions().observe([target], () => {}, onError);
  try {
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message:
      refusal === "bad-frame" ? "Product definition stream frame broke the contract" : "Panel unavailable" })));
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    observer.close();
  }
});

it("backs off consecutive failures, resets on a snapshot, and cancels a pending reconnect", async () => {
  const snapshot = { kind: "snapshot", definitions: [{ ...target, revision: 1 }] };
  const headers = { "Content-Type": "text/event-stream" };
  const request = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockRejectedValueOnce(new TypeError("Network unavailable"))
    .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(snapshot)}\n\n`, { headers }))
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockImplementation(async () => new Response(new ReadableStream(), { headers }));
  vi.stubGlobal("fetch", request);
  const { panelAuthorDefinitions } = await import("../panel-host");
  const onRevision = vi.fn();
  vi.useFakeTimers();
  const observer = panelAuthorDefinitions().observe([target], onRevision, error => { throw error; });
  try {
    await vi.advanceTimersByTimeAsync(499);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(onRevision).toHaveBeenCalledWith(snapshot.definitions);

    await vi.advanceTimersByTimeAsync(499);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(1);

    observer.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(request).toHaveBeenCalledTimes(4);
  } finally {
    observer.close();
    vi.useRealTimers();
  }
});
