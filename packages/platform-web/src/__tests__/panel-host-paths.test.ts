import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import en from "element-plus/es/locale/lang/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { PANEL_PERSONAL_STATE_PATH, PANEL_PERSONAL_STATE_READ_PATH } from "@ontomato/contracts/panel-host";
import { usePanelInstance, type PanelHostLabels } from "@ontomato/platform-shell";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { installAppHost } from "../app-host";
import { cachedApplicationFrameManifest, framePanelHost, panelHostPaths, platformPanelHost, readApplicationFrameManifest } from "../panel-host";

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

/** What Node answers for the deployment's current SDK, and the manifest of that release. */
const current = {
  version: "1.1.0", digest: "a".repeat(64), publicBasePath: "", sdkBasePath: "/apps-sdk/current",
  manifestPath: "/apps-sdk/current/sdk.json", componentsPath: "/apps-sdk/current/components.json",
  checkPath: "/apps-sdk/current/node/panel-check.mjs", docsPath: "/apps-sdk/current/docs/index.md", referencePath: "/apps-sdk/current/docs/reference.md",
};
const manifest = {
  version: "1.1.0", product: "workbench", executionContext: 1, hostTransport: 1, messageBridge: 2,
  entries: { vue: "vue.js", "@ontomato/sdk/panel": "panel.js" }, stylesheet: "styles/sdk.css", components: "components.json",
  check: "node/panel-check.mjs",
  packageComponents: "node/package-components.mjs", libraries: { vue: "3.5.0" }, docs: "docs/index.md",
};

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
    const body = url.endsWith("/api/apps-sdk/current") ? current
        : url === current.manifestPath ? manifest
        : url.includes("/panel-uses")
          ? { data: { applicationId: "app-a", entry: { path: "/tasks", renderer: "panels" }, panelUses: [] } }
          : new URL(url, "http://localhost").pathname.endsWith("/snapshot")
            ? { panel: { id: "panel-a", revision: 1 }, projections: [], pageSkillContext: { mode: "member", locator: { access: "domain-member", pageKey: "tasks" }, member: null } }
            : { panel: null };
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
    expect(panelHostPaths.definitionStream).toBe("/api/product-panels/definition-stream");
  });

  it("sends each read to the address its owner serves", async () => {
    const { candidatePanelHost, panelAuthorDefinitions, platformPanelHost, resolveApplicationEntry } = await import("../panel-host");
    const use = { id: "use-a", pageKey: "tasks", panelId: "panel-a", path: "/applications/app-a/tasks", access: { kind: "domain-member" as const } };
    const port = platformPanelHost("app-a", use, () => {});
    // Java resolves the entry an address opens; what it answers is the stand-in's business here.
    await resolveApplicationEntry({ path: "/applications/app-a/tasks" }).catch(() => {});
    // The record's contents are the stand-in's business, not this test's: what it asserts is the address each read went
    // to. A read that refuses is as good an observation as one that answers.
    await port.panel("panel-a").catch(() => {});
    // The deployment's one current release: Node names it and where it is, and its manifest is read from there.
    expect(await port.release()).toEqual({ base: "/apps-sdk/current", manifest });
    await port.snapshot("panel-a");
    const observer = panelAuthorDefinitions().observe([target], () => {}, error => { throw error; });
    try {
      await candidatePanelHost({ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", ref: "working", pageKey: "tasks" }).source().catch(() => {});
      await vi.waitFor(() => expect(requested.length).toBe(7));
      expect(requested.map((one) => `${one.method} ${one.url}`)).toEqual([
        "GET /api/data-query/platform/applications/resolve-entry?path=%2Fapplications%2Fapp-a%2Ftasks",
        "GET /api/product-panels/panel-a?includeProjections=1",
        "GET /api/apps-sdk/current",
        "GET /apps-sdk/current/sdk.json",
        // A page's snapshot is read for that page: Node confirms which page skill member it reaches with it.
        "GET /api/product-panels/panel-a/snapshot?applicationId=app-a&useId=use-a&pageKey=tasks&access=domain-member",
        "POST /api/product-panels/definition-stream",
        "GET /api/workspaces/7c9e6679-7425-40de-944b-e07fc1f90ae7/panel-candidate?ref=working",
      ]);
    } finally {
      observer.close();
    }
    expect(subscriptionSignal?.aborted).toBe(true);
    expect(requested).toHaveLength(7);
  });
});

it("refreshes a cached frame default for an entry opened beside a conversation", async () => {
  const use = { id: "use-a", pageKey: "tasks", panelId: "panel-a", path: "/applications/app-a/tasks", access: { kind: "domain-member" as const } };
  const framePanelId = "term-frame";
  const frameManifest = (term: string) => definePanel({
    state: { term: { type: { kind: "scalar", type: "string" }, external: true, deepLink: true, default: term } },
    members: {},
  });
  let revision = 1;
  let term = "fall";
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === panelHostPaths.snapshot(framePanelId)) {
      return Response.json({ panel: { id: framePanelId, revision }, projections: [] });
    }
    expect(url.pathname).toBe(panelHostPaths.panel(framePanelId));
    return Response.json({ panel: {
      id: framePanelId, revision, name: "Terms", description: "", visibility: "domain",
      domainId: "domain-1", ownerId: "owner-1", editable: true,
      createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:00.000Z",
      content: { html: '<div id="app"></div>' }, manifest: frameManifest(term),
    } });
  });

  const fullPage = framePanelHost("app-a", use, framePanelId, () => {});
  await fullPage.source();
  expect(cachedApplicationFrameManifest("app-a", framePanelId)?.state.term?.default).toBe("fall");

  revision = 2;
  term = "spring";
  const beside = await readApplicationFrameManifest("app-a", use, framePanelId);
  expect(beside.state.term?.default).toBe("spring");
  expect((await fullPage.source()).panel.manifest.state.term?.default).toBe("spring");
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

describe("personal state with external-only entry inputs", () => {
  beforeEach(() => {
    installAppHost({
      credential: { type: "anonymous" },
      preferences: { locale: ref("en"), locales: ["en"], theme: ref("light"), setLocale: () => {}, setTheme: () => {} } as PlatformPreferences,
      router: createRouter({ history: createMemoryHistory(), routes: [] }),
      onAuthFailure: vi.fn(),
    });
  });

  const hostLabels: PanelHostLabels = {
    notStarted: "Not started",
    failures: { fileUnavailable: "Could not load {file}", scriptThrew: "Script failed", scriptRejected: "Script rejected" },
    content: { styleOutside: "Style outside" },
    draft: { opening: "Opening the draft", close: "Close", toAgent: "To agent", toAgentText: "Unused: {reason}" },
    refresh: "Refresh",
  };
  const use = {
    id: "use-personal-ext",
    pageKey: "personal-ext",
    panelId: "panel-personal-ext",
    path: "/applications/app-a/personal-ext",
    access: { kind: "domain-member" as const },
  };
  const panelManifest = definePanel({
    state: {
      term: { type: { kind: "scalar", type: "string" }, external: true, personal: true, deepLink: false, default: "autumn" },
      campus: { type: { kind: "scalar", type: "string" }, external: true, deepLink: false, default: "north" },
    },
    members: {},
  });

  function stubPersonalHostFetch(savedValues: Record<string, unknown>, writes: Record<string, unknown>[]) {
    vi.stubGlobal("fetch", async (input: string | URL, init?: { method?: string; body?: string }) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === `/api${PANEL_PERSONAL_STATE_READ_PATH}`) {
        return Response.json({ values: savedValues });
      }
      if (url.pathname === `/api${PANEL_PERSONAL_STATE_PATH}` && init?.method === "PUT") {
        writes.push(JSON.parse(init.body ?? "{}").values as Record<string, unknown>);
        return Response.json({ values: savedValues });
      }
      if (url.pathname === panelHostPaths.snapshot(use.panelId)) {
        return Response.json({
          panel: { id: use.panelId, revision: 1 },
          projections: [],
          pageSkillContext: { mode: "member", locator: { access: "domain-member", pageKey: use.pageKey }, member: null },
        });
      }
      if (url.pathname === panelHostPaths.pageSkillContext(use.panelId)) {
        return Response.json({
          pageSkillContext: { mode: "member", locator: { access: "domain-member", pageKey: use.pageKey }, member: null },
        });
      }
      if (url.pathname === panelHostPaths.panel(use.panelId)) {
        return Response.json({
          panel: {
            id: use.panelId,
            revision: 1,
            name: "Personal External",
            description: "",
            visibility: "domain",
            domainId: "domain-1",
            ownerId: "owner-1",
            editable: true,
            createdAt: "2026-11-24T00:00:00.000Z",
            updatedAt: "2026-11-24T00:00:00.000Z",
            content: { html: '<div id="app"><span>panel</span></div>', module: "" },
            manifest: panelManifest,
          },
          projections: {},
        });
      }
      return Response.json({});
    });
  }

  function mountedState(view: ReturnType<typeof usePanelInstance>) {
    const mount = view.direct.value?.mount as {
      instance: { state: { values: { value: Record<string, unknown> }; set(name: string, value: unknown): void } };
    } | undefined;
    return mount!.instance.state;
  }

  it("restores saved personal state instead of declared default and never overwrites personal storage when an external entry value is withdrawn", async () => {
    const writes: Record<string, unknown>[] = [];
    stubPersonalHostFetch({ term: "summer" }, writes);
    vi.useFakeTimers();
    const inputs = ref<Record<string, string>>({ term: "spring", campus: "south" });
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => use.path,
        initial: () => ({}),
        entryInputs: () => inputs.value,
        wired: () => ["term", "campus"],
      }))!;
      await view.ready;
      expect(view.error.value).toBe("");

      expect(mountedState(view).values.value).toEqual({ term: "spring", campus: "south" });

      inputs.value = {};
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);

      expect(mountedState(view).values.value).toEqual({ term: "summer", campus: "north" });
      expect(writes).toEqual([]);
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
    expect(writes).toEqual([]);
  });

  it("ignores external entry overrides in personal-state persistence while still saving explicit user changes", async () => {
    const writes: Record<string, unknown>[] = [];
    stubPersonalHostFetch({ term: "summer" }, writes);
    vi.useFakeTimers();
    const inputs = ref<Record<string, string>>({});
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => use.path,
        initial: () => ({}),
        entryInputs: () => inputs.value,
        wired: () => ["term", "campus"],
      }))!;
      await view.ready;

      expect(mountedState(view).values.value).toEqual({ term: "summer", campus: "north" });

      inputs.value = { term: "spring", campus: "south" };
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mountedState(view).values.value).toEqual({ term: "spring", campus: "south" });
      expect(writes).toEqual([]);

      inputs.value = {};
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mountedState(view).values.value).toEqual({ term: "summer", campus: "north" });
      expect(writes).toEqual([]);

      mountedState(view).set("term", "winter");
      await vi.advanceTimersByTimeAsync(500);
      expect(writes).toEqual([{ term: "winter" }]);
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("falls back to declared default without persisting when no personal value was saved", async () => {
    const writes: Record<string, unknown>[] = [];
    stubPersonalHostFetch({}, writes);
    vi.useFakeTimers();
    const inputs = ref<Record<string, string>>({ term: "spring" });
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => use.path,
        initial: () => ({}),
        entryInputs: () => inputs.value,
        wired: () => ["term", "campus"],
      }))!;
      await view.ready;

      expect(mountedState(view).values.value).toEqual({ term: "spring", campus: "north" });

      inputs.value = {};
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);

      expect(mountedState(view).values.value).toEqual({ term: "autumn", campus: "north" });
      expect(writes).toEqual([]);
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
    expect(writes).toEqual([]);
  });
});
