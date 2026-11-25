import { inject, type InjectionKey } from "vue";

/** Lifecycle status of an embedded application preview surface. */
export type AppPreviewStatus = "empty" | "loading" | "ready" | "legacy-sdk" | "error";

/** Selected object identity reported by a previewed application page. */
export interface AppPreviewSelectionItem {
  readonly objectType: string;
  readonly primaryKey: string;
  readonly label?: string;
}

/** Navigation and selection context reported by the previewed application. */
export interface AppPreviewContext {
  readonly page: string | null;
  readonly selection: readonly AppPreviewSelectionItem[];
}

/** Status transition payload reported by `AppPreview`. */
export interface AppPreviewStatusPayload {
  readonly status: AppPreviewStatus;
  readonly message?: string;
}

/**
 * Input passed from `AppPreview` to the platform preview host.
 * Authorization and ownership are enforced strictly server-side by the platform/application owner.
 */
export interface PanelPreviewRequest {
  /** Target application or builder project identifier; null/empty means nothing is selected yet. */
  readonly appId: string | null;
  /** Preview revision: `"working"` for current uncommitted files or a commit SHA. */
  readonly revision: string;
  /** Optional entry identifier for multi-entry panel applications. */
  readonly entryId: string | null;
  /** Host container element into which the platform mounts a live preview surface (`panel` or `hosted`). */
  readonly container: HTMLElement;
  /** Callback reporting navigation and selection changes inside the previewed application. */
  readonly onContextChange: (context: AppPreviewContext) => void;
  /** Optional callback reporting asynchronous status updates after initial resolution. */
  readonly onStatusChange?: (payload: AppPreviewStatusPayload) => void;
}

/** Disposer returned when the platform host mounts a live preview surface (`panel` or `hosted`). */
export interface PanelPreviewMountHandle {
  dispose(): void;
}

/**
 * Outcome of resolving and mounting an application preview in the platform host.
 * Preview tokens, build-test headers, credentials, and raw iframe URLs stay strictly inside the platform host
 * and are never exposed to panel scripts.
 */
export type PanelPreviewOutcome =
  | {
      readonly kind: "panel";
      readonly handle: PanelPreviewMountHandle;
      readonly page?: string | null;
    }
  | {
      readonly kind: "hosted";
      readonly handle: PanelPreviewMountHandle;
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

/**
 * Platform preview host provided to mounted panels so official `AppPreview` mounts candidate/live panel
 * applications or legacy hosted previews through platform-owned host boundaries without exposing preview tokens,
 * build-test headers, credentials, or raw iframe URLs to panel scripts.
 */
export interface PanelPreviewHost {
  /**
   * Resolves and mounts the preview for the requested application/revision/entry into `request.container`.
   * The host handles all server-side authorization checks and build-test execution bindings internally.
   */
  mount(request: PanelPreviewRequest, signal?: AbortSignal): Promise<PanelPreviewOutcome>;
}

export const panelPreviewHostKey: InjectionKey<PanelPreviewHost> = Symbol("panel-preview-host");

/** The platform preview host provided to a panel instance, or null outside a platform panel host. */
export function usePanelPreviewHost(): PanelPreviewHost | null {
  return inject(panelPreviewHostKey, null);
}
