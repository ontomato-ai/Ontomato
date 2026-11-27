<script setup lang="ts">
import { computed, markRaw, provide, ref, shallowRef, watch, watchEffect, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElSkeleton } from "element-plus";
import {
  PanelHost,
  type AppMenuGroup,
  type DirectPanelRun,
  type PanelHostLabels,
  type PanelHostPort,
} from "@ontomato/platform-shell";
import {
  applicationPanelAddress,
  panelAddressState,
  panelUsePath,
  parseApplicationPanelAddress,
} from "@ontomato/contracts/panel-host";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import {
  isBuiltinProductId,
  isNativeApplicationEntry,
  type ApplicationEntryMenu,
  type ApplicationOpenResponse,
  type CurrentApplicationEntry,
  type ProductPanelResponse,
} from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import {
  builtinFramePanelHost,
  cachedApplicationFrameManifest,
  framePanelHost,
  type FrameChatOptions,
  type PanelObjectChange,
} from "./panel-host";
import { usePanelConversationDisplay } from "./panel-conversation-display";
import { usePanelSessionRuns } from "./panel-session-runs";
import { useApplicationCatalog } from "./catalog";
import {
  applicationFrameHostKey,
  frameAddressState,
  type FrameState,
  type PanelFrameRegistration,
} from "./application-frame-context";
import { routeEntryPath, routeOpenedEntry } from "./panel-entries";

export interface ApplicationFrameSpec {
  applicationId: string;
  framePanelId: string;
  title: string;
  groups: readonly AppMenuGroup[] | null;
  activePageId: string;
  singleEntry?: boolean;
}

/**
 * Single persistent owner of an application's outer frame panel.
 *
 * Wraps the layout's page area once so `<RouterView>` never re-parents in Vue when the catalog arrives, when
 * switching between native Vue routes and panel entries inside a hybrid application (such as Ontology Manager),
 * or when moving between entries of a panel application. The frame `<PanelHost>` is keyed strictly by
 * `${applicationId}:${framePanelId}`, so within the same framed application the frame stays mounted with zero
 * teardown/rebuild while `currentEntry` updates reactively.
 */
const props = withDefaults(defineProps<{
  frame?: ApplicationFrameSpec | null;
  openedEntry?: ApplicationOpenResponse | null;
  blocked?: boolean;
}>(), {
  frame: null,
  openedEntry: null,
  blocked: false,
});

const emit = defineEmits<{
  "opened-entry": [path: string, entry: ApplicationOpenResponse];
}>();

const route = useRoute();
const router = useRouter();
const catalog = useApplicationCatalog();
const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();

const tr = (key: string, fallback: string, params?: Record<string, unknown>) =>
  i18n && i18n.te(key) ? i18n.t(key, params ?? {}) : fallback;

const language = computed(() => ({
  locale: i18n?.locale.value ?? "en",
  fallback: String(i18n?.fallbackLocale.value ?? "en"),
}));

const labels = computed<PanelHostLabels>(() => ({
  notStarted: tr("platform.panelNotStarted", "Panel has not started"),
  failures: {
    fileUnavailable: tr("platform.panelFileUnavailable", "Could not load {file}", { file: "{file}" }),
    scriptThrew: tr("platform.panelScriptThrew", "Panel script threw an error"),
    scriptRejected: tr("platform.panelScriptRejected", "Panel script failed"),
  },
  content: { styleOutside: tr("platform.panelStyleOutside", "Style outside") },
  refresh: tr("common.refresh", "Refresh"),
}));

type FrameHostInstance = {
  refresh(
    target: PanelObjectChange["target"],
    affected?: PanelObjectChange["affected"],
    operation?: PanelObjectChange["operation"],
  ): void;
};
const frameHost = ref<FrameHostInstance | null>(null);

/** Registration supplied by the currently mounted full-page `PanelApplicationRoute`, if any. */
const panelEntryRef = shallowRef<ComputedRef<PanelFrameRegistration | null> | null>(null);

const matchingPanelEntry = computed<PanelFrameRegistration | null>(() => {
  const entry = panelEntryRef.value?.value ?? null;
  if (!entry) return null;
  if (props.frame && entry.applicationId !== props.frame.applicationId) return null;
  return entry;
});

interface EffectiveFrame {
  applicationId: string;
  framePanelId: string;
  title: string;
  hostGroups: readonly AppMenuGroup[] | null;
  activePageId: string;
  singleEntry?: boolean;
}

const routeOpened = computed<ApplicationOpenResponse | null>(() =>
  props.openedEntry ?? routeOpenedEntry(route, routeEntryPath(route)),
);

const effectiveFrame = computed<EffectiveFrame | null>(() => {
  if (props.blocked) return null;
  const hostFrame = props.frame;
  const panel = matchingPanelEntry.value;

  if (hostFrame) {
    // Once a full-page panel route settles its backend entry resolution, honor its authoritative framePanelId.
    const framePanelId = panel?.resolved ? panel.framePanelId : (panel?.framePanelId ?? hostFrame.framePanelId);
    if (!framePanelId) return null;
    return {
      applicationId: hostFrame.applicationId,
      framePanelId,
      title: hostFrame.title,
      hostGroups: hostFrame.groups,
      activePageId: hostFrame.activePageId,
      ...(hostFrame.singleEntry !== undefined ? { singleEntry: hostFrame.singleEntry } : {}),
    };
  }

  if (panel?.framePanelId) {
    const app = catalog.applicationById(panel.applicationId);
    const title = localizedApplicationText(panel.menu?.names ?? app?.names, language.value.locale)
      ?? panel.applicationId;
    const singleEntry = panel.menu?.singleEntry ?? app?.singleEntry;
    return {
      applicationId: panel.applicationId,
      framePanelId: panel.framePanelId,
      title,
      hostGroups: null,
      activePageId: routeEntryPath(route),
      ...(singleEntry !== undefined ? { singleEntry } : {}),
    };
  }

  const opened = !panel?.resolved ? routeOpened.value : null;
  if (opened?.framePanelId) {
    const app = catalog.applicationById(opened.applicationId);
    const title = localizedApplicationText(opened.menu.names ?? app?.names, language.value.locale)
      ?? opened.applicationId;
    const singleEntry = opened.menu.singleEntry ?? app?.singleEntry;
    return {
      applicationId: opened.applicationId,
      framePanelId: opened.framePanelId,
      title,
      hostGroups: null,
      activePageId: routeEntryPath(route),
      ...(singleEntry !== undefined ? { singleEntry } : {}),
    };
  }

  return null;
});

const frameKey = computed(() =>
  effectiveFrame.value ? `${effectiveFrame.value.applicationId}:${effectiveFrame.value.framePanelId}` : "",
);

const catalogApp = computed(() =>
  effectiveFrame.value
    ? catalog.applicationById(effectiveFrame.value.applicationId)
    : null,
);

const matchingOpenedEntry = computed<ApplicationOpenResponse | null>(() => {
  const applicationId = effectiveFrame.value?.applicationId;
  if (!applicationId) return null;
  const panelOpened = matchingPanelEntry.value?.openedEntry;
  if (panelOpened?.applicationId === applicationId) return panelOpened;
  const opened = routeOpened.value;
  return opened?.applicationId === applicationId ? opened : null;
});

watch(
  () => effectiveFrame.value?.applicationId ?? null,
  (applicationId) => {
    if (!applicationId || matchingPanelEntry.value || matchingOpenedEntry.value) return;
    const app = catalog.applicationById(applicationId);
    if (app && app.panelUses === undefined) {
      void catalog.ensureApplication(applicationId).catch(error => console.error(error));
    }
  },
  { immediate: true },
);

type EntryUse = Exclude<ApplicationOpenResponse["use"], { kind: "native" }>;
const anchorUse = computed<EntryUse | null>(() => {
  const panelUse = catalogApp.value?.panelUses?.find(
    (entry): entry is EntryUse => !isNativeApplicationEntry(entry),
  );
  const matching = matchingPanelEntry.value?.use;
  const opened = matchingOpenedEntry.value;
  const openedUse = opened && !isNativeApplicationEntry(opened.use)
    ? opened.use
    : opened?.menu.panelUses.find((entry): entry is EntryUse => !isNativeApplicationEntry(entry)) ?? null;
  return panelUse
    ?? (matching && !isNativeApplicationEntry(matching) ? matching : null)
    ?? openedUse;
});

/**
 * Whether the application is known to have registered panel entries or known to be native-only. Until one of those
 * answers arrives, the frame has no safe port to choose: a native port guessed early would keep the same cache key after
 * the registered entry appears.
 */
const frameEntryDecisionResolved = computed(() => {
  if (anchorUse.value) return true;
  const panel = matchingPanelEntry.value;
  if (panel && !panel.resolved) return false;
  if (catalogApp.value?.panelUses !== undefined) return true;
  if (panel?.resolved) return true;
  return matchingOpenedEntry.value !== null;
});

function refreshFrame(change: PanelObjectChange) {
  frameHost.value?.refresh(change.target, change.affected, change.operation);
}

function handleFrameObjectChange(change: PanelObjectChange) {
  frameHost.value?.refresh(change.target, change.affected, change.operation);
  matchingPanelEntry.value?.onObjectChange(change);
}

const feed = usePanelSessionRuns(
  () => !props.blocked && Boolean(matchingPanelEntry.value || effectiveFrame.value),
  handleFrameObjectChange,
);
const display = usePanelConversationDisplay({
  router,
  address: () => effectiveFrame.value ? route.fullPath : null,
  contains(path) {
    const frame = effectiveFrame.value;
    if (!frame) return false;
    return path === route.path
      || entryMenu.value.panelUses.some(entry => panelUsePath(entry.path) === path)
      || Boolean(frame.hostGroups?.some(group => group.items.some(item => item.id === path)));
  },
  panel: () => matchingPanelEntry.value?.panel ?? null,
  refresh: handleFrameObjectChange,
});
const frameComposer = ref<{ key: string; declared: boolean } | null>(null);
const composerClaims = ref(0);

let pendingOpen: { applicationId: string; promise: Promise<ApplicationOpenResponse | null> } | null = null;

async function readInitialFrame(
  applicationId: string,
  framePanelId: string,
): Promise<ProductPanelResponse | null> {
  const match = (entry: ApplicationOpenResponse | null | undefined) =>
    entry?.applicationId === applicationId && entry.frame?.panel.id === framePanelId
      ? entry.frame
      : null;

  const immediate = match(matchingPanelEntry.value?.openedEntry) ?? match(routeOpened.value);
  if (immediate) return immediate;

  // Yield one microtask so a child PanelApplicationRoute mounted in the same flush registers its in-flight opening.
  await Promise.resolve();

  const afterFlush = match(matchingPanelEntry.value?.openedEntry) ?? match(routeOpened.value);
  if (afterFlush) return afterFlush;

  const pending = pendingOpen;
  if (pending && pending.applicationId === applicationId) {
    const settled = await pending.promise;
    return match(settled);
  }

  return null;
}

let cachedPort: { key: string; port: PanelHostPort } | null = null;
const port = computed<PanelHostPort | null>(() => {
  const frame = effectiveFrame.value;
  const key = frameKey.value;
  if (!frame || !key) return null;
  if (cachedPort?.key === key) return cachedPort.port;
  const chat: FrameChatOptions = {
    display: () => display,
    claimComposer() {
      composerClaims.value++;
      return () => { composerClaims.value--; };
    },
    feed,
    onPanelLoaded: declared => { frameComposer.value = { key, declared }; },
  };
  const initialFrame = () => readInitialFrame(frame.applicationId, frame.framePanelId);
  const use = anchorUse.value;
  if (use) {
    const created = framePanelHost(frame.applicationId, use, frame.framePanelId, handleFrameObjectChange, router, chat, initialFrame);
    cachedPort = { key, port: markRaw(created) };
    return cachedPort.port;
  }
  if (!frameEntryDecisionResolved.value) return null;
  if (frame.hostGroups?.length || isBuiltinProductId(frame.framePanelId)) {
    const created = builtinFramePanelHost(frame.applicationId, frame.framePanelId, frame.title, router, chat, initialFrame);
    cachedPort = { key, port: markRaw(created) };
    return cachedPort.port;
  }
  return null;
});

const frameFailed = ref(false);
/** True by default for synchronous mock hosts in tests; real PanelHost emits false synchronously on mount until ready. */
const frameSurfaceReady = ref(true);

const lastFrame = ref<{
  key: string;
  framePanelId: string;
  liveState: FrameState;
} | null>(null);
const frameManifest = shallowRef<{
  key: string;
  framePanelId: string;
  manifest: Pick<PanelManifest, "state">;
} | null>(null);

const holder = ref<HTMLElement | null>(null);
const slotRoot = ref<HTMLElement | null>(null);

function restoreSlot() {
  const el = slotRoot.value;
  if (el && holder.value && el.parentElement !== holder.value) {
    holder.value.appendChild(el);
  }
}

watch(frameKey, (nextKey, prevKey) => {
  if (cachedPort && cachedPort.key !== nextKey) cachedPort = null;
  frameFailed.value = false;
  frameSurfaceReady.value = true;
  lastFrame.value = null;
  frameManifest.value = null;
  if (nextKey !== prevKey) restoreSlot();
}, { flush: "sync" });

const activeFrameManifest = computed(() => {
  if (!frameKey.value) return undefined;
  if (frameManifest.value?.key === frameKey.value) return frameManifest.value.manifest;
  const frame = matchingOpenedEntry.value?.frame;
  if (frame && frame.panel.id === effectiveFrame.value?.framePanelId) return frame.panel.manifest;
  return undefined;
});

const frameState = computed((): FrameState => {
  if (!effectiveFrame.value) return {};
  const parsed = frameAddressState(route.fullPath, activeFrameManifest.value);
  const named = parsed.named;
  const hasSegment = parsed.hasSegment;
  const defaults = parsed.defaults;
  const live = hasSegment && lastFrame.value?.key === frameKey.value ? lastFrame.value.liveState : undefined;
  const base = live ? { ...defaults, ...live } : defaults;
  if (hasSegment) return { ...base, ...named };
  return Object.keys(base).length ? base : named;
});

const frameAddress = computed(() => route.path);

function reportFrameState(state: FrameState) {
  const frame = effectiveFrame.value;
  const key = frameKey.value;
  if (!frame || !key) return;
  if (frameManifest.value?.key !== key) {
    const cached = cachedApplicationFrameManifest(frame.applicationId, frame.framePanelId);
    if (cached) frameManifest.value = { key, framePanelId: frame.framePanelId, manifest: cached };
  }
  lastFrame.value = { key, framePanelId: frame.framePanelId, liveState: state };
}

function reportFrameAddress(input: DisplayPageAddressInput) {
  const reported = panelAddressState(input.address) as FrameState;
  const frame = effectiveFrame.value;
  const key = frameKey.value;
  if (frame && key) {
    if (frameManifest.value?.key !== key) {
      const cached = cachedApplicationFrameManifest(frame.applicationId, frame.framePanelId);
      if (cached) frameManifest.value = { key, framePanelId: frame.framePanelId, manifest: cached };
    }
    const prev = lastFrame.value?.key === key ? lastFrame.value : null;
    lastFrame.value = { key, framePanelId: frame.framePanelId, liveState: prev?.liveState ?? reported };
  }
  const { path, state, query } = parseApplicationPanelAddress(route.fullPath);
  const next = applicationPanelAddress(path, { frame: reported, state, query });
  if (next !== route.fullPath) void router.replace(next);
}

const entryMenu = computed<ApplicationEntryMenu>(() => {
  if (matchingPanelEntry.value?.menu) return matchingPanelEntry.value.menu;
  if (matchingOpenedEntry.value?.menu) return matchingOpenedEntry.value.menu;
  const app = catalogApp.value;
  const frame = effectiveFrame.value;
  const panelUses = app?.panelUses?.filter(use => use.inMenu !== false) ?? [];
  const menuCount = frame?.hostGroups && frame.hostGroups.length > 0
    ? frame.hostGroups.reduce((total, group) => total + group.items.length, 0)
    : panelUses.length;
  const singleEntry = app?.singleEntry ?? frame?.singleEntry ?? (menuCount <= 1);
  return {
    names: app?.names ?? (frame ? { en: frame.title } : undefined),
    singleEntry,
    groups: app?.groups ?? [],
    panelUses,
  };
});

const currentEntryValue = computed<CurrentApplicationEntry>(() => {
  const panel = matchingPanelEntry.value;
  if (panel?.currentEntry) return panel.currentEntry;
  const frame = effectiveFrame.value;
  if (panel?.use) {
    return {
      applicationId: panel.applicationId,
      useId: panel.use.id,
      pageKey: panel.use.pageKey,
      ...("panelId" in panel.use ? { panelId: panel.use.panelId, kind: "panel" } : { kind: panel.use.kind }),
      path: frame?.activePageId ?? route.path,
    };
  }
  const opened = matchingOpenedEntry.value;
  if (opened) {
    return {
      applicationId: opened.applicationId,
      useId: opened.use.id,
      pageKey: opened.use.pageKey,
      ...("panelId" in opened.use ? { panelId: opened.use.panelId, kind: "panel" } : { kind: opened.use.kind }),
      path: frame?.activePageId ?? route.path,
    };
  }
  return {
    applicationId: frame?.applicationId ?? "",
    useId: anchorUse.value?.id ?? frame?.applicationId ?? "",
    pageKey: frame?.activePageId ?? "",
    panelId: frame?.framePanelId ?? "",
    path: frame?.activePageId ?? route.path,
  };
});

const currentEntry: NonNullable<DirectPanelRun["currentEntry"]> = {
  entry: currentEntryValue,
  menu: entryMenu,
  hostMenu: computed(() => effectiveFrame.value?.hostGroups ?? null),
  place(element) {
    const placedKey = frameKey.value;
    const stop = watchEffect(() => {
      const el = slotRoot.value;
      if (el && frameKey.value === placedKey && !frameFailed.value && el.parentElement !== element) {
        element.appendChild(el);
      }
    });
    return {
      dispose() {
        stop();
        const el = slotRoot.value;
        if (el && holder.value && el.parentElement === element) {
          holder.value.appendChild(el);
        }
      },
    };
  },
};

function onLoaded(load: DisplayLoad) {
  if (load.status === "ready") {
    frameFailed.value = false;
  } else if (load.status === "error") {
    frameFailed.value = true;
    restoreSlot();
  }
}

const frameActive = computed(() => Boolean(effectiveFrame.value && !frameFailed.value));
const frameReady = computed(() => Boolean(port.value && frameSurfaceReady.value));
const showFrameLoading = computed(() =>
  frameActive.value && !frameReady.value && !matchingPanelEntry.value?.missing,
);

provide(applicationFrameHostKey, {
  frameState,
  active: frameActive,
  surfaceReady: frameReady,
  liveState: display.liveState,
  ownsComposer: computed(() => composerClaims.value > 0 || (
    frameComposer.value?.key === frameKey.value && frameComposer.value.declared
  )),
  feed,
  refreshFrame,
  registerPanelEntry(registration) {
    panelEntryRef.value = registration;
    return () => {
      if (panelEntryRef.value === registration) panelEntryRef.value = null;
    };
  },
  beginOpen(applicationId, promise) {
    const record = { applicationId, promise };
    pendingOpen = record;
    return () => {
      if (pendingOpen === record) pendingOpen = null;
    };
  },
  reportOpenedEntry(path, entry) {
    emit("opened-entry", path, entry);
  },
});
</script>

<template>
  <div class="application-frame-host">
    <PanelHost
      v-if="effectiveFrame && port && !frameFailed"
      v-show="frameSurfaceReady"
      ref="frameHost"
      :key="frameKey"
      class="application-frame-panel panel-application-frame"
      :port="port"
      :address="frameAddress"
      :initial="frameState"
      :label="effectiveFrame.title"
      :language="language"
      :labels="labels"
      :current-entry="currentEntry"
      :history-back="false"
      @display-address="reportFrameAddress"
      @display-state="reportFrameState"
      @display-loaded="onLoaded"
      @surface-ready="frameSurfaceReady = $event"
    />
    <div
      v-if="showFrameLoading"
      class="application-frame-loading"
      role="status"
      aria-busy="true"
      :aria-label="tr('common.loading', 'Loading...')"
      data-panel-loading-placeholder
    >
      <div class="application-frame-loading-inner">
        <ElSkeleton :rows="4" animated />
        <span class="application-frame-loading-text">{{ tr("common.loading", "Loading...") }}</span>
      </div>
    </div>
    <div ref="holder" class="application-frame-holder" :hidden="frameActive && (frameReady || !matchingPanelEntry?.missing)">
      <div ref="slotRoot" class="application-frame-slot">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.application-frame-host {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.application-frame-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.application-frame-loading {
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
.application-frame-loading-inner {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 12px);
  width: 100%;
  max-width: 960px;
}
.application-frame-loading-text {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
@media (prefers-reduced-motion: reduce) {
  .application-frame-loading :deep(.el-skeleton__item) {
    animation: none;
  }
}
.application-frame-holder {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.application-frame-holder[hidden] {
  display: none;
}
.application-frame-slot {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
</style>
