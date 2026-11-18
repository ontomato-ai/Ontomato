import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import en from "element-plus/es/locale/lang/en";
import { ElMessage } from "element-plus";
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

beforeEach(() => {
  requested.length = 0;
  subscriptionSignal = undefined;
  vi.stubGlobal("fetch", async (input: string | URL, init?: { method?: string; signal?: AbortSignal }) => {
    const url = String(input);
    requested.push({ method: init?.method ?? "GET", url: new URL(url, "http://localhost").pathname + new URL(url, "http://localhost").search });
    if (url.includes("/subscriptions")) {
      subscriptionSignal = init?.signal;
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    }
    const body = url.endsWith("/apps-sdk/current")
        ? { version: "1.1.0", publicBasePath: "/apps-sdk", sdkBasePath: "/apps-sdk/1.1.0", manifestPath: "", docsPath: "", referencePath: "" }
        : url.includes("/panel-uses")
          ? { data: { applicationId: "app-a", entry: { path: "/tasks", renderer: "panels" }, panelUses: [] } }
          : { panel: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(panelHostPaths.subscriptions).toBe("/api/product-assets/subscriptions");
  });

  it("sends each read to the address its owner serves", async () => {
    const { platformPanelHost, panelUsesOf } = await import("../panel-host");
    const port = platformPanelHost("app-a");
    await panelUsesOf("app-a");
    // The record's contents are the stand-in's business, not this test's: what it asserts is the address each read went
    // to. A read that refuses is as good an observation as one that answers.
    await port.panel("panel-a").catch(() => {});
    await port.sdkBase();
    const stop = port.subscribe("panel-a", () => {}, async () => {});
    await vi.waitFor(() => expect(requested.length).toBe(4));
    expect(requested.map((one) => `${one.method} ${one.url}`)).toEqual([
      "GET /api/data-query/platform/applications/app-a/panel-uses",
      "GET /api/product-panels/panel-a",
      "GET /api/apps-sdk/current",
      "POST /api/product-assets/subscriptions",
    ]);
    stop();
    expect(subscriptionSignal?.aborted).toBe(true);
    expect(requested).toHaveLength(4);
  });
});

it.each([403, 404, "bad-frame"] as const)("reports %s and stops instead of reopening the subscription", async refusal => {
  const message = vi.spyOn(ElMessage, "error").mockImplementation(() => ({ close() {} }));
  const request = vi.fn(async () => refusal === "bad-frame"
    ? new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })
    : Response.json({ error: { message: "Panel unavailable" } }, { status: refusal }));
  vi.stubGlobal("fetch", request);
  const { platformPanelHost } = await import("../panel-host");
  const stop = platformPanelHost("app-a").subscribe("panel-a", () => {}, async () => {});
  try {
    await vi.waitFor(() => expect(message).toHaveBeenCalledWith(
      refusal === "bad-frame" ? "Panel subscription frame broke the contract" : "Panel unavailable"));
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    message.mockRestore();
  }
});

it("reopens a failed connection and recovers from the next snapshot", async () => {
  const snapshot = { kind: "snapshot", panel: { id: "panel-a", revision: 1 }, projections: [] };
  const request = vi.fn().mockRejectedValueOnce(new TypeError("Network unavailable")).mockImplementationOnce(async () =>
    new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(snapshot)}\n\n`)); },
    }), { headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", request);
  const { platformPanelHost } = await import("../panel-host");
  const recover = vi.fn(async () => {});
  const stop = platformPanelHost("app-a").subscribe("panel-a", () => {}, recover);
  try {
    await vi.waitFor(() => expect(recover).toHaveBeenCalledWith(snapshot));
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});
