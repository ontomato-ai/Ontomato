<script setup lang="ts">
import { computed, inject, markRaw, onBeforeUnmount, provide, reactive, ref, shallowRef, toRaw, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElButton, ElSkeleton } from "element-plus";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import { PanelHost, PlatformPageHeader, panelOverlayContainerKey, panelUnavailable, useApplicationFrame, useApplicationTheme, useAppTheme, useUnsavedChanges, type PanelHostLabels, type PanelHostPort, type PanelInstanceView } from "@ontomato/platform-shell";
import {
  applicationPanelAddress,
  panelAddressState,
  panelUsePath,
  parseApplicationPanelAddress,
} from "@ontomato/contracts/panel-host";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelDeepLinkStateValue } from "@ontomato/contracts/panel-manifest";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { applicationFrameContextOf, isApplicationPanelUse, isFrameConversationEntry, isNativeApplicationEntry, type ApplicationOpenResponse, type ApplicationPanelUse, type BundledPanelProjection, type ProductPanel } from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { PageComposer, pagePaneElementKey, usePageCounter, type DisplayObjectRefresh, type DisplayPageController, type DisplayStateUpdate } from "@ontomato/agent-shell-ui";
import { ApiRequestError } from "@ontomato/workbench-ui";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageSkillContext } from "@ontomato/contracts/page-context";
import { APPLICATION, FAVORITE, PRODUCT_PANEL } from "@ontomato/contracts/platform-object-types";
import { HOME_PREFERENCES_CHANGED, readHomePanel, saveHomePanel } from "../features/home/api";
import { panelHasInlineConversationEntry, platformPanelHost, resolveApplicationEntry, type PanelObjectChange } from "../panel-host";
import { routeOpenedEntry } from "../panel-entries";
import {
  applicationFrameHostKey,
  frameAddressState,
  type FrameState,
  type PanelFrameRegistration,
} from "../application-frame-context";
import { usePanelConversationDisplay, type DisplayedPanel } from "../panel-conversation-display";
import { usePanelSessionRuns } from "../panel-session-runs";
import EntryUnit from "./EntryUnit.vue";
import EntryResolutionFailure from "../EntryResolutionFailure.vue";
import { usePlatformDataStateLabels } from "../data-state-labels";
import { hostThemeMode } from "../app-host";
import { useApplicationCatalog } from "../catalog";

/**
 * One page of an application whose entry is `renderer:'panels'`: the panel that one of its use relations names, shown
 * full.
 *
 * The address is the use relation's own full path, as Java declares it — `/applications/<application>/...` for a domain
 * application — and the panel's declared deep-linkable state rides in the same address as `state`, so a link or an
 * agent's open request restores the view, a reload opens the same one, and no credential ever appears there. The
 * application's root address opens its first use the reader may see.
 *
 * The instance is the page's, keyed by the application and the use relation — not by the address — because the address
 * changes whenever the reader selects something: replacing the address must not rebuild the panel and lose that
 * selection.
 *
 * Going from one of the application's pages to another keeps the page left, up to `KEPT_PAGES`: back on it, the reader
 * finds its frame as it was, with no frame rebuilt and no SDK loaded again, while its definition and objects are checked
 * behind it. A kept page holds no stream and reports nothing. Leaving the application drops them all.
 */
const props = defineProps<{
  /** The application whose panel this address shows. */
  applicationId: string;
  /**
   * The conversation's callback for explicit navigation, supplied when the display controller owns this page.
   * A full-page instance uses the router for its address.
   */
  navigate?: (address: string) => void;
  /**
   * The page's address beside the conversation, as the conversation carries it, with the state the page opens at. Shown
   * full, the router's address is the page's.
   */
  address?: string;
  legacyDashboardLayout?: boolean;
  takeOpenedEntry?: () => ApplicationOpenResponse | undefined;
  objectRefresh?: DisplayObjectRefresh | null;
  liveState?: DisplayStateUpdate | null;
  registerPageController?: (controller: DisplayPageController) => () => void;
}>();
const emit = defineEmits<{
  /** What the reader looks at in the panel, as its instance reports it: what a message written beside it carries. */
  context: [context: PageContext];
  "display-address": [input: DisplayPageAddressInput];
  "objects-changed": [change: PanelObjectChange];
  "display-loaded": [load: DisplayLoad];
  "display-dirty": [dirty: boolean];
  /** Current placement a message written beside the shown page carries, as resolved with the page's entry. */
  "display-skill": [context: PageSkillContext | null];
}>();

const route = useRoute();
const router = useRouter();
const { t, locale, fallbackLocale } = useI18n();
const dataStateLabels = usePlatformDataStateLabels();
const pageCounter = usePageCounter();
/** The language a panel's own name is given in: the reader's, else the deployment's default. */
const language = computed(() => ({ locale: locale.value, fallback: String(fallbackLocale.value) }));
/** The shown page's instance, which the conversation's object signal reaches; kept pages are reconciled when shown again. */
/** What the conversation's and an operation's changes reach: the shown page's instance. */
type ShownInstance = Pick<PanelInstanceView, "refresh" | "validateState" | "applyState" | "blockedForms" | "blocksNavigation" | "guardNavigation" | "guardAgentPresentation" | "presentationAddress" | "fillForm" | "executeAction" | "snapshotMeta" | "isLoading">;
const host = shallowRef<ShownInstance | null>(null);
/** Enclosing single outer frame host at full page; null beside a conversation (`props.navigate`). */
const outerFrame = props.navigate ? null : inject(applicationFrameHostKey, null);
let pendingControllerState: Record<string, RuntimeJsonValue> | null = null;
watch(host, (nextHost) => {
  if (!nextHost || !pendingControllerState) return;
  const patch = pendingControllerState;
  pendingControllerState = null;
  try {
    nextHost.applyState(patch);
  } catch (error) {
    emit("display-loaded", panelUnavailable(error));
  }
});
const pageController: DisplayPageController = {
  blockedForms(next) {
    return host.value?.blockedForms?.(next) ?? [];
  },
  blocksNavigation(next) {
    return host.value?.blocksNavigation?.(next) ?? false;
  },
  guardNavigation(next) {
    return host.value?.guardNavigation?.(next) ?? Promise.resolve(true);
  },
  guardAgentPresentation(next) {
    return host.value?.guardAgentPresentation?.(next) ?? Promise.resolve({ ok: true });
  },
  presentationAddress(address, patch) {
    return host.value?.presentationAddress(address, patch) ?? address;
  },
  validateState(patch) {
    host.value?.validateState(patch);
  },
  applyState(patch) {
    if (!host.value) {
      pendingControllerState = { ...(pendingControllerState ?? {}), ...patch };
      return;
    }
    host.value.applyState(patch);
  },
  fillForm(request) {
    if (!host.value) {
      return Promise.resolve({
        ok: false,
        reason: "form_not_ready",
        ...(request.member ? { member: request.member } : {}),
        ...(request.memberPath ? { memberPath: request.memberPath } : {}),
        message: "The panel is not mounted and ready for form filling.",
      });
    }
    return host.value.fillForm(request);
  },
  executeAction(request) {
    if (!host.value) {
      return Promise.resolve({
        ok: false,
        reason: "action_not_ready",
        operation: request.operation,
        message: "The panel is not mounted and ready for actions.",
      });
    }
    return host.value.executeAction(request);
  },
  snapshotMeta() {
    return host.value?.snapshotMeta?.() ?? {};
  },
  isLoading() {
    if (failure.value || missing.value) return false;
    if (verifying.value || !host.value) return true;
    return host.value.isLoading?.() ?? false;
  },
};
if (props.registerPageController) {
  const unregister = props.registerPageController(pageController);
  onBeforeUnmount(() => {
    pendingControllerState = null;
    unregister();
  });
}
/**
 * A change to objects the page shows, from the conversation or from a receipt for an operation in the shown frame: the
 * one place either is taken in. Both the entry panel and the enclosing application frame re-read what they display.
 */
function changed(change: PanelObjectChange) {
  refreshContent(change);
  emit("objects-changed", change);
  outerFrame?.refreshFrame(change);
  if (
    change.affected?.objectTypes?.includes(APPLICATION)
    || change.affected?.objectTypes?.includes(FAVORITE)
    || change.affected?.objectTypes?.includes(PRODUCT_PANEL)
    || change.affected?.objects?.some((item) => item.objectType === APPLICATION || item.objectType === FAVORITE || item.objectType === PRODUCT_PANEL)
  ) {
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
  }
}
function refreshContent(change: PanelObjectChange) {
  host.value?.refresh(change.target, change.affected, change.operation);
}
watch(() => props.objectRefresh?.seq, () => {
  if (props.objectRefresh) changed(props.objectRefresh);
}, { flush: "post" });

/**
 * How many of the application's pages keep their instance at once (design 7.2.1): the shown page and the five most
 * recently left clean pages, covering frequent switching across an application's core pages without rebuilding. Only a
 * page left with nothing unsaved is kept; a page left with unsaved changes is left through the platform's
 * unsaved-changes question, and its changes go with it.
 */
const KEPT_PAGES = 6;
/** How long the previous clean page stays visible during a same-application switch before showing the loading placeholder. */
const TRANSITION_PLACEHOLDER_DELAY_MS = 150;

/** A page of this application whose instance is kept, shown or not. */
interface KeptPage {
  use: ApplicationPanelUse;
  port: PanelHostPort;
  controller: ShownInstance | null;
  load: DisplayLoad;
  /** The instance's own address, with its state, as it last reported it: where it is shown again from its bare address. */
  reported: string;
  context: PageContext | null;
  /** Whether it holds unsaved changes; only the shown page can, and leaving it so drops it. */
  dirty: boolean;
  /** The latest current-page placement. Undefined means the first read is pending. */
  pageSkill: PageSkillContext | null | undefined;
  /** Shown again and not yet through its checks: what it reaches is passed on only once they have confirmed it. */
  rechecking: boolean;
  /** True by default for synchronous mock hosts in tests; real PanelHost emits false on mount until its surface renders. */
  surfaceReady: boolean;
  /** When the reader was last on it, in the order of the pages shown: the page dropped is the one left longest ago. */
  lastShown: number;
}
/**
 * The kept pages, in the order they were opened. The order never changes while a page is kept: a frame moved in the
 * document is loaded again, which is the rebuild keeping it avoids.
 */
// Typed as the pages themselves: unwrapping each page's port and contexts as reactive state is too deep to type.
const kept = ref([]) as Ref<KeptPage[]>;
/** Number of mounted embedded AgentChat projections per entry use ID (suppresses bottom PageComposer). */
const embeddedChatCounts = reactive<Record<string, number>>({});
let showings = 0;
const failure = ref("");
const catalog = useApplicationCatalog();
/**
 * Single opening answer for this application's entry: the admitted use relation, frame panel, theme, visible entry
 * menu, standalone policy, and bundled frame/content definitions.
 */
type EntryUse = Exclude<ApplicationOpenResponse["use"], { kind: "native" }>;
type PanelEntryResolution = ApplicationOpenResponse & { use: EntryUse };
const resolution = shallowRef<PanelEntryResolution | null>(null);
/** True while waiting for server admission on a direct link not present in the current application's entry table. */
const verifying = ref(false);
/** Entry path explicitly refused by the server (403/404 or mismatched application). */
const deniedPath = ref<string | null>(null);
const retainedPage = shallowRef<KeptPage | null>(null);
const transitionTimedOut = ref(false);
let transitionTimer: ReturnType<typeof setTimeout> | null = null;
let resolveEpoch = 0;
let refreshInFlight: Promise<void> | null = null;
let consumedInitial: ApplicationOpenResponse | null = null;
let unmounted = false;

function clearTransitionTimer() {
  if (transitionTimer !== null) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
}

function clearTransition() {
  clearTransitionTimer();
  retainedPage.value = null;
  transitionTimedOut.value = false;
}

function ensureTransitionTimer() {
  if (transitionTimer !== null || transitionTimedOut.value || !retainedPage.value) return;
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    transitionTimedOut.value = true;
    retainedPage.value = null;
  }, TRANSITION_PLACEHOLDER_DELAY_MS);
}

/** The page's address as the reader is on it: the conversation's page parameter beside a chat, the router's full. */
const opened = computed(() => props.address ?? route.fullPath);
const openedPath = computed(() => opened.value.split("?")[0]!);
const catalogApp = computed(() => catalog.applicationById(props.applicationId));
const currentResolution = computed(() =>
  resolution.value?.applicationId === props.applicationId ? resolution.value : null,
);
/** The catalogue supplies the root route's candidate; the opening result admits it even if it has no menu label. */
const entryPath = computed(() => {
  if (openedPath.value !== applicationRootPath(props.applicationId)) return openedPath.value;
  const first = catalogApp.value?.panelUses?.find(entry => !isNativeApplicationEntry(entry));
  return first ? panelUsePath(first.path) : null;
});

function revokeEntry(path: string) {
  kept.value = kept.value.filter((page) => panelUsePath(page.use.path) !== path);
  if (retainedPage.value && panelUsePath(retainedPage.value.use.path) === path) {
    clearTransition();
  }
  resolution.value = null;
  deniedPath.value = path;
  verifying.value = false;
}

async function requestEntryResolution(
  applicationId: string,
  path: string,
  options: { blocking: boolean; epoch?: number; useInitial?: boolean },
) {
  const epoch = options.epoch ?? ++resolveEpoch;
  if (options.blocking) {
    const previous = kept.value.find(page => page.use.id === resolution.value?.use.id);
    if (previous && !previous.dirty && previous.surfaceReady) {
      retainedPage.value = previous;
      ensureTransitionTimer();
    }
    verifying.value = true;
  }
  try {
    const initial = options.useInitial
      ? (props.takeOpenedEntry?.() ?? routeOpenedEntry(route, path))
      : null;
    const freshInitial = initial && initial !== consumedInitial
      && initial.applicationId === applicationId && panelUsePath(initial.use.path) === path
      ? initial
      : null;
    if (freshInitial) consumedInitial = freshInitial;

    let answer: ApplicationOpenResponse;
    if (freshInitial) {
      answer = freshInitial;
    } else {
      const request = resolveApplicationEntry({ path });
      const releasePending = outerFrame?.beginOpen(applicationId, request);
      try {
        answer = await request;
      } finally {
        releasePending?.();
      }
    }
    if (unmounted || epoch !== resolveEpoch || props.applicationId !== applicationId || entryPath.value !== path) return;
    if (answer.applicationId !== applicationId || isNativeApplicationEntry(answer.use)) {
      revokeEntry(path);
      return;
    }
    resolution.value = { ...answer, use: answer.use };
    outerFrame?.reportOpenedEntry(path, answer);
    deniedPath.value = null;
    failure.value = "";
    verifying.value = false;
  } catch (error) {
    if (unmounted || epoch !== resolveEpoch || props.applicationId !== applicationId || entryPath.value !== path) return;
    revokeEntry(path);
    if (!(error instanceof ApiRequestError) || (error.status !== 403 && error.status !== 404)) {
      failure.value = error instanceof Error ? error.message : String(error);
      emit("display-loaded", panelUnavailable(error));
    }
  }
}

function retryEntryResolution() {
  failure.value = "";
  void requestEntryResolution(props.applicationId, entryPath.value!, { blocking: true });
}

function refreshEntryTable() {
  if (unmounted || verifying.value) return Promise.resolve();
  if (refreshInFlight) return refreshInFlight;
  const applicationId = props.applicationId;
  const path = entryPath.value;
  if (!path) return Promise.resolve();
  const epoch = ++resolveEpoch;
  const task = requestEntryResolution(applicationId, path, { blocking: false, epoch }).finally(() => {
    if (refreshInFlight === task) refreshInFlight = null;
  });
  refreshInFlight = task;
  return task;
}

// Another application is another set of pages: drop kept pages and reset resolution/transition state at once
// so cross-application switches never flash the previous application's content or stale resolution.
watch(() => props.applicationId, (_next, previous) => {
  resolveEpoch += 1;
  refreshInFlight = null;
  kept.value = [];
  failure.value = "";
  resolution.value = null;
  verifying.value = false;
  deniedPath.value = null;
  clearTransition();
  if (previous !== undefined) {
    pendingControllerState = null;
  }
  emit("display-loaded", { status: "loading" });
}, { immediate: true, flush: "sync" });

watch([() => props.applicationId, entryPath], ([applicationId, path]) => {
  const epoch = ++resolveEpoch;
  deniedPath.value = null;
  failure.value = "";
  if (!path) {
    verifying.value = false;
    resolution.value = null;
    return;
  }
  void requestEntryResolution(applicationId, path, { blocking: true, epoch, useInitial: true });
}, { immediate: true });

const stopVisibility = onDocumentVisibility((visible) => {
  if (visible) void refreshEntryTable();
});

onBeforeUnmount(() => {
  unmounted = true;
  clearTransition();
  stopVisibility();
});

const resolvedUse = computed<EntryUse | null>(() => {
  const path = entryPath.value;
  const answer = currentResolution.value;
  if (!path || !answer) return null;
  return panelUsePath(answer.use.path) === path ? answer.use : null;
});
/**
 * The base use relation the opened address names before any per-user home panel override.
 */
const baseUse = computed<EntryUse | null>(() => {
  const path = entryPath.value;
  if (!path || verifying.value || deniedPath.value === path) return null;
  return resolvedUse.value;
});

const isHomeMainEntry = computed(() => props.applicationId === "home" && baseUse.value?.id === "home");
const homePanelStatus = ref<"idle" | "loading" | "ready" | "unavailable">("idle");
const customHomePanel = shallowRef<ProductPanel | null>(null);
const customHomeHasInlineComposer = ref(false);
const homePanelError = ref("");
const restoringDefaultHome = ref(false);
let homePanelEpoch = 0;

async function loadCustomHomePanel(options: { blocking: boolean }) {
  const epoch = ++homePanelEpoch;
  if (options.blocking) {
    homePanelStatus.value = "loading";
    homePanelError.value = "";
  }
  try {
    const { panel } = await readHomePanel();
    if (unmounted || epoch !== homePanelEpoch || !isHomeMainEntry.value) return;
    customHomePanel.value = panel;
    customHomeHasInlineComposer.value = panel ? panelHasInlineConversationEntry(panel) : false;
    homePanelError.value = "";
    homePanelStatus.value = "ready";
  } catch {
    if (unmounted || epoch !== homePanelEpoch || !isHomeMainEntry.value) return;
    customHomePanel.value = null;
    customHomeHasInlineComposer.value = false;
    homePanelError.value = t("home.customHomeUnavailable");
    homePanelStatus.value = "unavailable";
  }
}

async function restoreDefaultHomeWorkspace() {
  if (restoringDefaultHome.value) return;
  restoringDefaultHome.value = true;
  try {
    await saveHomePanel(null);
    await loadCustomHomePanel({ blocking: true });
  } catch (reason) {
    const detail = reason instanceof Error && reason.message ? reason.message : String(reason);
    homePanelError.value = t("home.restoreDefaultWorkspaceFailed", { reason: detail });
  } finally {
    restoringDefaultHome.value = false;
  }
}

watch(isHomeMainEntry, (active) => {
  homePanelEpoch += 1;
  if (!active) {
    homePanelStatus.value = "idle";
    customHomePanel.value = null;
    customHomeHasInlineComposer.value = false;
    homePanelError.value = "";
    return;
  }
  void loadCustomHomePanel({ blocking: true });
}, { immediate: true });

function onHomePreferencesChanged() {
  if (isHomeMainEntry.value) {
    void loadCustomHomePanel({ blocking: false });
  }
}
window.addEventListener(HOME_PREFERENCES_CHANGED, onHomePreferencesChanged);
onBeforeUnmount(() => {
  window.removeEventListener(HOME_PREFERENCES_CHANGED, onHomePreferencesChanged);
});

/**
 * The effective use relation the opened address names: admitted immediately when present in this application's known
 * entry table or already kept in this application (and confirmed by resolve-entry for direct links), overridden by
 * the user's custom `homePanelId` on the `"home"` entry when set, and null while awaiting verification or once refused.
 */
const use = computed<ApplicationPanelUse | null>(() => {
  const resolved = baseUse.value;
  if (!resolved || !isApplicationPanelUse(resolved)) return null;
  if (props.applicationId === "home" && resolved.id === "home") {
    if (homePanelStatus.value === "loading" || homePanelStatus.value === "unavailable") return null;
    if (customHomePanel.value) {
      return {
        ...resolved,
        panelId: customHomePanel.value.id,
        pageComposer: customHomeHasInlineComposer.value ? "none" : "bottom",
      };
    }
  }
  return resolved;
});
const frameConversation = computed(() => Boolean(baseUse.value && isFrameConversationEntry(baseUse.value)));
watch(frameConversation, (active) => {
  if (active) {
    kept.value = [];
    emit("display-loaded", { status: "ready" });
  }
});
const homeUnavailableBanner = computed(() => isHomeMainEntry.value && homePanelStatus.value === "unavailable");
/**
 * The application's theme from Java's answer (a `panels` application's only). At full page the platform's layout assigns
 * it on the application's area, its menu and its page; beside a conversation it is assigned on this content alone.
 */
const area = ref<HTMLElement | null>(null);
if (props.navigate) {
  const pagePane = inject(pagePaneElementKey, null);
  useAppTheme(area, () => currentResolution.value?.theme, hostThemeMode);
  // Anchor overlays and toasts to the persistent side pane when present so cross-panel navigation (which remounts this
  // route on path change) keeps emitted toasts visible inside the pane.
  provide(panelOverlayContainerKey, pagePane ?? area);
} else useApplicationTheme(() => currentResolution.value?.theme);
/** An address that names no use relation the reader may open is a page that cannot load, and its receipt says so. */
const missing = computed(() =>
  !verifying.value
  && !(isHomeMainEntry.value && (homePanelStatus.value === "loading" || homePanelStatus.value === "unavailable"))
  && !use.value
  && !frameConversation.value
    ? t("platform.panelNotInApplication", { path: openedPath.value })
    : "",
);
watch(missing, (message) => {
  if (message) emit("display-loaded", panelUnavailable(new Error(message)));
});

/*
 * Outer frame integration: at full page, the enclosing `ApplicationFrameHost` owns the single persistent frame panel,
 * its shared `frame.*` URL state, and `<current-entry>` placement. This route only registers its current entry/menu
 * and reads `outerFrame.frameState`. Beside a conversation (`props.navigate`), no frame is mounted, so declared
 * `deepLink: true` defaults on the frame come synchronously from the bundled `frame` definition in `currentResolution`.
 */
const activeBesideFrameManifest = computed(() => {
  if (outerFrame) return undefined;
  const answer = currentResolution.value;
  if (!answer?.framePanelId || !answer.frame || answer.frame.panel.id !== answer.framePanelId) return undefined;
  return answer.frame.panel.manifest;
});
const frameState = computed((): FrameState => {
  if (props.applicationId === "dashboards" && props.legacyDashboardLayout) return { legacyDashboardLayout: true };
  if (outerFrame) return outerFrame.frameState.value;
  const parsed = frameAddressState(opened.value, activeBesideFrameManifest.value);
  const named = parsed.named;
  const hasSegment = parsed.hasSegment;
  const defaults = parsed.defaults;
  if (hasSegment) return { ...defaults, ...named };
  return Object.keys(defaults).length ? defaults : named;
});
/** True while this full-page route is framed or awaiting admission for an application that declares a frame panel. */
const expectingFrame = computed(() => {
  if (props.navigate || missing.value) return false;
  if (currentResolution.value) return Boolean(currentResolution.value.framePanelId);
  return !deniedPath.value && Boolean(catalogApp.value?.framePanelId);
});
useApplicationFrame(() => expectingFrame.value);

const frameContext = computed(() => {
  const answer = currentResolution.value;
  const activeUse = use.value ?? baseUse.value;
  if (!activeUse) return null;
  const app = catalogApp.value;
  const menuUses = app?.panelUses?.filter(entry => entry.inMenu !== false) ?? [];
  return applicationFrameContextOf({
    applicationId: props.applicationId,
    menu: answer?.menu ?? {
      singleEntry: app?.singleEntry ?? (menuUses.length <= 1),
      names: app?.names,
      groups: app?.groups ?? [],
      panelUses: menuUses,
    },
    use: activeUse,
  });
});


const showContentLoading = computed(() =>
  !missing.value
  && !homeUnavailableBanner.value
  && !frameConversation.value
  && !displayedPage.value
  && !(outerFrame?.active.value && !outerFrame.surfaceReady.value),
);

/** What the panel host says to the reader, in the platform's language. */
const labels = computed<PanelHostLabels>(() => ({
  notStarted: t("platform.panelNotStarted"),
  failures: {
    // The frame puts the file it could not load where `{file}` stands.
    fileUnavailable: t("platform.panelFileUnavailable", { file: "{file}" }),
    scriptThrew: t("platform.panelScriptThrew"),
    scriptRejected: t("platform.panelScriptRejected"),
  },
  content: { styleOutside: t("platform.panelStyleOutside") },
  refresh: t("common.refresh"),
}));

/**
 * The composer at the foot of the page at its own address (big main's ruling, 2026-11-21): what a message written here
 * asks about is the page above it, and a conversation entry in the panel expands it. Beside a conversation the
 * conversation's own composer serves instead. Its configuration error is shown where it would be.
 */
const composerProblem = ref<string | null>(null);
/** The current placement a message written on the shown page carries, once its read or checks have confirmed it. */
const shownSkill = shallowRef<PageSkillContext | null>(null);
/** The shown page's placement is known: a message beside it, and the page's own composer, carry it. */
function passSkill(context: PageSkillContext | null) {
  shownSkill.value = context;
  emit("display-skill", context);
}
const composerLabels = computed(() => ({
  placeholder: t("assistant.placeholder"),
  send: t("assistant.send"),
  stop: t("assistant.stop"),
  agent: t("assistant.agent"),
  pageAgentUnavailable: t("assistant.pageAgentUnavailable"),
  collapseComposer: t("assistant.collapseComposer"),
  expandComposer: t("assistant.expandComposer"),
}));

/**
 * The page's address without the panel's own state: this relation's own full path and any preserved shell query
 * parameters. The state is the instance's to add.
 */
const pageAddress = computed(() => {
  const search = opened.value.split("?")[1];
  const path = use.value ? panelUsePath(use.value.path) : "";
  return search ? `${path}?${search}` : path;
});

/** The display owns a paired page's address. A standalone route reflects the same state in place. */
function reportAddress(input: DisplayPageAddressInput) {
  const page = shownPage.value!;
  const address = withoutEntryInputs(input.address, page.use);
  page.reported = address;
  if (props.navigate) {
    emit("display-address", { ...input, address });
    return;
  }
  if (opened.value !== address) void router.replace(address);
}

/**
 * The values an entry passes its content panel (product-layer standard, part three): a field the entry wires is the
 * entry's, so the panel takes the passed value whatever the address or the reader's saved state says, and the address
 * does not carry it. Only fixed values (\`literal\`) are passed for now: a value from a frame's state comes with frames.
 */
function entryInputs(use: ApplicationPanelUse): Record<string, PanelDeepLinkStateValue> {
  return Object.fromEntries(Object.entries(use.inputs ?? {}).flatMap(([field, input]) =>
    "literal" in input ? [[field, input.literal as PanelDeepLinkStateValue]]
      // A value the frame shares: its state as the address's \`frame\` segment carries it, framed or beside a conversation.
      : Object.hasOwn(frameState.value, input.frameState) ? [[field, frameState.value[input.frameState]!]] : []));
}
/** An address without the state fields the entry wires: those are the entry's to give, not the address's. */
function withoutEntryInputs(address: string, use: ApplicationPanelUse) {
  const wired = Object.keys(use.inputs ?? {});
  if (!wired.length || !address.includes("?")) return address;
  const { path, frame, state, query } = parseApplicationPanelAddress(address);
  for (const field of wired) delete state[field];
  return applicationPanelAddress(path, { frame, state, query });
}

const requestedState = computed(() => panelAddressState(opened.value));

/**
 * The page's name is the application's: its use relation's display name in the reader's language. A relation without
 * one is named by what its panel reports.
 */
const pageName = computed(() => localizedApplicationText(use.value?.names, locale.value) ?? "");

const shownPage = computed<KeptPage | null>(() =>
  kept.value.find((page) => page.use.id === use.value?.id && page.use.panelId === use.value?.panelId) ?? null,
);
watch(shownPage, (next) => {
  host.value = next?.controller ?? null;
});
watch(() => currentResolution.value?.pageSkillContext, context => {
  const page = shownPage.value;
  if (!page || page.use.id !== currentResolution.value?.use.id) return;
  const next = context ?? null;
  if (page.pageSkill === next) return;
  page.pageSkill = next;
  if (!page.rechecking && page.load.status === "ready") passSkill(next);
}, { flush: "post" });
function displayedPanel(): DisplayedPanel | null {
  const page = shownPage.value;
  return page ? {
    controller: page.controller ? pageController : null,
    context: page.context,
    skill: shownSkill.value,
    dirty: page.dirty,
    load: page.load,
  } : null;
}
if (outerFrame) {
  const registration = computed<PanelFrameRegistration>(() => {
    const answer = currentResolution.value;
    const activeUse = use.value;
    const context = frameContext.value;
    const resolved = Boolean(answer || deniedPath.value || missing.value);
    return {
      applicationId: props.applicationId,
      framePanelId: answer ? answer.framePanelId : (!deniedPath.value ? catalogApp.value?.framePanelId : undefined),
      resolved,
      missing: Boolean(missing.value),
      use: activeUse ?? baseUse.value,
      openedEntry: answer,
      panel: displayedPanel(),
      currentEntry: context?.currentEntry ?? (activeUse ? {
        applicationId: props.applicationId,
        useId: activeUse.id,
        pageKey: activeUse.pageKey,
        panelId: activeUse.panelId,
        kind: "panel",
        path: panelUsePath(activeUse.path),
      } : null),
      menu: context?.menu ?? null,
      onObjectChange(change) {
        refreshContent(change);
      },
    };
  });
  const unregisterFrameEntry = outerFrame.registerPanelEntry(registration);
  onBeforeUnmount(unregisterFrameEntry);
}

const embeddedDisplay = props.navigate ? null : usePanelConversationDisplay({
  router,
  address: () => shownPage.value ? addressOf(shownPage.value) : null,
  contains: path => path === openedPath.value || path === entryPath.value,
  panel: displayedPanel,
  refresh: changed,
});
const feed = outerFrame?.feed ?? (props.navigate ? undefined : usePanelSessionRuns(() => Boolean(use.value), refreshContent));

/**
 * The visually displayed page: the logical current page once its surface is ready, otherwise the retained previous
 * page of the same application for up to TRANSITION_PLACEHOLDER_DELAY_MS, else null (loading placeholder).
 */
const displayedPage = computed<KeptPage | null>(() => {
  const current = shownPage.value;
  if (current?.surfaceReady) return current;
  const retained = retainedPage.value;
  if ((current || verifying.value) && retained && !transitionTimedOut.value && retained.surfaceReady) {
    const alive = kept.value.find((page) => toRaw(page) === toRaw(retained));
    if (alive) return alive;
  }
  return null;
});

/**
 * The page the reader opens becomes the shown one: a kept page as it was left, or a new instance. At `KEPT_PAGES`, the
 * page with nothing unsaved that the reader left longest ago is dropped to make room.
 *
 * The page the reader opened is known before its frame has loaded: its name and address go to the conversation at once,
 * with no selection, since the panel has not said what it shows yet. What the frame reports later adds that; a kept page
 * says what it showed when it was left.
 */
watch(use, (next, previous) => {
  // Same entry bound to the same panel: nothing to switch or rebuild.
  if (next && previous?.id === next.id && previous.panelId === next.panelId) return;
  // A page left with unsaved changes was left through the unsaved-changes question: its changes go with its instance.
  const left = previous && previous.id !== next?.id ? kept.value.find((page) => page.use.id === previous.id) : undefined;
  if (left?.dirty) kept.value = kept.value.filter((page) => page !== left);
  // Drop any kept instance for the same use relation if it was rebound to a different panel.
  if (next) {
    kept.value = kept.value.filter((page) => !(page.use.id === next.id && page.use.panelId !== next.panelId));
  }
  shownSkill.value = null;
  if (!next) {
    if (!verifying.value) clearTransition();
    return;
  }
  performance.mark("ontomato:panel-page-opened", { detail: { applicationId: props.applicationId, useId: next.id } });
  const found = kept.value.find((page) => page.use.id === next.id && page.use.panelId === next.panelId);
  if (found) found.lastShown = ++showings;
  else if (kept.value.length >= KEPT_PAGES) {
    const [oldest] = [...kept.value].sort((one, other) => one.lastShown - other.lastShown);
    kept.value = kept.value.filter((page) => page !== oldest);
  }
  const page = found ?? openPage(next);
  if (!found) kept.value = [...kept.value, page];

  const wasTimedOut = transitionTimedOut.value;
  if (found && found.surfaceReady) {
    clearTransition();
  } else {
    const candidate = left && !left.dirty && left.surfaceReady ? left : (!wasTimedOut ? retainedPage.value : null);
    const alive = candidate && toRaw(candidate) !== toRaw(page)
      ? kept.value.find((entry) => toRaw(entry) === toRaw(candidate) && entry.surfaceReady) ?? null
      : null;
    retainedPage.value = alive;
    if (!page.surfaceReady) ensureTransitionTimer();
  }

  // A kept page shown again is checked again, and its current placement with it; a new page tells it once its panel is read.
  if (found) found.rechecking = true;
  page.pageSkill = currentResolution.value?.pageSkillContext ?? null;
  // Its bare address opens a kept page as it was left: the address takes the state the page is at.
  if (found && !opened.value.includes("?")) reportAddress({ kind: "state", address: found.reported });
  emit("context", page.context ?? { url: page.reported, label: pageName.value, selection: [] });
}, { immediate: true });

/*
 * The shown page sent to its bare address — its menu row clicked while it is open, or the address typed without a state —
 * opens it at its panel's defaults, as a native page goes back to its start: only a page shown again from another keeps
 * the state it was left at. Same-path dirty-form guarding runs in `useUnsavedChanges.guardSamePath` before navigation.
 */
watch([() => use.value?.id, opened], ([id, next], [previousId, previous]) => {
  const page = shownPage.value;
  if (!id || id !== previousId || next === previous || next.includes("?") || !page) return;
  page.reported = pageAddress.value;
});

// Leaving the shown page (or changing its query/bare address when a dirty form is affected) asks the platform's
// question first. Beside a conversation the display controller asks instead, from the page's dirty report.
if (!props.navigate)
  useUnsavedChanges({
    dirty: () => shownPage.value?.dirty ?? false,
    paths: () => (use.value ? [panelUsePath(use.value.path)] : []),
    guardSamePath: (fullPath) => host.value?.guardNavigation({ address: fullPath }) ?? Promise.resolve(true),
  });

/** When a kept page shown again may ask for its objects again: the first of the two points its switch is measured at. */
function markReopened(page: KeptPage) {
  performance.mark("ontomato:panel-page-reopened", { detail: { applicationId: props.applicationId, useId: page.use.id } });
  // Its checks are through: the placement they confirmed is what a message beside it carries now.
  page.rechecking = false;
  if (page.pageSkill !== undefined) passSkill(page.pageSkill);
  if (page === shownPage.value) reportLoad(page, page.load);
}

/** A new instance for a page of this application. */
function openPage(use: ApplicationPanelUse): KeptPage {
  const page: KeptPage = {
    use,
    port: undefined!,
    controller: null,
    load: { status: "loading" },
    reported: pageAddress.value,
    context: null,
    dirty: false,
    pageSkill: undefined,
    rechecking: false,
    surfaceReady: true,
    lastShown: ++showings,
  };
  const onPanelLoaded = props.applicationId === "home" && use.id === "home"
    ? (loaded: ProductPanel, projections?: Readonly<Record<string, BundledPanelProjection>>) => {
        if (customHomePanel.value?.id === loaded.id) {
          customHomeHasInlineComposer.value = panelHasInlineConversationEntry(loaded, projections);
        }
      }
    : undefined;
  const initialContent = currentResolution.value?.content?.panel.id === use.panelId
    ? currentResolution.value.content
    : null;
  page.port = markRaw(platformPanelHost(
    props.applicationId, use, changed, undefined,
    // Beside a conversation, an address the panel opens goes to the conversation's display; at full page, the router.
    props.navigate,
    pageCounter,
    () => {
      embeddedChatCounts[use.id] = (embeddedChatCounts[use.id] ?? 0) + 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = (embeddedChatCounts[use.id] ?? 0) - 1;
        if (next <= 0) delete embeddedChatCounts[use.id];
        else embeddedChatCounts[use.id] = next;
      };
    },
    onPanelLoaded,
    () => shownPage.value?.use.id === use.id ? embeddedDisplay : null,
    feed,
    initialContent,
  ));
  return page;
}

function reportSurfaceReady(page: KeptPage, ready: boolean) {
  page.surfaceReady = ready;
  if (!shownPage.value || toRaw(page) !== toRaw(shownPage.value)) return;
  if (ready) clearTransition();
  else ensureTransitionTimer();
}

/** A kept page shown again whose use relation was withdrawn or bound elsewhere ends; the page opens from the current relations. */
function withdraw(page: KeptPage) {
  kept.value = kept.value.filter((other) => other !== page);
  if (retainedPage.value && toRaw(retainedPage.value) === toRaw(page)) clearTransition();
  const path = entryPath.value;
  if (path) void requestEntryResolution(props.applicationId, path, { blocking: true });
}

/**
 * The address and state each instance is given: the shown page follows the address the reader opened, unless that is its
 * bare address, which shows it as it was left; a kept page keeps its own, so nothing about another page reaches it.
 */
function addressOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? pageAddress.value : page.reported;
}
function stateOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? requestedState.value : panelAddressState(page.reported);
}

const frameLiveStatePatch = computed(() => {
  const update = outerFrame?.liveState?.value;
  return update && update.instance === entryPath.value ? update.patch : null;
});
const liveStatePatch = computed(() =>
  props.liveState && props.liveState.instance === openedPath.value ? props.liveState.patch : null,
);

function setPageHost(page: KeptPage, controller: ShownInstance | null) {
  page.controller = controller;
  if (page === shownPage.value) host.value = controller;
}

function reportLoad(page: KeptPage, load: DisplayLoad) {
  page.load = load;
  if (page !== shownPage.value) return;
  if (load.status === "ready" && !page.rechecking && page.pageSkill !== undefined && shownSkill.value !== page.pageSkill)
    passSkill(page.pageSkill);
  emit("display-loaded", load);
}

function reportContext(page: KeptPage, context: PageContext) {
  page.context = { ...context, label: pageName.value || context.label };
  if (page === shownPage.value) emit("context", page.context);
}

function reportDirty(page: KeptPage, dirty: boolean) {
  page.dirty = dirty;
  if (page === shownPage.value) emit("display-dirty", dirty);
}
</script>

<template>
  <div ref="area" class="panel-application-area">
    <EntryResolutionFailure v-if="failure" :failure="{ message: failure, retry: retryEntryResolution }" />
    <div v-else-if="homeUnavailableBanner" class="panel-application-home-recovery platform-page-gutter" role="alert" data-testid="custom-home-unavailable">
      <p class="panel-application-home-recovery-text">{{ homePanelError || t("home.customHomeUnavailable") }}</p>
      <ElButton
        type="primary"
        size="small"
        :loading="restoringDefaultHome"
        data-testid="restore-default-home-btn"
        @click="restoreDefaultHomeWorkspace"
      >
        {{ t("home.restoreDefaultWorkspace") }}
      </ElButton>
    </div>
    <p v-else-if="missing" class="panel-application-status platform-page-gutter" role="alert">{{ missing }}</p>
    <EntryUnit v-if="!failure && !homeUnavailableBanner">
      <PanelHost
        v-for="page in kept"
        v-show="page === displayedPage"
        :key="`${page.use.id}:${page.use.panelId}`"
        :ref="(instance) => setPageHost(page, instance as ShownInstance | null)"
        :class="{ 'panel-host-page': !props.navigate, 'panel-host-beside': Boolean(props.navigate) }"
        :port="page.port"
        :entry-name="localizedApplicationText(page.use.names, locale)!"
        :labels="labels"
        :language="language"
        :shown="page === shownPage"
        :wired="Object.keys(page.use.inputs ?? {})"
        :address="addressOf(page)"
        :initial="stateOf(page)"
        :entry-inputs="entryInputs(page.use)"
        :live-state="page === shownPage ? (liveStatePatch ?? frameLiveStatePatch) : null"
        :frame-state="frameState"
        :history-back="!props.navigate"
        :beside="Boolean(props.navigate)"
        @display-address="(input: DisplayPageAddressInput) => page === shownPage && reportAddress(input)"
        @display-loaded="(load: DisplayLoad) => reportLoad(page, load)"
        @display-dirty="(dirty: boolean) => reportDirty(page, dirty)"
        @context="(context: PageContext) => reportContext(page, context)"
        @surface-ready="(ready: boolean) => reportSurfaceReady(page, ready)"
        @reopened="markReopened(page)"
        @withdrawn="withdraw(page)"
      >
        <template v-if="isHomeMainEntry" #personal-state-error="{ message, retry }">
          <PlatformPageHeader :title="pageName" />
          <section class="panel-application-status platform-page-gutter">
            <h2>{{ t("home.personalLayoutReadFailed") }}</h2>
            <DataState :result="{ status: 'error', message, retry }" :labels="dataStateLabels" />
          </section>
        </template>
      </PanelHost>
      <div
        v-if="showContentLoading"
        class="panel-application-loading"
        role="status"
        aria-busy="true"
        :aria-label="t('common.loading')"
        data-panel-loading-placeholder
      >
        <div class="panel-application-loading-inner">
          <ElSkeleton :rows="4" animated />
          <span class="panel-application-loading-text">{{ t("common.loading") }}</span>
        </div>
      </div>
      <!-- Offered once the panel's read named the page's skill: the agents are the ones that skill reaches. -->
      <template v-if="!props.navigate && (use?.pageComposer ?? shownPage?.use.pageComposer) !== 'none' && !frameConversation && !outerFrame?.ownsComposer?.value && !(shownPage && embeddedChatCounts[shownPage.use.id]) && ((shownPage && shownSkill) || composerProblem)" #foot>
        <PageComposer
          v-if="shownPage && shownSkill"
          :page="shownPage.reported"
          :labels="composerLabels"
          :page-skill="shownSkill"
          @error="composerProblem = $event"
        />
        <p v-if="composerProblem" class="page-composer-error" role="alert">{{ composerProblem }}</p>
      </template>
    </EntryUnit>
  </div>
</template>

<style scoped>
/* Fills the layout body or side pane as a definite-height flex column; carries the application theme beside a conversation. */
.panel-application-area {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
}
/* Single-entry application bar headers belong to full-page routes; beside a conversation the side pane draws its own title bar. */
.panel-host-beside :deep(.sdk-page-header.bar) {
  display: none;
}
.panel-application-status {
  flex-shrink: 0;
  margin: 0;
  padding-block: var(--page-content-gap);
}
.panel-application-home-recovery {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md, 12px);
  margin: var(--page-content-gap, 16px) var(--page-gutter, 20px);
  padding: var(--spacing-md, 16px) var(--spacing-lg, 20px);
  border: 1px solid var(--el-color-warning-light-5, var(--el-border-color));
  border-radius: var(--radius-md, 8px);
  background: var(--el-color-warning-light-9, var(--el-fill-color-light));
}
.panel-application-home-recovery-text {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm, 14px);
}
.panel-application-loading {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: var(--page-content-gap, 16px) var(--page-gutter, 20px);
  background: var(--el-bg-color);
  box-sizing: border-box;
}
.panel-application-loading-inner {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 12px);
  width: 100%;
  max-width: 960px;
}
.panel-application-loading-text {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
@media (prefers-reduced-motion: reduce) {
  .panel-application-loading :deep(.el-skeleton__item) {
    animation: none;
  }
}
/* The page's own configuration error, where its composer would be: the reader is told, not left guessing. */
.page-composer-error {
  pointer-events: auto;
  width: min(760px, 100%);
  margin: 0 auto var(--spacing-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
