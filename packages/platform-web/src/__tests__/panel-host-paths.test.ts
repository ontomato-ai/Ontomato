import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import en from "element-plus/es/locale/lang/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { PANEL_NESTED_READ_PATH, PANEL_PERSONAL_STATE_PATH, PANEL_PERSONAL_STATE_READ_PATH, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { ApplicationPanelUse, ProductProjection } from "@ontomato/contracts/product-panels";
import { usePanelInstance, type PanelHostLabels } from "@ontomato/platform-shell";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { installAppHost } from "../app-host";
import {
  clearPanelDefinitionCache,
  getCachedProjection,
  setCachedPanel,
  setCachedProjection,
} from "../panel-definition-cache";
import { builtinFramePanelHost, cachedApplicationFrameManifest, framePanelHost, panelHostPaths, platformPanelHost, readApplicationFrameManifest, readPanelData, resolveApplicationEntry } from "../panel-host";

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
            ? { panel: { id: "panel-a", revision: 1 }, projections: [] }
            : { panel: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("panel data read batching", () => {
  const read = (member: string): Extract<ProductPanelReadRequest, { dataName: string }> => ({
    source: { kind: "registered", applicationId: "app-a", useId: "use-1" },
    memberPath: [{ member }], dataName: "rows", inputs: {},
  });

  it("lets registered content reads complete while the same entry's frame batch is pending", async () => {
    const frame = { kind: "frame", applicationId: "app-a", useId: "use-1" } as const;
    const frameReads = [{ ...read("countA"), source: frame }, { ...read("countB"), source: frame }];
    const content = read("content");
    const sent: { path: string; body: unknown }[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      const body = JSON.parse(String(init.body));
      sent.push({ path, body });
      if (path.endsWith("/read-batch")) {
        await held;
        return Response.json({ results: [{ status: "empty" }, { status: "empty" }] });
      }
      return Response.json({ status: "ready", value: "content" });
    });

    const counts = Promise.all(frameReads.map(readPanelData));
    const primary = readPanelData(content);
    try {
      await Promise.resolve();
      expect(sent).toEqual([
        { path: "/api/product-panels/read-batch", body: { reads: frameReads } },
        { path: "/api/product-panels/read", body: content },
      ]);
      await expect(primary).resolves.toEqual({ status: "ready", value: "content" });
    } finally {
      release();
      await Promise.allSettled([counts, primary]);
    }
  });

  it("lets primary reads complete while supplement data from the same panel is pending", async () => {
    const primaryReads = [read("list"), read("summary")];
    const supplement = { ...read("list"), dataName: "supplement" };
    const sent: { path: string; body: unknown }[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      const body = JSON.parse(String(init.body));
      sent.push({ path, body });
      if (path.endsWith("/read-batch")) {
        return Response.json({ results: primaryReads.map(() => ({ status: "empty" })) });
      }
      await held;
      return Response.json({ status: "ready", value: "supplement" });
    });

    const primary = Promise.all(primaryReads.map(readPanelData));
    const secondary = readPanelData(supplement);
    try {
      await Promise.resolve();
      expect(sent).toEqual([
        { path: "/api/product-panels/read-batch", body: { reads: primaryReads } },
        { path: "/api/product-panels/read", body: supplement },
      ]);
      await expect(primary).resolves.toEqual([{ status: "empty" }, { status: "empty" }]);
    } finally {
      release();
      await Promise.allSettled([primary, secondary]);
    }
  });

  it("sends a lone read on /read and pairs concurrent results in request order under fake timers", async () => {
    const sent: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json(path.endsWith("/read-batch")
        ? { results: [{ status: "forbidden" }, { status: "ready", value: 42 }] }
        : { status: "empty" });
    });
    vi.useFakeTimers();
    try {
      await expect(readPanelData(read("single"))).resolves.toEqual({ status: "empty" });
      await expect(Promise.all([readPanelData(read("first")), readPanelData(read("second"))]))
        .resolves.toEqual([{ status: "forbidden" }, { status: "ready", value: 42 }]);
      expect(sent).toEqual([
        { path: "/api/product-panels/read", body: read("single") },
        { path: "/api/product-panels/read-batch", body: { reads: [read("first"), read("second")] } },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the overflow of a full batch on /read when only one item remains", async () => {
    const sent: { path: string; size: number }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      const body = JSON.parse(String(init.body));
      const empty = { status: "empty" };
      sent.push({ path, size: body.reads?.length ?? 1 });
      return Response.json(body.reads ? { results: body.reads.map(() => empty) } : empty);
    });
    const results = await Promise.all(Array.from({ length: 51 }, (_, i) => readPanelData(read(`member-${i}`))));
    expect(results).toHaveLength(51);
    expect(sent).toEqual([
      { path: "/api/product-panels/read-batch", size: 50 },
      { path: "/api/product-panels/read", size: 1 },
    ]);
  });

  it("rejects every waiter on HTTP 403 or a mismatched result count", async () => {
    const batch = () => Promise.allSettled([readPanelData(read("first")), readPanelData(read("second"))]);
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "Denied" } }, { status: 403 }));
    const rejected = { status: "rejected", reason: expect.objectContaining({ status: 403 }) };
    await expect(batch()).resolves.toEqual([rejected, rejected]);

    vi.stubGlobal("fetch", async () => Response.json({ results: [{ status: "empty" }] }));
    const mismatch = { status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("count") }) };
    await expect(batch()).resolves.toEqual([mismatch, mismatch]);
  });
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
    const use = { id: "use-a", pageKey: "tasks", panelId: "panel-a", path: "/applications/app-a/tasks", };
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
        "GET /api/product-panels/application-entry?path=%2Fapplications%2Fapp-a%2Ftasks",
        "GET /api/product-panels/panel-a?includeProjections=1&view=1",
        "GET /api/apps-sdk/current",
        "GET /apps-sdk/current/sdk.json",
        "GET /api/product-panels/panel-a/snapshot",
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
  const use = { id: "use-a", pageKey: "tasks", panelId: "panel-a", path: "/applications/app-a/tasks", };
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

describe("controlled personal state fields", () => {
  beforeEach(() => {
    clearPanelDefinitionCache();
    installAppHost({
      credential: { type: "anonymous" },
      preferences: { locale: ref("en"), locales: ["en"], theme: ref("light"), setLocale: () => {}, setTheme: () => {} } as PlatformPreferences,
      router: createRouter({ history: createMemoryHistory(), routes: [] }),
      onAuthFailure: vi.fn(),
    });
  });

  afterEach(() => {
    clearPanelDefinitionCache();
  });

  const hostLabels: PanelHostLabels = {
    notStarted: "Not started",
    failures: { fileUnavailable: "Could not load {file}", scriptThrew: "Script failed", scriptRejected: "Script rejected" },
    content: { styleOutside: "Style outside" },
    refresh: "Refresh",
  };
  const wiredUse = {
    id: "use-personal-ext-wired",
    pageKey: "personal-ext-wired",
    panelId: "panel-personal-ext",
    path: "/applications/app-a/personal-ext-wired",
    inputs: { term: { frameState: "term" } },
  };
  const unwiredUse = {
    id: "use-personal-ext-unwired",
    pageKey: "personal-ext-unwired",
    panelId: "panel-personal-ext",
    path: "/applications/app-a/personal-ext-unwired",
  };
  const termAndDensityManifest = definePanel({
    state: {
      term: { type: { kind: "scalar", type: "string" }, external: true, personal: true, deepLink: false, default: "autumn" },
      density: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "compact" },
    },
    members: {},
  });
  const termOnlyManifest = definePanel({
    state: {
      term: { type: { kind: "scalar", type: "string" }, external: true, personal: true, deepLink: false, default: "autumn" },
    },
    members: {},
  });
  const nestedChildManifest = definePanel({
    state: {
      term: { type: { kind: "scalar", type: "string" }, external: true, personal: true, deepLink: false, default: "autumn" },
      density: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "compact" },
    },
    members: {},
  });
  const nestedOuterManifest = definePanel({
    state: {
      outerTerm: { type: { kind: "scalar", type: "string" }, default: "spring" },
      childRef: {
        type: { kind: "object", objectType: PRODUCT_PANEL },
        default: { className: PRODUCT_PANEL, primaryKey: "panel-nested-child" },
      },
    },
    members: {
      child: {
        target: { fromState: "childRef", candidates: { panelIds: ["panel-nested-child"] } },
        inputs: { term: { state: "outerTerm" } },
        outputs: { term: { state: "outerTerm" } },
      },
    },
  });

  function panelRecord(id: string, name: string, manifestDef: ReturnType<typeof definePanel>, module = "") {
    return {
      id,
      revision: 1,
      name,
      description: "",
      visibility: "domain" as const,
      domainId: "domain-1",
      ownerId: "owner-1",
      editable: true,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
      content: { html: '<div id="app"><span>panel</span></div>', module },
      manifest: manifestDef,
    };
  }

  function stubPersonalHostFetch(options: {
    use: typeof wiredUse | typeof unwiredUse;
    panels: Record<string, ReturnType<typeof panelRecord>>;
    storage: Record<string, unknown>;
    reads: { memberPath: unknown[]; fields: string[] }[];
    writes: { memberPath: unknown[]; values: Record<string, unknown> }[];
    beforeSnapshot?: () => Promise<void>;
  }) {
    const controlledForPath = (memberPath: { member: string }[]) => {
      if (!memberPath.length) {
        return new Set(Object.keys((options.use as { inputs?: Record<string, unknown> }).inputs ?? {}));
      }
      // Resolve the parent manifest along the path (here root outer panel -> child).
      let current = options.panels[options.use.panelId]!.manifest;
      for (let i = 0; i < memberPath.length - 1; i++) {
        const seg = memberPath[i]!;
        const target = current.members[seg.member]?.target;
        if (target && "panelId" in target) current = options.panels[target.panelId]!.manifest;
      }
      const last = memberPath.at(-1)!;
      return new Set(Object.keys(current.members[last.member]?.inputs ?? {}));
    };

    vi.stubGlobal("fetch", async (input: string | URL, init?: { method?: string; body?: string }) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === `/api${PANEL_PERSONAL_STATE_READ_PATH}`) {
        const body = JSON.parse(init?.body ?? "{}") as { memberPath?: { member: string }[]; fields?: string[] };
        const memberPath = body.memberPath ?? [];
        const fields = body.fields ?? [];
        options.reads.push({ memberPath, fields });
        const controlled = controlledForPath(memberPath);
        const offending = fields.find(field => controlled.has(field));
        if (offending) {
          return Response.json(
            { error: { code: "PANEL_STATE_CONTROLLED", message: `State '${offending}' is set by the outer panel` } },
            { status: 400 },
          );
        }
        const values = Object.fromEntries(
          fields.filter(field => Object.hasOwn(options.storage, field)).map(field => [field, options.storage[field]]),
        );
        return Response.json({ values });
      }
      if (url.pathname === `/api${PANEL_PERSONAL_STATE_PATH}` && init?.method === "PUT") {
        const body = JSON.parse(init.body ?? "{}") as { memberPath?: { member: string }[]; values?: Record<string, unknown> };
        const memberPath = body.memberPath ?? [];
        const values = body.values ?? {};
        options.writes.push({ memberPath, values });
        const controlled = controlledForPath(memberPath);
        const offending = Object.keys(values).find(field => controlled.has(field));
        if (offending) {
          return Response.json(
            { error: { code: "PANEL_STATE_CONTROLLED", message: `State '${offending}' is set by the outer panel` } },
            { status: 400 },
          );
        }
        Object.assign(options.storage, values);
        return Response.json({ values });
      }
      if (url.pathname === `/api${PANEL_NESTED_READ_PATH}`) {
        const body = JSON.parse(init?.body ?? "{}") as {
          memberPath?: { selection?: { target?: { panelId?: string } } }[];
        };
        const targetId = body.memberPath?.at(-1)?.selection?.target?.panelId ?? "panel-nested-child";
        const { id, revision, content, manifest: panelManifest } = options.panels[targetId]!;
        return Response.json({ panel: { id, revision, content, manifest: panelManifest } });
      }
      if (url.pathname.endsWith("/snapshot")) {
        await options.beforeSnapshot?.();
        return Response.json({
          panel: { id: options.use.panelId, revision: options.panels[options.use.panelId]!.revision },
          projections: [],

        });
      }
      for (const [id, rec] of Object.entries(options.panels)) {
        if (url.pathname === panelHostPaths.panel(id)) {
          return Response.json({ panel: rec, projections: {} });
        }
      }
      return Response.json({});
    });
  }

  function mountedState(view: ReturnType<typeof usePanelInstance>) {
    const mount = view.direct.value?.mount as {
      instance: {
        state: { values: { value: Record<string, unknown> }; set(name: string, value: unknown): void };
        placing(member: string): Promise<unknown>;
      };
    } | undefined;
    return mount!.instance.state;
  }

  it.each([
    {
      name: "reuses the read when the revision matches",
      revision: 1,
      manifest: termAndDensityManifest,
      laterReads: [],
      state: { term: "summer", density: "comfortable" },
    },
    {
      name: "reuses the read when the revised personal fields only change order",
      revision: 2,
      manifest: definePanel({
        state: { density: termAndDensityManifest.state.density!, term: termAndDensityManifest.state.term! },
        members: {},
      }),
      laterReads: [],
      state: { term: "summer", density: "comfortable" },
    },
    {
      name: "reads the revised fields when the field set changes",
      revision: 2,
      manifest: termOnlyManifest,
      laterReads: [{ memberPath: [], fields: ["term"] }],
      state: { term: "summer" },
    },
    {
      name: "ignores the read when the revised panel has no personal fields",
      revision: 2,
      manifest: definePanel({ state: {}, members: {} }),
      laterReads: [],
      state: {},
    },
  ])("starts the cached personal state read before snapshot returns and $name", async (scenario) => {
    const use = unwiredUse;
    const cached = panelRecord(use.panelId, "Personal External", termAndDensityManifest);
    setCachedPanel(use.panelId, cached);
    let releaseSnapshot!: () => void;
    const snapshot = new Promise<void>(resolve => { releaseSnapshot = resolve; });
    const beforeSnapshot = vi.fn(() => snapshot);
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    stubPersonalHostFetch({
      use,
      panels: { [use.panelId]: { ...cached, revision: scenario.revision, manifest: scenario.manifest } },
      storage: { term: "summer", density: "comfortable" },
      reads,
      writes: [],
      beforeSnapshot,
    });

    const scope = effectScope();
    try {
      const view = scope.run(() => usePanelInstance(platformPanelHost("app-a", use, () => {}), {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => use.path,
        initial: () => ({}),
      }))!;
      const earlyRead = { memberPath: [], fields: ["term", "density"] };
      try {
        expect(beforeSnapshot).toHaveBeenCalled();
        expect(reads).toEqual([earlyRead]);
      } finally {
        releaseSnapshot();
        await view.ready;
      }
      expect(view.error.value).toBe("");
      expect(reads).toEqual([earlyRead, ...scenario.laterReads]);
      expect(mountedState(view).values.value).toEqual(scenario.state);
    } finally {
      scope.stop();
    }
  });

  it("excludes wired entry inputs from personal reads/writes so sibling personal fields still load and save, and withdrawn wired inputs fall back to defaults", async () => {
    const storage: Record<string, unknown> = { term: "summer", density: "comfortable" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    stubPersonalHostFetch({
      use: wiredUse,
      panels: { [wiredUse.panelId]: panelRecord(wiredUse.panelId, "Personal External", termAndDensityManifest) },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const inputs = ref<Record<string, string>>({ term: "spring" });
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", wiredUse, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => wiredUse.path,
        initial: () => ({}),
        entryInputs: () => inputs.value,
        wired: () => ["term"],
      }))!;
      await view.ready;
      expect(view.error.value).toBe("");

      expect(reads).toEqual([{ memberPath: [], fields: ["density"] }]);
      expect(mountedState(view).values.value).toEqual({ term: "spring", density: "comfortable" });

      // Withdrawing the wired external input reverts `term` to its declared default ("autumn"), not saved "summer".
      inputs.value = {};
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mountedState(view).values.value).toEqual({ term: "autumn", density: "comfortable" });
      expect(writes).toEqual([]);

      // User edits to the wired field inside the panel do not write to personal storage.
      mountedState(view).set("term", "winter");
      await vi.advanceTimersByTimeAsync(1000);
      expect(writes).toEqual([]);
      expect(storage.term).toBe("summer");

      // User edits to the uncontrolled personal field persist only that field.
      mountedState(view).set("density", "spacious");
      await vi.advanceTimersByTimeAsync(500);
      expect(writes).toEqual([{ memberPath: [], values: { density: "spacious" } }]);
      expect(storage).toEqual({ term: "summer", density: "spacious" });
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("uses declared default when a wired entry passes no initial value while still reading sibling personal fields", async () => {
    const storage: Record<string, unknown> = { term: "summer", density: "spacious" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    stubPersonalHostFetch({
      use: wiredUse,
      panels: { [wiredUse.panelId]: panelRecord(wiredUse.panelId, "Personal External", termAndDensityManifest) },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", wiredUse, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => wiredUse.path,
        initial: () => ({}),
        entryInputs: () => ({}),
        wired: () => ["term"],
      }))!;
      await view.ready;

      expect(reads).toEqual([{ memberPath: [], fields: ["density"] }]);
      expect(mountedState(view).values.value).toEqual({ term: "autumn", density: "spacious" });
      expect(writes).toEqual([]);
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("reads both personal fields when the same panel is opened from an unwired entry", async () => {
    const storage: Record<string, unknown> = { term: "summer", density: "spacious" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    stubPersonalHostFetch({
      use: unwiredUse,
      panels: { [unwiredUse.panelId]: panelRecord(unwiredUse.panelId, "Personal External", termAndDensityManifest) },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", unwiredUse, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal External",
        address: () => unwiredUse.path,
        initial: () => ({}),
      }))!;
      await view.ready;

      expect(reads).toEqual([{ memberPath: [], fields: ["term", "density"] }]);
      expect(mountedState(view).values.value).toEqual({ term: "summer", density: "spacious" });
      expect(writes).toEqual([]);
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("issues zero personal-state reads or writes when every personal field is controlled by entry inputs", async () => {
    const onlyUse = { ...wiredUse, id: "use-personal-only", pageKey: "personal-only", panelId: "panel-personal-only" };
    const panel = panelRecord(onlyUse.panelId, "Personal Only", termOnlyManifest);
    setCachedPanel(onlyUse.panelId, panel);
    const storage: Record<string, unknown> = { term: "summer" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    stubPersonalHostFetch({
      use: onlyUse,
      panels: { [onlyUse.panelId]: panel },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const inputs = ref<Record<string, string>>({ term: "spring" });
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", onlyUse, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Personal Only",
        address: () => onlyUse.path,
        initial: () => ({}),
        entryInputs: () => inputs.value,
        wired: () => ["term"],
      }))!;
      await view.ready;
      expect(mountedState(view).values.value).toEqual({ term: "spring" });

      inputs.value = { term: "winter" };
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mountedState(view).values.value).toEqual({ term: "winter" });

      inputs.value = {};
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mountedState(view).values.value).toEqual({ term: "autumn" });

      mountedState(view).set("term", "fall");
      await vi.advanceTimersByTimeAsync(1000);

      expect(reads).toEqual([]);
      expect(writes).toEqual([]);
      expect(storage.term).toBe("summer");
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("excludes parent member inputs from personal reads/writes on a nested panel while preserving its other personal fields", async () => {
    const nestedUse = {
      id: "use-nested-outer",
      pageKey: "nested-outer",
      panelId: "panel-nested-outer",
      path: "/applications/app-a/nested-outer",
    };
    const storage: Record<string, unknown> = { term: "summer", density: "comfortable" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    const childModule = `
      import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
      await mountPanel({
        setup() {
          globalThis.__controlledPersonalNested = usePanelContext().instance;
          return {};
        },
      });
    `;
    stubPersonalHostFetch({
      use: nestedUse,
      panels: {
        "panel-nested-outer": panelRecord("panel-nested-outer", "Outer", nestedOuterManifest),
        "panel-nested-child": panelRecord("panel-nested-child", "Child", nestedChildManifest, childModule),
      },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", nestedUse, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Outer",
        address: () => nestedUse.path,
        initial: () => ({}),
      }))!;
      await view.ready;
      const outerMount = view.direct.value?.mount as {
        instance: { placing(member: string): Promise<unknown>; nested: boolean; isOutputBound(name: string): boolean };
      } | undefined;
      expect(outerMount!.instance.nested).toBe(false);
      expect(outerMount!.instance.isOutputBound("term")).toBe(false);
      await outerMount!.instance.placing("child");

      const child = (globalThis as Record<string, unknown>).__controlledPersonalNested as {
        nested: boolean;
        isOutputBound(name: string): boolean;
        state: { values: { value: Record<string, unknown> }; set(name: string, value: unknown): void };
      };
      expect(child.nested).toBe(true);
      expect(child.isOutputBound("term")).toBe(true);
      expect(child.isOutputBound("density")).toBe(false);
      const childState = child.state;
      expect(reads).toEqual([
        {
          memberPath: [{
            member: "child",
            selection: {
              stateValue: { className: PRODUCT_PANEL, primaryKey: "panel-nested-child" },
              target: { panelId: "panel-nested-child" },
            },
          }],
          fields: ["density"],
        },
      ]);
      expect(childState.values.value).toEqual({ term: "spring", density: "comfortable" });

      childState.set("term", "winter");
      await vi.advanceTimersByTimeAsync(1000);
      expect(writes).toEqual([]);
      expect(storage.term).toBe("summer");

      childState.set("density", "spacious");
      await vi.advanceTimersByTimeAsync(500);
      expect(writes).toEqual([
        {
          memberPath: [{
            member: "child",
            selection: {
              stateValue: { className: PRODUCT_PANEL, primaryKey: "panel-nested-child" },
              target: { panelId: "panel-nested-child" },
            },
          }],
          values: { density: "spacious" },
        },
      ]);
      expect(storage).toEqual({ term: "summer", density: "spacious" });
    } finally {
      delete (globalThis as Record<string, unknown>).__controlledPersonalNested;
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("puts only changed personal fields across concurrent sessions so two tabs editing different fields do not overwrite each other", async () => {
    const prefsUse = {
      id: "use-personal-prefs",
      pageKey: "personal-prefs",
      panelId: "panel-personal-prefs",
      path: "/applications/app-a/personal-prefs",
    };
    const prefsManifest = definePanel({
      state: {
        density: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "compact" },
        sort: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "asc" },
      },
      members: {},
    });
    const storage: Record<string, unknown> = { density: "compact", sort: "asc" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    stubPersonalHostFetch({
      use: prefsUse,
      panels: { [prefsUse.panelId]: panelRecord(prefsUse.panelId, "Personal Prefs", prefsManifest) },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const tab1Scope = effectScope();
    const tab2Scope = effectScope();
    try {
      const tab1 = tab1Scope.run(() => usePanelInstance(platformPanelHost("app-a", prefsUse, () => {}), {
        labels: hostLabels,
        label: () => "Personal Prefs",
        address: () => prefsUse.path,
        initial: () => ({}),
      }))!;
      const tab2 = tab2Scope.run(() => usePanelInstance(platformPanelHost("app-a", prefsUse, () => {}), {
        labels: hostLabels,
        label: () => "Personal Prefs",
        address: () => prefsUse.path,
        initial: () => ({}),
      }))!;
      await Promise.all([tab1.ready, tab2.ready]);

      expect(mountedState(tab1).values.value).toEqual({ density: "compact", sort: "asc" });
      expect(mountedState(tab2).values.value).toEqual({ density: "compact", sort: "asc" });

      mountedState(tab1).set("density", "spacious");
      await vi.advanceTimersByTimeAsync(500);
      expect(writes).toEqual([{ memberPath: [], values: { density: "spacious" } }]);

      mountedState(tab2).set("sort", "desc");
      await vi.advanceTimersByTimeAsync(500);
      expect(writes).toEqual([
        { memberPath: [], values: { density: "spacious" } },
        { memberPath: [], values: { sort: "desc" } },
      ]);
      expect(storage).toEqual({ density: "spacious", sort: "desc" });
    } finally {
      tab1Scope.stop();
      tab2Scope.stop();
      vi.useRealTimers();
    }
  });

  it("issues zero PUT requests when a personal field is changed and reverted to its stored value within the debounce window", async () => {
    const prefsUse = {
      id: "use-personal-revert",
      pageKey: "personal-revert",
      panelId: "panel-personal-revert",
      path: "/applications/app-a/personal-revert",
    };
    const prefsManifest = definePanel({
      state: {
        density: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "compact" },
        sort: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "asc" },
      },
      members: {},
    });
    const storage: Record<string, unknown> = { density: "compact", sort: "asc" };
    const reads: { memberPath: unknown[]; fields: string[] }[] = [];
    const writes: { memberPath: unknown[]; values: Record<string, unknown> }[] = [];
    stubPersonalHostFetch({
      use: prefsUse,
      panels: { [prefsUse.panelId]: panelRecord(prefsUse.panelId, "Personal Revert", prefsManifest) },
      storage,
      reads,
      writes,
    });
    vi.useFakeTimers();
    const scope = effectScope();
    try {
      const view = scope.run(() => usePanelInstance(platformPanelHost("app-a", prefsUse, () => {}), {
        labels: hostLabels,
        label: () => "Personal Revert",
        address: () => prefsUse.path,
        initial: () => ({}),
      }))!;
      await view.ready;

      mountedState(view).set("density", "spacious");
      await nextTick();
      await vi.advanceTimersByTimeAsync(200);
      mountedState(view).set("density", "compact");
      await nextTick();
      await vi.advanceTimersByTimeAsync(500);

      expect(writes).toEqual([]);
      expect(storage).toEqual({ density: "compact", sort: "asc" });
    } finally {
      scope.stop();
      vi.useRealTimers();
    }
  });
});

describe("dynamic and nested member projection access verification", () => {
  beforeEach(() => {
    clearPanelDefinitionCache();
    installAppHost({
      credential: { type: "anonymous" },
      preferences: { locale: ref("en"), locales: ["en"], theme: ref("light"), setLocale: () => {}, setTheme: () => {} } as PlatformPreferences,
      router: createRouter({ history: createMemoryHistory(), routes: [] }),
      onAuthFailure: vi.fn(),
    });
  });

  afterEach(() => {
    clearPanelDefinitionCache();
  });

  const hostLabels: PanelHostLabels = {
    notStarted: "Not started",
    failures: { fileUnavailable: "Could not load {file}", scriptThrew: "Script failed", scriptRejected: "Script rejected" },
    content: { styleOutside: "Style outside" },
    refresh: "Refresh",
  };

  function makeProjection(id: string, emptyText: string, revision = 1): ProductProjection {
    return {
      id,
      revision,
      name: emptyText,
      description: "",
      domainId: "domain-1",
      ownerId: "owner-1",
      editable: false,
      visibility: "domain",
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: { emptyText },
      data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
      },
    };
  }

  function makeCodedPanel(id: string, manifestDef: ReturnType<typeof definePanel>, slotName: string, revision = 1) {
    return {
      id,
      revision,
      name: id,
      description: "",
      visibility: "domain" as const,
      domainId: "domain-1",
      ownerId: "owner-1",
      editable: true,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
      content: {
        html: `<div id="app"><projection slot="${slotName}"></projection></div>`,
        module: `import { mountPanel } from "@ontomato/sdk/panel"; await mountPanel({});`,
      },
      manifest: manifestDef,
    };
  }

  it("verifies server use grant for a cached projection selected by a fromState dynamic member and clears cache on 403", async () => {
    const use = {
      id: "use-proj-catalog",
      pageKey: "proj-catalog",
      panelId: "panel-proj-catalog",
      path: "/applications/app-a/proj-catalog",
    };
    const projP = makeProjection("proj-dynamic-p", "Cached Projection P");
    // Pre-populate the client cache within the same login session.
    setCachedProjection({ projection: projP });
    expect(getCachedProjection(projP.id)).toBeDefined();

    const catalogManifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: PRODUCT_PROJECTION }, personal: false, deepLink: false, default: { className: PRODUCT_PROJECTION, primaryKey: projP.id } },
      },
      members: {
        preview: { target: { fromState: "selected", candidates: { rule: "usable" } } },
      },
    });
    const catalogPanel = makeCodedPanel(use.panelId, catalogManifest, "preview");

    const projectionRequests: string[] = [];
    const readRequests: unknown[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: { body?: string }) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === panelHostPaths.panel(use.panelId)) {
        return Response.json({ panel: catalogPanel, projections: {} });
      }
      if (url.pathname === `/api/product-projections/${projP.id}`) {
        projectionRequests.push(url.pathname);
        return Response.json({ error: { code: "FORBIDDEN", message: "Product use Grant required" } }, { status: 403 });
      }
      if (url.pathname === "/api/product-panels/read") {
        readRequests.push(JSON.parse(init?.body ?? "{}"));
        return Response.json({ status: "ready", value: [] });
      }
      return Response.json({});
    });

    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Projection Catalog",
        address: () => use.path,
        initial: () => ({}),
      }))!;
      await view.ready;

      const element = view.direct.value!.element;
      await vi.waitFor(() => expect(projectionRequests).toEqual([`/api/product-projections/${projP.id}`]));
      await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataForbidden));
      expect(element.textContent).not.toContain("Cached Projection P");
      expect(getCachedProjection(projP.id)).toBeUndefined();
      expect(readRequests).toEqual([]);
    } finally {
      scope.stop();
    }
  });

  it("re-verifies a dynamic projection after revoking and switching away and back while the panel stays open", async () => {
    const use = {
      id: "use-proj-switch",
      pageKey: "proj-switch",
      panelId: "panel-proj-switch",
      path: "/applications/app-a/proj-switch",
    };
    const proj1 = makeProjection("proj-switch-1", "Projection One");
    const proj2 = makeProjection("proj-switch-2", "Projection Two");
    let proj1Revoked = false;

    const catalogManifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: PRODUCT_PROJECTION }, personal: false, deepLink: false },
      },
      members: {
        preview: { target: { fromState: "selected", candidates: { rule: "usable" } } },
      },
    });
    const catalogPanel = makeCodedPanel(use.panelId, catalogManifest, "preview");

    const projectionRequests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: { body?: string }) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === panelHostPaths.panel(use.panelId)) {
        return Response.json({ panel: catalogPanel, projections: {} });
      }
      if (url.pathname === `/api/product-projections/${proj1.id}`) {
        projectionRequests.push(proj1.id);
        return proj1Revoked
          ? Response.json({ error: { code: "FORBIDDEN", message: "Product use Grant required" } }, { status: 403 })
          : Response.json({ projection: proj1 });
      }
      if (url.pathname === `/api/product-projections/${proj2.id}`) {
        projectionRequests.push(proj2.id);
        return Response.json({ projection: proj2 });
      }
      if (url.pathname === "/api/product-panels/read") {
        const body = JSON.parse(init?.body ?? "{}") as { operations?: true };
        return Response.json(body.operations ? { status: "ready", value: {} } : { status: "ready", value: [] });
      }
      return Response.json({});
    });

    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Projection Switch",
        address: () => use.path,
        initial: () => ({}),
      }))!;
      await view.ready;

      const mount = view.direct.value!.mount as unknown as {
        instance: { state: { set(name: string, value: unknown): void } };
      };
      const element = view.direct.value!.element;

      // 1. Select P1 -> mounts and warms cache.
      mount.instance.state.set("selected", { className: PRODUCT_PROJECTION, primaryKey: proj1.id });
      await vi.waitFor(() => expect(element.textContent).toContain("Projection One"), { timeout: 5000 });
      expect(getCachedProjection(proj1.id)).toBeDefined();

      // 2. Revoke P1 on server, switch to P2, then switch back to P1.
      proj1Revoked = true;
      mount.instance.state.set("selected", { className: PRODUCT_PROJECTION, primaryKey: proj2.id });
      await vi.waitFor(() => expect(element.textContent).toContain("Projection Two"), { timeout: 5000 });

      mount.instance.state.set("selected", { className: PRODUCT_PROJECTION, primaryKey: proj1.id });
      await vi.waitFor(() => expect(projectionRequests).toEqual([proj1.id, proj2.id, proj1.id]));
      await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataForbidden), { timeout: 5000 });
      expect(element.textContent).not.toContain("Projection One");
      expect(getCachedProjection(proj1.id)).toBeUndefined();
    } finally {
      scope.stop();
    }
  });

  it("verifies server use grant for projections inside a nested panel preview even when the projection was cached", async () => {
    const use = {
      id: "use-panel-catalog",
      pageKey: "panel-catalog",
      panelId: "panel-catalog-outer",
      path: "/applications/app-a/panel-catalog",
    };
    const projP = makeProjection("proj-nested-p", "Nested Cached Projection P");
    // Pre-populate the client cache within the same login session.
    setCachedProjection({ projection: projP });
    expect(getCachedProjection(projP.id)).toBeDefined();

    const outerManifest = definePanel({
      state: {
        selectedPanel: { type: { kind: "object", objectType: PRODUCT_PANEL }, personal: false, deepLink: false, default: { className: PRODUCT_PANEL, primaryKey: "panel-b" } },
      },
      members: {
        preview: { target: { fromState: "selectedPanel", candidates: { rule: "usable" } } },
      },
    });
    const innerManifest = definePanel({
      state: {},
      members: {
        innerMember: { target: { projectionId: projP.id } },
      },
    });
    const outerPanel = makeCodedPanel(use.panelId, outerManifest, "preview");
    const innerPanel = makeCodedPanel("panel-b", innerManifest, "innerMember");

    const projectionRequests: string[] = [];
    const readRequests: unknown[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: { body?: string }) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === panelHostPaths.panel(use.panelId)) {
        return Response.json({ panel: outerPanel, projections: {} });
      }
      if (url.pathname === `/api${PANEL_NESTED_READ_PATH}`) {
        return Response.json({
          panel: { id: innerPanel.id, revision: innerPanel.revision, content: innerPanel.content, manifest: innerPanel.manifest },
        });
      }
      if (url.pathname === `/api/product-projections/${projP.id}`) {
        projectionRequests.push(url.pathname);
        return Response.json({ error: { code: "FORBIDDEN", message: "Product use Grant required" } }, { status: 403 });
      }
      if (url.pathname === "/api/product-panels/read") {
        readRequests.push(JSON.parse(init?.body ?? "{}"));
        return Response.json({ status: "ready", value: [] });
      }
      return Response.json({});
    });

    const scope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = scope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Panel Catalog",
        address: () => use.path,
        initial: () => ({}),
      }))!;
      await view.ready;

      const element = view.direct.value!.element;
      await vi.waitFor(() => expect(projectionRequests).toEqual([`/api/product-projections/${projP.id}`]));
      await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataForbidden), { timeout: 5000 });
      expect(element.textContent).not.toContain("Nested Cached Projection P");
      expect(getCachedProjection(projP.id)).toBeUndefined();
      expect(readRequests).toEqual([]);
    } finally {
      scope.stop();
    }
  });

  it("keeps the fast cache path for fixed projection members verified via includeProjections or snapshot", async () => {
    const use = {
      id: "use-fixed-fast",
      pageKey: "fixed-fast",
      panelId: "panel-fixed-fast",
      path: "/applications/app-a/fixed-fast",
    };
    const projFixed = makeProjection("proj-fixed-fast", "Fixed Projection Fast");
    const fixedManifest = definePanel({
      state: {},
      members: {
        fixedMember: { target: { projectionId: projFixed.id } },
      },
    });
    const fixedPanel = makeCodedPanel(use.panelId, fixedManifest, "fixedMember");

    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: { body?: string }) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname + url.search);
      if (url.pathname === panelHostPaths.panel(use.panelId)) {
        return Response.json({
          panel: fixedPanel,
          projections: {
            [projFixed.id]: { status: "ready", projection: projFixed },
          },
        });
      }
      if (url.pathname === panelHostPaths.snapshot(use.panelId)) {
        return Response.json({
          panel: { id: fixedPanel.id, revision: fixedPanel.revision },
          projections: [{ id: projFixed.id, revision: projFixed.revision }],
          members: [{ status: "ready", memberPath: [{ member: "fixedMember" }], target: { kind: "projection", id: projFixed.id }, revision: projFixed.revision }],

        });
      }
      if (url.pathname === "/api/product-panels/read") {
        const body = JSON.parse(init?.body ?? "{}") as { operations?: true };
        return Response.json(body.operations ? { status: "ready", value: {} } : { status: "ready", value: [] });
      }
      return Response.json({});
    });

    // 1. Cold open via ?includeProjections=1 -> 0 individual projection GETs.
    const firstScope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = firstScope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Fixed Fast",
        address: () => use.path,
        initial: () => ({}),
      }))!;
      await view.ready;
      await vi.waitFor(() => expect(view.direct.value!.element.textContent).toContain("Fixed Projection Fast"));
      expect(requests.filter((entry) => entry.startsWith("/api/product-projections/"))).toEqual([]);
    } finally {
      firstScope.stop();
    }

    // 2. Re-entry verified via /snapshot -> still 0 individual projection GETs.
    requests.length = 0;
    const secondScope = effectScope();
    try {
      const port = platformPanelHost("app-a", use, () => {});
      const view = secondScope.run(() => usePanelInstance(port, {
        labels: hostLabels,
        label: () => "Fixed Fast",
        address: () => use.path,
        initial: () => ({}),
      }))!;
      await view.ready;
      await vi.waitFor(() => expect(view.direct.value!.element.textContent).toContain("Fixed Projection Fast"));
      expect(requests.some((entry) => entry.startsWith(panelHostPaths.snapshot(use.panelId)))).toBe(true);
      expect(requests.filter((entry) => entry.startsWith("/api/product-projections/"))).toEqual([]);
    } finally {
      secondScope.stop();
    }
  });

  it("reconciles cold loads from includeProjections=1 with 0 /snapshot calls and still checks /snapshot on cache hit for all three hosts", async () => {
    const use = {
      id: "use-cold-reconcile",
      pageKey: "cold-reconcile",
      panelId: "panel-cold-page",
      path: "/applications/app-a/cold-reconcile",
    };
    const cases = [
      {
        name: "platformPanelHost",
        panelId: use.panelId,
        projId: "proj-cold-page",
        createPort: () => platformPanelHost("app-a", use, () => {}),
      },
      {
        name: "framePanelHost",
        panelId: "panel-cold-frame",
        projId: "proj-cold-frame",
        createPort: () => framePanelHost("app-a", use, "panel-cold-frame", () => {}),
      },
      {
        name: "builtinFramePanelHost",
        panelId: "panel-cold-builtin-frame",
        projId: "proj-cold-builtin-frame",
        createPort: () => builtinFramePanelHost("settings", "panel-cold-builtin-frame"),
      },
    ] as const;

    for (const hostCase of cases) {
      clearPanelDefinitionCache();
      const proj = makeProjection(hostCase.projId, `Projection for ${hostCase.name}`);
      const panelDef = makeCodedPanel(
        hostCase.panelId,
        definePanel({
          state: {},
          members: {
            fixedMember: { target: { projectionId: proj.id } },
          },
        }),
        "fixedMember",
      );

      const requests: string[] = [];
      vi.stubGlobal("fetch", async (input: string | URL, init?: { body?: string }) => {
        const url = new URL(String(input), "http://localhost");
        requests.push(url.pathname + url.search);
        if (url.pathname === panelHostPaths.panel(hostCase.panelId)) {
          return Response.json({
            panel: panelDef,
            projections: {
              [proj.id]: { status: "ready", projection: proj },
            },
          });
        }
        if (url.pathname === panelHostPaths.snapshot(hostCase.panelId)) {
          return Response.json({
            panel: { id: panelDef.id, revision: panelDef.revision },
            projections: [{ id: proj.id, revision: proj.revision }],
            members: [{ status: "ready", memberPath: [{ member: "fixedMember" }], target: { kind: "projection", id: proj.id }, revision: proj.revision }],
          });
        }
        if (url.pathname === "/api/product-panels/read") {
          const body = JSON.parse(init?.body ?? "{}") as { operations?: true };
          return Response.json(body.operations ? { status: "ready", value: {} } : { status: "ready", value: [] });
        }
        return Response.json({});
      });

      // 1. Cold open: 1 GET /api/product-panels/:id?...includeProjections=1 and 0 /snapshot calls.
      const coldScope = effectScope();
      try {
        const port = hostCase.createPort();
        const view = coldScope.run(() => usePanelInstance(port, {
          labels: hostLabels,
          label: () => hostCase.name,
          address: () => use.path,
          initial: () => ({}),
        }))!;
        await view.ready;
        await nextTick();
        await Promise.resolve();
        expect(port.sourceReconciled?.(), hostCase.name).toBe(true);
        const panelReads = requests.filter((entry) => entry.startsWith(`${panelHostPaths.panel(hostCase.panelId)}?`));
        expect(panelReads, hostCase.name).toHaveLength(1);
        expect(new URLSearchParams(panelReads[0]!.split("?")[1]).get("includeProjections"), hostCase.name).toBe("1");
        expect(requests.filter((entry) => entry.startsWith(panelHostPaths.snapshot(hostCase.panelId))), hostCase.name).toEqual([]);
      } finally {
        coldScope.stop();
      }

      // 2. Warm cache re-entry: 1 /snapshot verification and 0 GET /api/product-panels/:id calls.
      requests.length = 0;
      const warmScope = effectScope();
      try {
        const port = hostCase.createPort();
        const view = warmScope.run(() => usePanelInstance(port, {
          labels: hostLabels,
          label: () => hostCase.name,
          address: () => use.path,
          initial: () => ({}),
        }))!;
        await view.ready;
        await nextTick();
        await Promise.resolve();
        expect(port.sourceReconciled?.(), hostCase.name).toBe(true);
        expect(requests.filter((entry) => entry.startsWith(panelHostPaths.snapshot(hostCase.panelId))), hostCase.name).toHaveLength(1);
        expect(requests.filter((entry) => entry.startsWith(`${panelHostPaths.panel(hostCase.panelId)}?`)), hostCase.name).toEqual([]);
      } finally {
        warmScope.stop();
      }
    }
  });

  it.each([403, 404])("keeps the HTTP %s on a refused panel read and a refused opening", async status => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "Refused" } }, { status }));
    await expect(readPanelData({
      source: { kind: "registered", applicationId: "app-a", useId: "use-1" },
      memberPath: [{ member: "list" }], dataName: "rows", inputs: {},
    })).rejects.toMatchObject({ status });
    clearPanelDefinitionCache();
    const deniedUse: ApplicationPanelUse = {
      id: "use-denied", pageKey: "denied-page", panelId: "panel-denied",
      path: "/applications/app-a/denied",
    };
    const port = platformPanelHost("app-a", deniedUse, () => {});
    await expect(port.source()).rejects.toMatchObject({ status });
    await expect(resolveApplicationEntry({ path: "/applications/app-a/denied" })).rejects.toMatchObject({ status });
  });

  it("strips @ontomato/sdk: prefix via memberComponentId before preloading bundled projection components", async () => {
    const appsSdkDirect = await import("@ontomato/apps-sdk/direct");
    const preloadSpy = vi.spyOn(appsSdkDirect, "preloadCatalogueComponents").mockResolvedValue(undefined);
    clearPanelDefinitionCache();
    const use: ApplicationPanelUse = {
      id: "use-preload",
      pageKey: "preload-page",
      panelId: "panel-preload",
      path: "/applications/app-a/preload",
    };
    const panel = {
      id: "panel-preload",
      name: "Preload Panel",
      description: "",
      revision: 1,
      domainId: "domain-1",
      ownerId: "user-1",
      editable: false,
      visibility: "domain",
      createdAt: "2026-11-25T00:00:00.000Z",
      updatedAt: "2026-11-25T00:00:00.000Z",
      content: { html: "<div></div>" },
      manifest: {
        state: {},
        members: {
          count: { target: { projectionId: "proj-count" } },
          list: { target: { projectionId: "proj-list" } },
        },
      },
    };
    const makeProj = (id: string, componentId: string) => ({
      id,
      name: id,
      description: "",
      revision: 1,
      domainId: "domain-1",
      ownerId: "user-1",
      editable: false,
      visibility: "domain",
      createdAt: "2026-11-25T00:00:00.000Z",
      updatedAt: "2026-11-25T00:00:00.000Z",
      componentId,
      inputs: {},
      outputs: {},
      data: {},
      config: {},
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      return Response.json({
        panel,
        projections: {
          "proj-count": { status: "ready", projection: makeProj("proj-count", "@ontomato/sdk:ObjectCount") },
          "proj-list": { status: "ready", projection: makeProj("proj-list", "@ontomato/sdk:ObjectList") },
        },
      });
    });
    try {
      const port = platformPanelHost("app-a", use, () => {});
      await port.source();
      expect(preloadSpy).toHaveBeenCalledWith(["ObjectCount", "ObjectList"]);
    } finally {
      preloadSpy.mockRestore();
    }
  });
});
