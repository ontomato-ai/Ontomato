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

beforeEach(() => {
  requested.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL, init?: { method?: string }) => {
    const url = String(input);
    requested.push({ method: init?.method ?? "GET", url: new URL(url, "http://localhost").pathname + new URL(url, "http://localhost").search });
    const body = url.includes("/subscriptions")
      ? { id: "subscription-1", intervalMs: 60000, events: [] }
      : url.endsWith("/apps-sdk/current")
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
    expect(panelHostPaths.subscription("subscription-1")).toBe("/api/product-assets/subscriptions/subscription-1");
  });

  it("sends each read to the address its owner serves", async () => {
    const { platformPanelHost, panelUsesOf } = await import("../panel-host");
    const port = platformPanelHost("app-a");
    await panelUsesOf("app-a");
    // The record's contents are the stand-in's business, not this test's: what it asserts is the address each read went
    // to. A read that refuses is as good an observation as one that answers.
    await port.panel("panel-a").catch(() => {});
    await port.sdkBase();
    const stop = port.subscribe("panel-a", () => {});
    await vi.waitFor(() => expect(requested.length).toBe(4));
    expect(requested.map((one) => `${one.method} ${one.url}`)).toEqual([
      "GET /api/data-query/platform/applications/app-a/panel-uses",
      "GET /api/product-panels/panel-a",
      "GET /api/apps-sdk/current",
      "POST /api/product-assets/subscriptions",
    ]);
    stop();
    await vi.waitFor(() => expect(requested.at(-1)).toEqual({
      method: "DELETE",
      url: "/api/product-assets/subscriptions/subscription-1",
    }));
  });
});
