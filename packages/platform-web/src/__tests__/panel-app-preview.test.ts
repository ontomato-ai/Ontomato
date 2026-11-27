import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import elementEn from "element-plus/es/locale/lang/en";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
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
  appCandidatePanelHost: vi.fn(),
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
    nodeApiGet: mocks.nodeApiGet,
  };
});

vi.mock("../panel-host", () => ({
  appCandidatePanelHost: mocks.appCandidatePanelHost,
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
  mocks.appCandidatePanelHost.mockImplementation((candidate: unknown, pageKey: string) => ({
    source: async () => candidate,
    pageKey,
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


  it("defaultResolvePreview resolves application panel candidate, empty, legacy-sdk, and 403 error", async () => {
    const appId = "app-demo";
    const candidatePayload = {
      kind: "app-candidate" as const,
      app: { id: appId, ref: "working", entryId: "main" },
      panel: {
        manifest: {
          state: {},
          members: {},
        },
        content: {
          html: "<div>Preview</div>",
          messages: {},
        },
      },
      previewContext: { kind: "preview" as const },
    };

    // 1. Panel candidate descriptor -> resolves kind="panel" with appCandidatePanelHost.
    mocks.nodeApiGet.mockResolvedValueOnce({
      kind: "panel",
      appId,
      activeEntryId: "main",
      candidate: candidatePayload,
    });
    const panelTarget = await defaultResolvePreview({ appId, revision: "working", entryId: "main" });
    expect(mocks.nodeApiGet).toHaveBeenLastCalledWith(`/product-panels/preview/app/${appId}?ref=working&entryId=main`);
    expect(panelTarget.kind).toBe("panel");
    if (panelTarget.kind === "panel") {
      expect(await panelTarget.port.source()).toEqual(candidatePayload);
    }

    // 2. Authorization denied (403) -> returns error immediately.
    mocks.nodeApiGet.mockRejectedValueOnce(new ApiRequestError("Forbidden", 403, { code: "FORBIDDEN" }));
    const deniedTarget = await defaultResolvePreview({ appId, revision: "working", entryId: null });
    expect(deniedTarget).toEqual({ kind: "error", message: "Forbidden" });

    // 3. 409 PREVIEW_SDK_UPGRADE_REQUIRED -> resolves kind="legacy-sdk".
    mocks.nodeApiGet.mockRejectedValueOnce(
      new ApiRequestError("Upgrade the workspace SDK references before previewing", 409, {
        code: "PREVIEW_SDK_UPGRADE_REQUIRED",
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
    const legacyTarget = await defaultResolvePreview({ appId, revision: "working", entryId: null });
    expect(legacyTarget).toEqual({
      kind: "legacy-sdk",
      requiredVersion: "1.1.2",
      foundVersions: ["0.8.4"],
    });

    // 4. Empty descriptor -> resolves kind="empty".
    mocks.nodeApiGet.mockResolvedValueOnce({ kind: "empty", appId });
    const emptyTarget = await defaultResolvePreview({ appId, revision: "working", entryId: null });
    expect(emptyTarget).toEqual({ kind: "empty" });
  });

  it("detectLegacySdkError recognizes both code-only and structured upgrade details envelopes", () => {
    expect(
      detectLegacySdkError(new ApiRequestError("Legacy SDK", 409, { code: "PREVIEW_SDK_UPGRADE_REQUIRED" })),
    ).toEqual({ message: "Legacy SDK" });
    expect(detectLegacySdkError({ code: "LEGACY_SDK", message: "Unsupported legacy SDK" })).toEqual({
      message: "Unsupported legacy SDK",
    });
    expect(detectLegacySdkError(new ApiRequestError("Server error", 500))).toBeNull();
  });
});
