import type { ComputedRef, InjectionKey } from "vue";
import type { DisplayStateUpdate } from "@ontomato/agent-shell-ui";
import { PANEL_FRAME_QUERY_PREFIX } from "@ontomato/contracts/panel-host";
import type { PanelDeepLinkStateValue, PanelManifest } from "@ontomato/contracts/panel-manifest";
import type {
  ApplicationEntryMenu,
  ApplicationEntryResolution,
  CurrentApplicationEntry,
} from "@ontomato/contracts/product-panels";
import type { DisplayedPanel } from "./panel-conversation-display";
import type { PanelSessionFeed } from "./panel-session-runs";
import type { PanelObjectChange } from "./panel-host";

export type FrameState = Record<string, PanelDeepLinkStateValue>;

export interface PanelFrameRegistration {
  applicationId: string;
  framePanelId: string | undefined;
  /** True once entry resolution has settled (admitted or denied) for this application. */
  resolved: boolean;
  /** True when the opened path is denied or missing in this application. */
  missing: boolean;
  use: ApplicationEntryResolution["use"] | null;
  panel: DisplayedPanel | null;
  currentEntry: CurrentApplicationEntry | null;
  menu: ApplicationEntryMenu | null;
  onObjectChange: (change: PanelObjectChange) => void;
}

export interface ApplicationFrameHostBridge {
  /** Shared frame state decoded from `frame.*` URL parameters merged over live frame state and manifest defaults. */
  readonly frameState: ComputedRef<FrameState>;
  /** True while the outer frame host owns an active (loading or ready) frame for the current application. */
  readonly active: ComputedRef<boolean>;
  /** True once the active outer frame panel's surface is ready. */
  readonly surfaceReady: ComputedRef<boolean>;
  readonly liveState: ComputedRef<DisplayStateUpdate | null>;
  readonly ownsComposer: ComputedRef<boolean>;
  readonly feed: PanelSessionFeed;
  /** Refreshes the outer frame panel when the content page reports an object mutation. */
  refreshFrame(change: PanelObjectChange): void;
  /** Registers the mounted full-page panel route with the outer frame host; returns an unregister callback. */
  registerPanelEntry(registration: ComputedRef<PanelFrameRegistration | null>): () => void;
}

export const applicationFrameHostKey: InjectionKey<ApplicationFrameHostBridge> =
  Symbol("platform-application-frame-host");

/** Extracts declared deep-linkable default values from a frame panel manifest. */
export function deepLinkDefaultsOf(manifest: Pick<PanelManifest, "state"> | undefined): FrameState {
  if (!manifest) return {};
  const defaults: FrameState = {};
  for (const [name, field] of Object.entries(manifest.state)) {
    if (field.deepLink && field.default !== undefined) {
      defaults[name] = field.default as PanelDeepLinkStateValue;
    }
  }
  return defaults;
}

/** Reports whether an application panel address carries any `frame.<name>` query parameter. */
export function hasFrameParams(address: string): boolean {
  const search = address.split("?")[1];
  if (!search) return false;
  for (const key of new URLSearchParams(search).keys()) {
    if (key.startsWith(PANEL_FRAME_QUERY_PREFIX) && key.length > PANEL_FRAME_QUERY_PREFIX.length) return true;
  }
  return false;
}
