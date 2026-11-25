import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import elementEn from "element-plus/es/locale/lang/en";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { buildExecutionContext } from "@ontomato/contracts/build-tests";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PanelHostPort } from "@ontomato/platform-shell";
import {
  AppPreview,
  panelPreviewHostKey,
  type AppPreviewContext,
  type AppPreviewStatusPayload,
  type PanelPreviewHost,
  type PanelPreviewOutcome,
  type PanelPreviewRequest,
} from "@ontomato/apps-sdk/preview";
import { ApiRequestError } from "@ontomato/workbench-ui";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import en from "../../../workbench-ui/src/locales/en";
import { panelContextKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";

const mocks = vi.hoisted(() => ({
  nodeApiGet: vi.fn(),
  nodeApiPost: vi.fn(),
  registerBuildPreview: vi.fn(),
  candidateSource: vi.fn(),
  candidatePanelHost: vi.fn(),
  panelHostHandlers: null as null | {
    emitContext: (ctx: PageContext) => void;
    emitAddress: (input: DisplayPageAddressInput) => void;
    emitLoaded: (load: DisplayLoad) => void;
    props: Record<string, unknown>;
  },
}));

vi.mock("@ontomato/workbench-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/workbench-ui")>();
  return {
    ...actual,
    apiUrl: (path: string) => `about:blank#${encodeURIComponent("/api" + path)}`,
    nodeApiGet: mocks.nodeApiGet,
    nodeApiPost: mocks.nodeApiPost,
  };
});

vi.mock("../app-host", () => ({
  registerBuildPreview: mocks.registerBuildPreview,
}));

vi.mock("../panel-host", () => ({
  candidatePanelHost: mocks.candidatePanelHost,
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/platform-shell")>();
  const StubPanelHost = defineComponent({
    name: "PanelHost",
    props: {
      port: { type: Object, required: true },
      address: { type: String, required: true },
      initial: { type: Object, default: undefined },
      label: { type: String, default: undefined },
      labels: { type: Object, required: true },
      language: { type: Object, required: true },
      historyBack: { type: Boolean, default: true },
    },
    emits: ["context", "display-address", "display-loaded"],
    setup(props, { emit }) {
      mocks.panelHostHandlers = {
        emitContext: (ctx: PageContext) => emit("context", ctx),
        emitAddress: (input: DisplayPageAddressInput) => emit("display-address", input),
        emitLoaded: (load: DisplayLoad) => emit("display-loaded", load),
        props,
      };
      return () => h("div", { class: "stub-panel-host", "data-address": props.address }, props.label ?? "");
    },
  });
  return {
    ...actual,
    PanelHost: StubPanelHost,
  };
});

import {
  createPanelPreviewHost,
  defaultResolvePreview,
  detectLegacySdkError,
  type ResolvedPreviewTarget,
} from "../panel-preview";

const i18n = installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en },
  elementLocale: () => elementEn,
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let activeWrapper: VueWrapper | null = null;

function mountPreview(
  props: {
    appId?: string | null;
    revision?: string;
    entryId?: string | null;
    reloadKey?: number | string;
  },
  options: {
    host?: PanelPreviewHost | null;
    memberOutputs?: Map<string, unknown>;
  } = {},
) {
  const provide: Record<symbol, unknown> = {};
  if (options.host !== undefined && options.host !== null) {
    provide[panelPreviewHostKey as symbol] = options.host;
  }
  if (options.memberOutputs) {
    const outputs = options.memberOutputs;
    const panelContext = {
      instance: {
        setMemberOutput(memberKey: string, name: string, value: unknown) {
          outputs.set(`${memberKey}.${name}`, value);
        },
      },
    } as unknown as PanelContext;
    const memberContext = {
      key: "previewMember",
      scoped: false,
    } as unknown as PanelMemberContext;
    provide[panelContextKey as symbol] = panelContext;
    provide[panelMemberKey as symbol] = () => memberContext;
  }

  activeWrapper = mount(AppPreview, {
    attachTo: document.body,
    props,
    global: {
      plugins: [i18n],
      provide,
    },
  });
  return activeWrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.panelHostHandlers = null;
  mocks.candidatePanelHost.mockImplementation((candidate: { id: string; ref: string; pageKey: string }) => ({
    source: mocks.candidateSource,
    pageKey: candidate.pageKey,
    use: null,
    panel: vi.fn(),
    release: vi.fn(),
    frame: vi.fn(),
    coded: vi.fn(),
    snapshot: vi.fn(),
    mode: { kind: "author", definitions: {} },
  }));
});

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
});

describe("AppPreview SDK component", () => {
  it("renders the empty state when appId is absent or blank", async () => {
    const mountSpy = vi.fn();
    const wrapper = mountPreview({ appId: null }, { host: { mount: mountSpy } });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("empty");
    expect(wrapper.text()).toContain(en.platform.appPreview.empty);
    expect(mountSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted("statusChange")?.at(-1)).toEqual([{ status: "empty" }]);
  });

  it("renders loading while resolving and transitions to ready in panel mode, reporting context and member outputs", async () => {
    const deferred = createDeferred<PanelPreviewOutcome>();
    const dispose = vi.fn();
    let capturedRequest: PanelPreviewRequest | null = null;
    const memberOutputs = new Map<string, unknown>();

    const host: PanelPreviewHost = {
      mount: vi.fn((request) => {
        capturedRequest = request;
        return deferred.promise;
      }),
    };

    const wrapper = mountPreview(
      { appId: "app-1", revision: "working", entryId: "overview" },
      { host, memberOutputs },
    );
    await nextTick();

    expect(wrapper.attributes("data-preview-status")).toBe("loading");
    expect(wrapper.find("[aria-busy='true']").exists()).toBe(true);
    expect(memberOutputs.get("previewMember.status")).toBe("loading");

    // Mount a surface node into the container and resolve as panel mode.
    const surface = document.createElement("div");
    surface.className = "mounted-panel-surface";
    surface.textContent = "Live Panel";
    capturedRequest!.container.appendChild(surface);
    deferred.resolve({ kind: "panel", handle: { dispose }, page: "/apps/app-1/overview" });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("ready");
    expect(wrapper.find(".mounted-panel-surface").exists()).toBe(true);
    expect(memberOutputs.get("previewMember.status")).toBe("ready");
    expect(memberOutputs.get("previewMember.activePage")).toBe("/apps/app-1/overview");
    expect(memberOutputs.get("previewMember.selection")).toEqual([]);
    expect(wrapper.emitted("contextChange")?.at(-1)).toEqual([
      { page: "/apps/app-1/overview", selection: [] },
    ]);

    // Report navigation and selection changes from the previewed panel.
    const nextContext: AppPreviewContext = {
      page: "/apps/app-1/orders?status=open",
      selection: [{ objectType: "Order", primaryKey: "ord-42", label: "Order #42" }],
    };
    capturedRequest!.onContextChange(nextContext);
    await nextTick();

    expect(wrapper.emitted("contextChange")?.at(-1)).toEqual([nextContext]);
    expect(memberOutputs.get("previewMember.activePage")).toBe("/apps/app-1/orders?status=open");
    expect(memberOutputs.get("previewMember.selection")).toEqual([
      { objectType: "Order", primaryKey: "ord-42", label: "Order #42" },
    ]);

    // Strictly does not render business test status bars or restart buttons (Q2 ruling).
    expect(wrapper.text()).not.toContain("Restart");
    expect(wrapper.text()).not.toContain("Test data");

    // Cleans up on unmount.
    wrapper.unmount();
    activeWrapper = null;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(memberOutputs.get("previewMember.status")).toBeNull();
    expect(memberOutputs.get("previewMember.activePage")).toBeNull();
    expect(memberOutputs.get("previewMember.selection")).toBeNull();
  });

  it("renders empty state when host resolves kind='empty'", async () => {
    const host: PanelPreviewHost = {
      mount: vi.fn(async (): Promise<PanelPreviewOutcome> => ({ kind: "empty", message: "No files generated yet" })),
    };

    const wrapper = mountPreview({ appId: "app-empty" }, { host });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("empty");
    expect(wrapper.text()).toContain("No files generated yet");
  });

  it("renders legacy-sdk notice with formatted version hint and retries cleanly on click", async () => {
    const dispose = vi.fn();
    const mountFn = vi
      .fn<[PanelPreviewRequest, AbortSignal?], Promise<PanelPreviewOutcome>>()
      .mockResolvedValueOnce({
        kind: "legacy-sdk",
        requiredVersion: "1.1.2",
        foundVersions: ["0.9.0"],
      })
      .mockResolvedValueOnce({
        kind: "panel",
        handle: { dispose },
        page: "/apps/app-legacy",
      });

    const wrapper = mountPreview({ appId: "app-legacy" }, { host: { mount: mountFn } });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("legacy-sdk");
    expect(wrapper.text()).toContain(en.platform.appPreview.legacySdkTitle);
    expect(wrapper.text()).toContain("0.9.0");
    expect(wrapper.text()).toContain("1.1.2");

    await wrapper.get("button.sdk-app-preview-btn").trigger("click");
    await flushPromises();

    expect(mountFn).toHaveBeenCalledTimes(2);
    expect(wrapper.attributes("data-preview-status")).toBe("ready");
  });

  it("renders error state with retry button and surfaces missing preview host cleanly", async () => {
    const wrapperNoHost = mountPreview({ appId: "app-1" }, { host: null });
    await flushPromises();
    expect(wrapperNoHost.attributes("data-preview-status")).toBe("error");
    expect(wrapperNoHost.find("[role='alert']").text()).toContain(en.platform.appPreview.hostUnavailable);
    wrapperNoHost.unmount();
    activeWrapper = null;

    const dispose = vi.fn();
    const mountFn = vi
      .fn<[PanelPreviewRequest, AbortSignal?], Promise<PanelPreviewOutcome>>()
      .mockRejectedValueOnce(new Error("Workspace denied"))
      .mockResolvedValueOnce({ kind: "hosted", handle: { dispose }, page: "/" });

    const wrapper = mountPreview({ appId: "app-err" }, { host: { mount: mountFn } });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("error");
    expect(wrapper.find("[role='alert']").text()).toContain("Workspace denied");

    await wrapper.get("button.sdk-app-preview-btn").trigger("click");
    await flushPromises();

    expect(mountFn).toHaveBeenCalledTimes(2);
    expect(wrapper.attributes("data-preview-status")).toBe("ready");
  });

  it("disposes previous mount and reloads on reloadKey, entryId, and revision changes without stale races", async () => {
    const firstDeferred = createDeferred<PanelPreviewOutcome>();
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const thirdDispose = vi.fn();
    const fourthDispose = vi.fn();
    const signals: AbortSignal[] = [];

    const mountFn = vi
      .fn<[PanelPreviewRequest, AbortSignal?], Promise<PanelPreviewOutcome>>()
      .mockImplementationOnce((_req, signal) => {
        if (signal) signals.push(signal);
        return firstDeferred.promise;
      })
      .mockImplementationOnce(async (_req, signal) => {
        if (signal) signals.push(signal);
        return { kind: "panel", handle: { dispose: secondDispose }, page: "/entry-b" };
      })
      .mockImplementationOnce(async (_req, signal) => {
        if (signal) signals.push(signal);
        return { kind: "panel", handle: { dispose: thirdDispose }, page: "/commit-abc" };
      })
      .mockImplementationOnce(async (_req, signal) => {
        if (signal) signals.push(signal);
        return { kind: "panel", handle: { dispose: fourthDispose }, page: "/reloaded" };
      });

    const wrapper = mountPreview(
      { appId: "app-multi", revision: "working", entryId: "entry-a", reloadKey: 1 },
      { host: { mount: mountFn } },
    );
    await nextTick();

    // Switch entryId BEFORE first mount resolves -> first abort signal fires, stale outcome is disposed immediately.
    await wrapper.setProps({ entryId: "entry-b" });
    await flushPromises();

    expect(signals[0]?.aborted).toBe(true);
    expect(wrapper.attributes("data-preview-status")).toBe("ready");
    expect(mountFn).toHaveBeenLastCalledWith(
      expect.objectContaining({ appId: "app-multi", revision: "working", entryId: "entry-b" }),
      expect.any(AbortSignal),
    );

    // Resolve stale first mount late -> must be disposed and never overwrite current ready mount.
    firstDeferred.resolve({ kind: "panel", handle: { dispose: firstDispose }, page: "/stale" });
    await flushPromises();
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("contextChange")?.at(-1)).toEqual([{ page: "/entry-b", selection: [] }]);

    // Change revision -> disposes second mount and remounts.
    await wrapper.setProps({ revision: "abc1234" });
    await flushPromises();
    expect(secondDispose).toHaveBeenCalledTimes(1);
    expect(mountFn).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: "abc1234", entryId: "entry-b" }),
      expect.any(AbortSignal),
    );

    // Change reloadKey -> disposes third mount and remounts.
    await wrapper.setProps({ reloadKey: 2 });
    await flushPromises();
    expect(thirdDispose).toHaveBeenCalledTimes(1);
    expect(mountFn).toHaveBeenCalledTimes(4);

    // Unmount disposes fourth mount.
    wrapper.unmount();
    activeWrapper = null;
    expect(fourthDispose).toHaveBeenCalledTimes(1);
  });
});

describe("Platform createPanelPreviewHost", () => {
  it("mounts a PanelHost via the resolver seam, propagates @context and @display-address, and handles error load transitions", async () => {
    const fakePort = {
      source: vi.fn(),
      pageKey: "orders",
      use: null,
      panel: vi.fn(),
      release: vi.fn(),
      frame: vi.fn(),
      coded: vi.fn(),
      snapshot: vi.fn(),
      mode: { kind: "view" as const },
    } as unknown as PanelHostPort;

    const host = createPanelPreviewHost({
      resolvePreview: vi.fn(async (req): Promise<ResolvedPreviewTarget> => ({
        kind: "panel",
        port: fakePort,
        address: `/apps/${req.appId}/${req.entryId ?? "home"}`,
        label: "Orders Preview",
      })),
    });

    const wrapper = mountPreview({ appId: "app-panel", revision: "working", entryId: "orders" }, { host });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("ready");
    expect(wrapper.find(".stub-panel-host").exists()).toBe(true);
    expect(mocks.panelHostHandlers?.props.historyBack).toBe(false);

    // PanelHost emits @context -> forwarded to AppPreview @context-change.
    mocks.panelHostHandlers!.emitContext({
      url: "/apps/app-panel/orders?tab=active",
      label: "Orders",
      selection: [{ kind: "Order", id: "ord-1", label: "Order 1" }],
    });
    await nextTick();
    expect(wrapper.emitted("contextChange")?.at(-1)).toEqual([
      {
        page: "/apps/app-panel/orders?tab=active",
        selection: [{ objectType: "Order", primaryKey: "ord-1", label: "Order 1" }],
      },
    ]);

    // PanelHost emits @display-address -> updates page while preserving selection.
    mocks.panelHostHandlers!.emitAddress({
      kind: "state",
      address: "/apps/app-panel/orders?tab=archived",
    });
    await nextTick();
    expect(wrapper.emitted("contextChange")?.at(-1)).toEqual([
      {
        page: "/apps/app-panel/orders?tab=archived",
        selection: [{ objectType: "Order", primaryKey: "ord-1", label: "Order 1" }],
      },
    ]);

    // PanelHost emits async error display-loaded -> transitions AppPreview cleanly to error and disposes mount.
    mocks.panelHostHandlers!.emitLoaded({
      status: "error",
      error: { code: "PANEL_UNAVAILABLE", message: "Candidate panel failed to load" },
    });
    await nextTick();
    expect(wrapper.attributes("data-preview-status")).toBe("error");
    expect(wrapper.find("[role='alert']").text()).toContain("Candidate panel failed to load");
    expect(wrapper.find(".stub-panel-host").exists()).toBe(false);
  });

  it("mounts legacy hosted preview iframe with registerBuildPreview registered strictly BEFORE iframe.src is assigned, and disposes on unmount", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const disposeBinding = vi.fn();
    mocks.registerBuildPreview.mockImplementation(() => {
      // Security invariant: iframe must never have `src` set before build-test binding is registered.
      const iframe = document.querySelector("iframe.platform-app-preview-hosted-frame");
      expect(iframe).not.toBeNull();
      expect(iframe?.hasAttribute("src")).toBe(false);
      return { dispose: disposeBinding };
    });

    const executionContext = buildExecutionContext(workspaceId, {
      contextId: "ctx-1",
      workspaceId,
      status: "READY",
      expiresAt: 1795555555555,
      classNames: [],
      sampleSummary: { name: "test-data/sample.json", classes: 1, sha256: null },
      resources: [],
    });

    const host = createPanelPreviewHost({
      resolvePreview: vi.fn(async () => ({
        kind: "hosted" as const,
        src: `about:blank#${encodeURIComponent(`/api/workspaces/${workspaceId}/preview/tok-1/index.html`)}`,
        executionContext,
        page: "/",
      })),
    });

    const wrapper = mountPreview({ appId: workspaceId }, { host });
    await flushPromises();

    expect(wrapper.attributes("data-preview-status")).toBe("ready");
    expect(mocks.registerBuildPreview).toHaveBeenCalledTimes(1);
    expect(mocks.registerBuildPreview).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ kind: "build-test", workspaceId, contextId: "ctx-1" }),
    );
    const iframe = wrapper.get("iframe.platform-app-preview-hosted-frame");
    expect(decodeURIComponent(iframe.attributes("src")!.split("#")[1]!)).toBe(
      `/api/workspaces/${workspaceId}/preview/tok-1/index.html`,
    );

    // Status change payload never leaks preview token or raw iframe URL to panel scripts.
    const statuses = (wrapper.emitted("statusChange") ?? []).flat() as AppPreviewStatusPayload[];
    expect(JSON.stringify(statuses)).not.toContain("tok-1");

    wrapper.unmount();
    activeWrapper = null;
    expect(disposeBinding).toHaveBeenCalledTimes(1);
  });

  it("defaultResolvePreview resolves candidate panel, falls back to hosted preview on 404, detects legacy-sdk, and never falls back on 403", async () => {
    const workspaceId = "22222222-2222-4222-8222-222222222222";

    // 1. Candidate panel present -> resolves kind="panel" and memoizes initial source().
    const candidateSourcePayload = { kind: "candidate", workspace: { id: workspaceId, ref: "working" } };
    mocks.candidateSource.mockResolvedValueOnce(candidateSourcePayload);
    const panelTarget = await defaultResolvePreview({ appId: workspaceId, revision: "working", entryId: "main" });
    expect(panelTarget.kind).toBe("panel");
    if (panelTarget.kind === "panel") {
      expect(await panelTarget.port.source()).toBe(candidateSourcePayload);
      expect(mocks.candidateSource).toHaveBeenCalledTimes(1);
    }

    // 2. Authorization denied (403) on candidate -> immediately returns error without calling build-tests or preview-token.
    mocks.candidateSource.mockRejectedValueOnce(new ApiRequestError("Forbidden", 403, { code: "FORBIDDEN" }));
    const deniedTarget = await defaultResolvePreview({ appId: workspaceId, revision: "working", entryId: null });
    expect(deniedTarget).toEqual({ kind: "error", message: "Forbidden" });
    expect(mocks.nodeApiGet).not.toHaveBeenCalled();
    expect(mocks.nodeApiPost).not.toHaveBeenCalled();

    // 3. Candidate 404 -> falls back to hosted preview (build-tests + preview-token).
    mocks.candidateSource.mockRejectedValueOnce(new ApiRequestError("Not found", 404));
    mocks.nodeApiGet.mockResolvedValueOnce(null);
    mocks.nodeApiPost.mockResolvedValueOnce({ token: "tok-hosted" });
    const hostedTarget = await defaultResolvePreview({ appId: workspaceId, revision: "working", entryId: null });
    expect(hostedTarget.kind).toBe("hosted");
    if (hostedTarget.kind === "hosted") {
      expect(hostedTarget.executionContext).toMatchObject({ kind: "build-test", workspaceId, status: "NONE" });
      expect(decodeURIComponent(hostedTarget.src.split("#")[1]!)).toBe(
        `/api/workspaces/${workspaceId}/preview/tok-hosted/index.html`,
      );
    }

    // 4. Candidate 404 + preview-token 409 BUILD_TEST_SDK_UPGRADE_REQUIRED -> resolves kind="legacy-sdk".
    mocks.candidateSource.mockRejectedValueOnce(new ApiRequestError("Not found", 404));
    mocks.nodeApiGet.mockResolvedValueOnce(null);
    mocks.nodeApiPost.mockRejectedValueOnce(
      new ApiRequestError("Upgrade the workspace SDK references before previewing", 409, {
        code: "BUILD_TEST_SDK_UPGRADE_REQUIRED",
        details: {
          requiredVersion: "1.1.2",
          foundVersions: ["0.8.4"],
          upgrade: {
            kind: "edit-workspace-references",
            currentCommand: "sdk current",
            readCommands: ["sdk read sdk.json"],
            steps: ["Update SDK"],
          },
        },
      }),
    );
    const legacyTarget = await defaultResolvePreview({ appId: workspaceId, revision: "working", entryId: null });
    expect(legacyTarget).toEqual({
      kind: "legacy-sdk",
      requiredVersion: "1.1.2",
      foundVersions: ["0.8.4"],
    });

    // 5. Candidate 404 + preview-token 404 -> resolves kind="empty".
    mocks.candidateSource.mockRejectedValueOnce(new ApiRequestError("Not found", 404));
    mocks.nodeApiGet.mockResolvedValueOnce(null);
    mocks.nodeApiPost.mockRejectedValueOnce(new ApiRequestError("index.html not found", 404));
    const emptyTarget = await defaultResolvePreview({ appId: workspaceId, revision: "working", entryId: null });
    expect(emptyTarget).toEqual({ kind: "empty" });
  });

  it("detectLegacySdkError recognizes both code-only and structured upgrade details envelopes", () => {
    expect(
      detectLegacySdkError(new ApiRequestError("Legacy SDK", 409, { code: "BUILD_TEST_SDK_UPGRADE_REQUIRED" })),
    ).toEqual({ message: "Legacy SDK" });
    expect(detectLegacySdkError({ code: "LEGACY_SDK", message: "Unsupported legacy SDK" })).toEqual({
      message: "Unsupported legacy SDK",
    });
    expect(detectLegacySdkError(new ApiRequestError("Server error", 500))).toBeNull();
  });
});
