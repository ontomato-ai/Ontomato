<script setup lang="ts">
import { computed, markRaw, ref, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, type AppMenuGroup, type DirectPanelRun, type PanelHostLabels, type PanelHostPort } from "@ontomato/platform-shell";
import type { ApplicationEntryMenu, ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DisplayLoad } from "@ontomato/contracts/agent-presentation";
import { builtinFramePanelHost, framePanelHost } from "./panel-host";
import { useApplicationCatalog } from "./catalog";

export interface NativeFrameSpec {
  applicationId: string;
  framePanelId: string;
  title: string;
  groups: readonly AppMenuGroup[];
  activePageId: string;
}

/**
 * Mounts a platform-shipped frame panel around a built-in native Vue route (such as System settings, Permissions, or
 * Ontology manager's remaining native pages) so every framed application draws its navigation through its frame panel
 * rather than the shell. Always wraps the page area without conditional re-parenting in Vue, so the slotted `<RouterView>`
 * mounts once even when the application catalog arrives after initial render, and moves into `<current-entry>` when the
 * frame attaches.
 */
const props = defineProps<{
  frame: NativeFrameSpec | null;
}>();

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
  draft: {
    opening: tr("platform.panelDraftOpening", "Opening draft"),
    close: tr("platform.panelDraftClose", "Close"),
    toAgent: tr("platform.panelDraftToAgent", "Ask agent"),
    toAgentText: tr("platform.panelDraftToAgentText", "{reason}", { reason: "{reason}" }),
  },
  refresh: tr("common.refresh", "Refresh"),
}));

const catalogApp = computed(() =>
  props.frame ? catalog.applications.value.find((app) => app.id === props.frame!.applicationId) ?? null : null,
);
const anchorUse = computed<ApplicationPanelUse | null>(() => catalogApp.value?.panelUses?.[0] ?? null);

let cached: { key: string; port: PanelHostPort } | null = null;
const portKey = computed(() =>
  props.frame ? `${props.frame.applicationId}:${props.frame.framePanelId}:${anchorUse.value?.id ?? "builtin"}` : "",
);
const port = computed<PanelHostPort | null>(() => {
  const frame = props.frame;
  if (!frame) return null;
  const key = portKey.value;
  if (cached?.key === key) return cached.port;
  const created = anchorUse.value
    ? framePanelHost(frame.applicationId, anchorUse.value, frame.framePanelId, () => {}, router)
    : builtinFramePanelHost(frame.applicationId, frame.framePanelId, router);
  cached = { key, port: markRaw(created) };
  return cached.port;
});

const frameFailed = ref(false);
watch(portKey, () => {
  frameFailed.value = false;
});

const holder = ref<HTMLElement | null>(null);
const slotRoot = ref<HTMLElement | null>(null);
const placed = ref(false);

function restoreSlot() {
  const el = slotRoot.value;
  if (el && holder.value && el.parentElement !== holder.value) {
    holder.value.appendChild(el);
  }
  placed.value = false;
}

watch(() => props.frame, (next) => {
  if (!next) restoreSlot();
});

const entryMenu = computed<ApplicationEntryMenu>(() => ({
  names: catalogApp.value?.names ?? (props.frame ? { en: props.frame.title } : undefined),
  groups: [],
  panelUses: catalogApp.value?.panelUses ?? [],
}));

const currentEntry: NonNullable<DirectPanelRun["currentEntry"]> = {
  entry: computed(() => ({
    applicationId: props.frame?.applicationId ?? "",
    useId: anchorUse.value?.id ?? props.frame?.applicationId ?? "",
    pageKey: props.frame?.activePageId ?? "",
    panelId: props.frame?.framePanelId ?? "",
    path: props.frame?.activePageId ?? "",
  })),
  menu: entryMenu,
  hostMenu: computed(() => props.frame?.groups ?? null),
  place(element) {
    const stop = watchEffect(() => {
      const el = slotRoot.value;
      if (el && props.frame && !frameFailed.value && el.parentElement !== element) {
        element.appendChild(el);
        placed.value = true;
      }
    });
    return {
      dispose() {
        stop();
        restoreSlot();
      },
    };
  },
};

function onLoaded(load: DisplayLoad) {
  if (load.status === "ready") {
    frameFailed.value = false;
  } else {
    frameFailed.value = true;
    restoreSlot();
  }
}
</script>

<template>
  <div class="native-frame-host">
    <PanelHost
      v-if="frame && port && !frameFailed"
      :key="portKey"
      class="native-frame-panel"
      :port="port"
      :address="frame.activePageId"
      :label="frame.title"
      :language="language"
      :labels="labels"
      :current-entry="currentEntry"
      @display-loaded="onLoaded"
    />
    <div ref="holder" class="native-frame-holder" :hidden="Boolean(frame) && placed && !frameFailed">
      <div ref="slotRoot" class="native-frame-slot">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.native-frame-host {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.native-frame-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.native-frame-holder {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.native-frame-holder[hidden] {
  display: none;
}
.native-frame-slot {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
</style>
