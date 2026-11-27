<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { panelContextKey } from "../panel/context";
import { panelMemberKey, useMemberOutput } from "../panel/member";
import {
  usePanelPreviewHost,
  type AppPreviewContext,
  type AppPreviewSelectionItem,
  type AppPreviewStatus,
  type AppPreviewStatusPayload,
  type PanelPreviewMountHandle,
} from "./panel-preview";

/**
 * Official application preview component:
 * renders a candidate panel application (in preview execution), a live panel application definition, or a legacy
 * hosted preview through the platform's injected `PanelPreviewHost` without exposing preview tokens, execution-context
 * headers, credentials, or raw iframe URLs to panel scripts.
 *
 * Strictly renders the preview surface and reports navigation/selection context and status; business test data
 * status bars and restart actions belong to the hosting panel via standard owner reads and operations.
 */
const props = withDefaults(
  defineProps<{
    /** Target application or builder project identifier; when omitted or empty, renders the empty state. */
    appId?: string | null;
    /** Preview revision: `"working"` for uncommitted files or a commit SHA. */
    revision?: string;
    /** Optional entry identifier for multi-entry panel applications. */
    entryId?: string | null;
    /** Opaque key incremented or changed by the hosting panel to force a clean preview reload. */
    reloadKey?: number | string;
  }>(),
  {
    appId: null,
    revision: "working",
    entryId: null,
    reloadKey: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the previewed application navigates to a different page or changes its selection. */
  contextChange: [context: AppPreviewContext];
  /** Emitted whenever the preview lifecycle status changes. */
  statusChange: [payload: AppPreviewStatusPayload];
}>();

const { t } = useI18n();
const previewHost = usePanelPreviewHost();

const stageRef = ref<HTMLElement | null>(null);
const status = ref<AppPreviewStatus>("empty");
const statusMessage = ref<string>("");
const activePage = ref<string | null>(null);
const selection = shallowRef<readonly AppPreviewSelectionItem[]>([]);
const retryTick = ref(0);

let activeHandle: PanelPreviewMountHandle | null = null;
let activeController: AbortController | null = null;
let loadSeq = 0;
let isMounted = false;

function selectionEqual(a: readonly AppPreviewSelectionItem[], b: readonly AppPreviewSelectionItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.objectType !== right.objectType || left.primaryKey !== right.primaryKey || left.label !== right.label) {
      return false;
    }
  }
  return true;
}

function updateContext(next: AppPreviewContext, forceEmit = false) {
  const normalizedPage = next.page ?? null;
  const normalizedSelection = next.selection.map((item) => ({
    objectType: item.objectType,
    primaryKey: item.primaryKey,
    ...(item.label !== undefined ? { label: item.label } : {}),
  }));
  const changed = normalizedPage !== activePage.value || !selectionEqual(selection.value, normalizedSelection);
  activePage.value = normalizedPage;
  selection.value = normalizedSelection;
  if (changed || forceEmit) {
    emit("contextChange", {
      page: activePage.value,
      selection: selection.value,
    });
  }
}

function setStatus(next: AppPreviewStatus, message?: string) {
  status.value = next;
  statusMessage.value = message ?? "";
  emit("statusChange", message !== undefined && message !== "" ? { status: next, message } : { status: next });
}

function disposeActiveMount() {
  activeController?.abort();
  activeController = null;
  if (activeHandle) {
    try {
      activeHandle.dispose();
    } finally {
      activeHandle = null;
    }
  }
  stageRef.value?.replaceChildren();
}

function formatLegacySdkMessage(outcome: {
  message?: string;
  requiredVersion?: string;
  foundVersions?: readonly string[];
}): string {
  if (outcome.message) return outcome.message;
  if (outcome.requiredVersion) {
    if (outcome.foundVersions && outcome.foundVersions.length > 0) {
      return t("platform.appPreview.legacySdkUpgrade", {
        found: outcome.foundVersions.join(", "),
        required: outcome.requiredVersion,
      });
    }
    return t("platform.appPreview.legacySdkNoReference", { required: outcome.requiredVersion });
  }
  return t("platform.appPreview.legacySdkHint");
}

async function loadPreview() {
  if (!isMounted) return;
  const seq = ++loadSeq;
  disposeActiveMount();

  const normalizedAppId = props.appId?.trim() || null;
  const normalizedRevision = props.revision?.trim() || "working";
  const normalizedEntryId = props.entryId?.trim() || null;

  if (!normalizedAppId) {
    updateContext({ page: null, selection: [] });
    setStatus("empty");
    return;
  }

  if (!previewHost) {
    updateContext({ page: null, selection: [] });
    setStatus("error", t("platform.appPreview.hostUnavailable"));
    return;
  }

  const container = stageRef.value;
  if (!container) return;

  updateContext({ page: null, selection: [] });
  setStatus("loading");

  const controller = new AbortController();
  activeController = controller;
  let statusOverriddenByHost = false;

  try {
    const outcome = await previewHost.mount(
      {
        appId: normalizedAppId,
        revision: normalizedRevision,
        entryId: normalizedEntryId,
        container,
        onContextChange(context) {
          if (seq !== loadSeq || controller.signal.aborted) return;
          updateContext(context);
        },
        onStatusChange(payload) {
          if (seq !== loadSeq || controller.signal.aborted) return;
          if (payload.status === "error" || payload.status === "legacy-sdk" || payload.status === "empty") {
            statusOverriddenByHost = true;
            if (activeHandle) {
              try {
                activeHandle.dispose();
              } finally {
                activeHandle = null;
              }
            }
            stageRef.value?.replaceChildren();
          }
          setStatus(payload.status, payload.message);
        },
      },
      controller.signal,
    );

    if (seq !== loadSeq || controller.signal.aborted || statusOverriddenByHost) {
      if (outcome.kind === "panel" || outcome.kind === "hosted") {
        outcome.handle.dispose();
      }
      return;
    }

    if (outcome.kind === "panel" || outcome.kind === "hosted") {
      activeHandle = outcome.handle;
      if (outcome.page !== undefined) {
        updateContext({ page: outcome.page, selection: selection.value });
      }
      setStatus("ready");
      return;
    }

    stageRef.value?.replaceChildren();
    if (outcome.kind === "empty") {
      setStatus("empty", outcome.message);
      return;
    }
    if (outcome.kind === "legacy-sdk") {
      setStatus("legacy-sdk", formatLegacySdkMessage(outcome));
      return;
    }
    setStatus("error", outcome.message);
  } catch (reason: unknown) {
    if (seq !== loadSeq || controller.signal.aborted) return;
    stageRef.value?.replaceChildren();
    const message = reason instanceof Error ? reason.message : String(reason);
    setStatus("error", message);
  }
}

function reload() {
  retryTick.value += 1;
}

onMounted(() => {
  isMounted = true;
  void loadPreview();
});

watch(
  () => [props.appId, props.revision, props.entryId, props.reloadKey, retryTick.value] as const,
  () => {
    if (isMounted) void loadPreview();
  },
);

onBeforeUnmount(() => {
  isMounted = false;
  loadSeq += 1;
  disposeActiveMount();
});

if (inject(panelMemberKey, null) && inject(panelContextKey, null)) {
  useMemberOutput("status", () => status.value);
  useMemberOutput("activePage", () => activePage.value);
  useMemberOutput("selection", () =>
    selection.value.map((item) => ({
      objectType: item.objectType,
      primaryKey: item.primaryKey,
      ...(item.label !== undefined ? { label: item.label } : {}),
    })),
  );
}

defineExpose({ reload });
</script>

<template>
  <section class="sdk-app-preview" :data-preview-status="status">
    <div v-if="status === 'empty'" class="sdk-app-preview-state" role="status">
      <p class="sdk-app-preview-title">{{ t("platform.appPreview.empty") }}</p>
      <p class="sdk-app-preview-message">{{ statusMessage || t("platform.appPreview.emptyHint") }}</p>
    </div>

    <div v-else-if="status === 'loading'" class="sdk-app-preview-state" role="status" aria-busy="true">
      <span class="sdk-app-preview-spinner" aria-hidden="true" />
      <p class="sdk-app-preview-message">{{ t("platform.appPreview.loading") }}</p>
    </div>

    <div v-else-if="status === 'legacy-sdk'" class="sdk-app-preview-state" role="status">
      <div class="sdk-app-preview-card sdk-app-preview-card--warning">
        <p class="sdk-app-preview-title">{{ t("platform.appPreview.legacySdkTitle") }}</p>
        <p class="sdk-app-preview-message">{{ statusMessage || t("platform.appPreview.legacySdkHint") }}</p>
        <button type="button" class="sdk-app-preview-btn" @click="reload">
          {{ t("platform.appPreview.retry") }}
        </button>
      </div>
    </div>

    <div v-else-if="status === 'error'" class="sdk-app-preview-state" role="alert">
      <div class="sdk-app-preview-card sdk-app-preview-card--error">
        <p class="sdk-app-preview-title">{{ t("platform.appPreview.errorTitle") }}</p>
        <p class="sdk-app-preview-message">{{ statusMessage }}</p>
        <button type="button" class="sdk-app-preview-btn" @click="reload">
          {{ t("platform.appPreview.retry") }}
        </button>
      </div>
    </div>

    <div v-show="status === 'ready'" ref="stageRef" class="sdk-app-preview-stage" />
  </section>
</template>

<style scoped>
.sdk-app-preview {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
  background: var(--sdk-bg-color, var(--el-bg-color, #ffffff));
  color: var(--sdk-text-primary, var(--el-text-color-primary, #1f2329));
  overflow: hidden;
}

.sdk-app-preview-stage {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}

.sdk-app-preview-state {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding: 24px 16px;
  text-align: center;
  color: var(--sdk-text-secondary, var(--el-text-color-secondary, #646a73));
  font-size: var(--text-sm, 13px);
}

.sdk-app-preview-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 440px;
  width: 100%;
  padding: 20px 24px;
  border-radius: var(--el-border-radius-base, 8px);
  border: 1px solid var(--sdk-border-color, var(--el-border-color-lighter, #e4e7ed));
  background: var(--sdk-bg-subtle, var(--el-fill-color-blank, #ffffff));
}

.sdk-app-preview-card--warning {
  border-color: var(--el-color-warning-light-5, #f3d19e);
  background: var(--el-color-warning-light-9, #fdf6ec);
}

.sdk-app-preview-card--error {
  border-color: var(--el-color-danger-light-5, #fab6b6);
  background: var(--el-color-danger-light-9, #fef0f0);
}

.sdk-app-preview-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--sdk-text-primary, var(--el-text-color-primary, #1f2329));
}

.sdk-app-preview-message {
  margin: 0;
  max-width: 420px;
  line-height: 1.5;
  color: var(--sdk-text-secondary, var(--el-text-color-secondary, #646a73));
  word-break: break-word;
}

.sdk-app-preview-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border-radius: var(--el-border-radius-base, 6px);
  border: 1px solid var(--sdk-border-color, var(--el-border-color, #d4d7de));
  background: var(--sdk-bg-color, var(--el-fill-color-blank, #ffffff));
  color: var(--sdk-text-primary, var(--el-text-color-primary, #1f2329));
  font: inherit;
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.sdk-app-preview-btn:hover {
  background: var(--el-fill-color-light, #f5f7fa);
  border-color: var(--el-border-color-darker, var(--el-border-color, #c0c4cc));
}

.sdk-app-preview-spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--sdk-border-color, var(--el-border-color-lighter, #e4e7ed));
  border-top-color: var(--sdk-color-primary, var(--el-color-primary, #409eff));
  animation: sdk-app-preview-spin 0.8s linear infinite;
}

@keyframes sdk-app-preview-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
