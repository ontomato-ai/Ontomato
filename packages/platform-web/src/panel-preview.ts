import * as Vue from "vue";
import { provideGlobalConfig } from "element-plus";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import {
  buildExecutionContext,
  buildTestContextSchema,
  buildTestSdkUpgradeDetailsSchema,
  type AppExecutionContext,
} from "@ontomato/contracts/build-tests";
import type { PageContext, PageSelection } from "@ontomato/contracts/page-context";
import { appCandidatePanelSourceSchema, panelAddressState, type AppCandidatePanelSource } from "@ontomato/contracts/panel-host";
import type {
  AppPreviewSelectionItem,
  PanelPreviewHost,
  PanelPreviewMountHandle,
  PanelPreviewOutcome,
  PanelPreviewRequest,
} from "@ontomato/apps-sdk/direct";
import { PanelHost, type PanelHostLabels, type PanelHostPort } from "@ontomato/platform-shell";
import { ApiRequestError, apiUrl, nodeApiGet } from "@ontomato/workbench-ui";
import { workbenchI18n, workbenchLanguage } from "@ontomato/workbench-ui/i18n";
import { registerBuildPreview } from "./app-host";
import { appCandidatePanelHost } from "./panel-host";

const LEGACY_SDK_ERROR_CODES = new Set([
  "BUILD_TEST_SDK_UPGRADE_REQUIRED",
  "LEGACY_SDK",
  "PREVIEW_LEGACY_SDK",
  "SDK_UPGRADE_REQUIRED",
  "APP_SDK_UPGRADE_REQUIRED",
]);

/** Input passed to the preview resolver seam. */
export interface PreviewResolutionRequest {
  readonly appId: string;
  readonly revision: string;
  readonly entryId: string | null;
}

/**
 * Platform-internal target produced by a preview resolver before mounting into the preview container.
 * Sensitive details (`src` with preview token, `executionContext`, and `PanelHostPort`) remain strictly inside
 * `@ontomato/platform-web` and are never exposed to panel scripts.
 */
export type ResolvedPreviewTarget =
  | {
      readonly kind: "panel";
      readonly port: PanelHostPort;
      readonly address: string;
      readonly label?: string;
      readonly initial?: Record<string, unknown>;
    }
  | {
      readonly kind: "hosted";
      readonly src: string;
      readonly executionContext: Extract<AppExecutionContext, { kind: "build-test" }>;
      readonly page?: string | null;
    }
  | {
      readonly kind: "empty";
      readonly message?: string;
    }
  | {
      readonly kind: "legacy-sdk";
      readonly message?: string;
      readonly requiredVersion?: string;
      readonly foundVersions?: readonly string[];
    }
  | {
      readonly kind: "error";
      readonly message: string;
    };

/** Pluggable resolver seam so application builder backends (e.g. `app_builder_projects`) plug directly into the host. */
export type PreviewTargetResolver = (
  request: PreviewResolutionRequest,
  signal?: AbortSignal,
) => Promise<ResolvedPreviewTarget>;

export interface CreatePanelPreviewHostOptions {
  /** Custom preview target resolver; defaults to workspace candidate panel -> legacy hosted preview resolution. */
  resolvePreview?: PreviewTargetResolver;
  /** Optional custom panel target mounter (primarily for tests). */
  mountPanel?: (
    target: Extract<ResolvedPreviewTarget, { kind: "panel" }>,
    request: PanelPreviewRequest,
  ) => PanelPreviewMountHandle;
  /** Optional custom build-test iframe registrar (primarily for tests). */
  registerHostedPreview?: typeof registerBuildPreview;
}

export interface LegacySdkDetection {
  readonly message?: string;
  readonly requiredVersion?: string;
  readonly foundVersions?: readonly string[];
}

function extractDetailsObject(payload: Record<string, unknown>): unknown {
  if ("details" in payload && payload.details !== undefined) return payload.details;
  const nested = payload.error;
  if (nested && typeof nested === "object" && "details" in nested) {
    return (nested as { details?: unknown }).details;
  }
  return undefined;
}

/**
 * Detects legacy SDK / SDK upgrade errors returned by the backend or host (such as HTTP 409
 * `BUILD_TEST_SDK_UPGRADE_REQUIRED` with `BuildTestSdkUpgradeDetails`).
 */
export function detectLegacySdkError(failure: unknown): LegacySdkDetection | null {
  if (failure instanceof ApiRequestError) {
    const code = failure.code?.toUpperCase();
    const parsedDetails = buildTestSdkUpgradeDetailsSchema.safeParse(extractDetailsObject(failure.payload));
    if (parsedDetails.success) {
      return {
        requiredVersion: parsedDetails.data.requiredVersion,
        foundVersions: parsedDetails.data.foundVersions,
      };
    }
    if (code && LEGACY_SDK_ERROR_CODES.has(code)) {
      return { message: failure.message };
    }
    return null;
  }

  if (failure && typeof failure === "object") {
    const candidate = failure as { code?: unknown; message?: unknown; details?: unknown };
    const parsedDetails = buildTestSdkUpgradeDetailsSchema.safeParse(candidate.details);
    if (parsedDetails.success) {
      return {
        requiredVersion: parsedDetails.data.requiredVersion,
        foundVersions: parsedDetails.data.foundVersions,
      };
    }
    if (typeof candidate.code === "string" && LEGACY_SDK_ERROR_CODES.has(candidate.code.toUpperCase())) {
      return {
        ...(typeof candidate.message === "string" && candidate.message.trim() ? { message: candidate.message } : {}),
      };
    }
  }

  return null;
}

function failureMessage(failure: unknown): string {
  if (failure instanceof Error && failure.message.trim()) return failure.message;
  return String(failure);
}

function isNotFoundError(failure: unknown): boolean {
  return failure instanceof ApiRequestError && failure.status === 404;
}

function isAuthorizationError(failure: unknown): boolean {
  return failure instanceof ApiRequestError && (failure.status === 401 || failure.status === 403);
}

function isInvalidCandidateError(failure: unknown): boolean {
  if (!(failure instanceof ApiRequestError)) return false;
  return failure.status === 400 || failure.code === "PANEL_CANDIDATE_INVALID";
}

interface ApplicationPreviewDescriptor {
  kind: "empty" | "hosted" | "panel";
  appId: string;
  workspaceId?: string | null;
  activeEntryId?: string | null;
  hostedPreviewUrl?: string;
  previewContext?: { kind: "build-test"; test: unknown };
  candidate?: unknown;
}

function hostedPreviewSrc(hostedPreviewUrl: string): string {
  if (hostedPreviewUrl.startsWith("/api/")) {
    return apiUrl(hostedPreviewUrl.slice("/api".length));
  }
  return hostedPreviewUrl;
}

/**
 * Default resolver for application-backed previews:
 * queries the authoritative application preview descriptor (`GET /product-panels/preview/app/:appId`) and mounts
 * either a candidate/live panel (`appCandidatePanelHost`) or a legacy hosted preview iframe without leaking preview
 * tokens, build-test headers, or raw iframe URLs to panel scripts.
 */
export async function defaultResolvePreview(
  request: PreviewResolutionRequest,
  signal?: AbortSignal,
): Promise<ResolvedPreviewTarget> {
  if (signal?.aborted) return { kind: "empty" };

  const query = new URLSearchParams({ ref: request.revision });
  if (request.entryId) query.set("entryId", request.entryId);

  let descriptor: ApplicationPreviewDescriptor;
  try {
    descriptor = (await nodeApiGet(
      `/product-panels/preview/app/${encodeURIComponent(request.appId)}?${query}`,
    )) as ApplicationPreviewDescriptor;
  } catch (failure) {
    if (signal?.aborted) return { kind: "empty" };

    const legacy = detectLegacySdkError(failure);
    if (legacy) return { kind: "legacy-sdk", ...legacy };

    if (isAuthorizationError(failure) || isInvalidCandidateError(failure)) {
      return { kind: "error", message: failureMessage(failure) };
    }

    if (isNotFoundError(failure)) {
      return { kind: "empty" };
    }

    return { kind: "error", message: failureMessage(failure) };
  }

  if (signal?.aborted) return { kind: "empty" };

  if (descriptor.kind === "empty") {
    return { kind: "empty" };
  }

  if (descriptor.kind === "panel") {
    const candidate: AppCandidatePanelSource = appCandidatePanelSourceSchema.parse(descriptor.candidate);
    const pageKey = descriptor.activeEntryId?.trim() || request.entryId?.trim() || "preview";
    const address = `/app-preview/${encodeURIComponent(request.appId)}/${encodeURIComponent(request.revision)}/${encodeURIComponent(pageKey)}`;
    return {
      kind: "panel",
      port: appCandidatePanelHost(candidate, pageKey),
      address,
    };
  }

  if (descriptor.kind === "hosted" && descriptor.hostedPreviewUrl) {
    const parsedTest = buildTestContextSchema.nullable().parse(descriptor.previewContext?.test ?? null);
    const executionContext = buildExecutionContext(descriptor.workspaceId ?? request.appId, parsedTest);
    return {
      kind: "hosted",
      src: hostedPreviewSrc(descriptor.hostedPreviewUrl),
      executionContext,
      page: request.entryId ?? "/",
    };
  }

  return { kind: "empty" };
}

function toPreviewSelectionItem(item: PageSelection): AppPreviewSelectionItem {
  return {
    objectType: item.kind === "child-object" && "collection" in item ? item.collection : item.kind,
    primaryKey: item.id,
    label: item.label,
  };
}

function mountPanelTarget(
  target: Extract<ResolvedPreviewTarget, { kind: "panel" }>,
  request: PanelPreviewRequest,
): PanelPreviewMountHandle {
  const i18n = workbenchI18n();
  const { global } = i18n;
  const language = workbenchLanguage();
  let disposed = false;
  const currentAddress = Vue.ref(target.address);
  let latestSelection: readonly AppPreviewSelectionItem[] = [];

  const labels = Vue.computed<PanelHostLabels>(() => ({
    notStarted: global.t("platform.panelNotStarted"),
    failures: {
      fileUnavailable: global.t("platform.panelFileUnavailable", { file: "{file}" }),
      scriptThrew: global.t("platform.panelScriptThrew"),
      scriptRejected: global.t("platform.panelScriptRejected"),
    },
    content: { styleOutside: global.t("platform.panelStyleOutside") },
    refresh: global.t("common.refresh"),
  }));

  const panelLanguage = Vue.computed(() => ({
    locale: global.locale.value,
    fallback: String(global.fallbackLocale.value),
  }));

  const initial = target.initial ?? panelAddressState(target.address);
  const label = target.label ?? global.t("platform.panelCandidateLabel", { ref: request.revision });

  const Root = Vue.defineComponent({
    name: "PlatformPanelPreviewHostMount",
    setup() {
      return () =>
        Vue.h(PanelHost, {
          port: target.port,
          address: currentAddress.value,
          initial,
          label,
          labels: labels.value,
          language: panelLanguage.value,
          historyBack: false,
          onContext(context: PageContext) {
            if (disposed) return;
            latestSelection = context.selection.map(toPreviewSelectionItem);
            const page = context.url || currentAddress.value || null;
            request.onContextChange({
              page,
              selection: latestSelection,
            });
          },
          "onDisplay-address"(input: DisplayPageAddressInput) {
            if (disposed) return;
            if (input.address) {
              currentAddress.value = input.address;
              request.onContextChange({
                page: input.address,
                selection: latestSelection,
              });
            }
          },
          "onDisplay-loaded"(load: DisplayLoad) {
            if (disposed) return;
            if (load.status === "error") {
              const legacy = detectLegacySdkError(load.error);
              if (legacy) {
                request.onStatusChange?.({
                  status: "legacy-sdk",
                  ...(legacy.message ? { message: legacy.message } : {}),
                });
              } else {
                request.onStatusChange?.({
                  status: "error",
                  message: load.error?.message || global.t("platform.appPreview.errorTitle"),
                });
              }
            }
          },
        });
    },
  });

  const hostEl = document.createElement("div");
  hostEl.className = "platform-app-preview-panel-mount";
  hostEl.style.display = "flex";
  hostEl.style.flexDirection = "column";
  hostEl.style.flex = "1 1 auto";
  hostEl.style.height = "100%";
  hostEl.style.minHeight = "0";
  hostEl.style.minWidth = "0";
  hostEl.style.width = "100%";
  request.container.replaceChildren(hostEl);

  const app = Vue.createApp(Root);
  app.use(i18n);
  provideGlobalConfig(Vue.computed(() => ({ locale: language.elementLocale(global.locale.value) })), app, true);
  app.mount(hostEl);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      app.unmount();
      if (hostEl.parentElement === request.container) {
        request.container.removeChild(hostEl);
      }
    },
  };
}

function mountHostedTarget(
  target: Extract<ResolvedPreviewTarget, { kind: "hosted" }>,
  request: PanelPreviewRequest,
  registerHostedPreview: typeof registerBuildPreview,
): PanelPreviewMountHandle {
  const { global } = workbenchI18n();
  const iframe = document.createElement("iframe");
  iframe.className = "platform-app-preview-hosted-frame";
  iframe.title = global.t("platform.appPreview.iframeTitle");
  iframe.referrerPolicy = "no-referrer";
  iframe.style.flex = "1 1 auto";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  iframe.style.minHeight = "0";

  // Append before registering so `contentWindow` exists, and register build-test binding strictly BEFORE setting `src`.
  request.container.replaceChildren(iframe);
  if (!iframe.contentWindow) {
    iframe.remove();
    throw new Error("Hosted preview frame is not attached to a browsing context");
  }

  const binding = registerHostedPreview(iframe.contentWindow, target.executionContext);
  let disposed = false;
  try {
    iframe.src = target.src;
  } catch (failure) {
    binding.dispose();
    iframe.remove();
    throw failure;
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      binding.dispose();
      iframe.remove();
    },
  };
}

/**
 * Creates the platform `PanelPreviewHost` injected into mounted panels under `panelPreviewHostKey`.
 * Resolves and mounts panel or legacy hosted previews through platform-owned host boundaries without exposing
 * preview tokens, build-test headers, credentials, or raw iframe URLs to panel scripts.
 */
export function createPanelPreviewHost(options: CreatePanelPreviewHostOptions = {}): PanelPreviewHost {
  const resolvePreview = options.resolvePreview ?? defaultResolvePreview;
  const mountPanel = options.mountPanel ?? mountPanelTarget;
  const registerHostedPreview = options.registerHostedPreview ?? registerBuildPreview;

  return {
    async mount(request: PanelPreviewRequest, signal?: AbortSignal): Promise<PanelPreviewOutcome> {
      const appId = request.appId?.trim();
      if (!appId) return { kind: "empty" };
      if (signal?.aborted) return { kind: "empty" };

      let target: ResolvedPreviewTarget;
      try {
        target = await resolvePreview(
          {
            appId,
            revision: request.revision?.trim() || "working",
            entryId: request.entryId?.trim() || null,
          },
          signal,
        );
      } catch (failure) {
        if (signal?.aborted) return { kind: "empty" };
        const legacy = detectLegacySdkError(failure);
        if (legacy) return { kind: "legacy-sdk", ...legacy };
        return { kind: "error", message: failureMessage(failure) };
      }

      if (signal?.aborted) return { kind: "empty" };

      switch (target.kind) {
        case "panel": {
          const handle = mountPanel(target, request);
          return {
            kind: "panel",
            handle,
            page: target.address,
          };
        }
        case "hosted": {
          const handle = mountHostedTarget(target, request, registerHostedPreview);
          return {
            kind: "hosted",
            handle,
            page: target.page ?? request.entryId ?? "/",
          };
        }
        case "empty":
          return target.message !== undefined ? { kind: "empty", message: target.message } : { kind: "empty" };
        case "legacy-sdk":
          return {
            kind: "legacy-sdk",
            ...(target.message !== undefined ? { message: target.message } : {}),
            ...(target.requiredVersion !== undefined ? { requiredVersion: target.requiredVersion } : {}),
            ...(target.foundVersions !== undefined ? { foundVersions: target.foundVersions } : {}),
          };
        case "error":
          return { kind: "error", message: target.message };
      }
    },
  };
}
