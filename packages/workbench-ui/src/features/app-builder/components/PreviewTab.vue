<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, inject } from "vue";
import { useI18n } from "vue-i18n";
import { Check, CircleAlert, Files, LoaderCircle } from "lucide-vue-next";
import { apiUrl } from "../../../utils/api-base";
import { getSynchronizedNow } from "../../../utils/server-time";
import { builderPlatformKey } from "../platform";
import { useBuildTestState } from "../build-test-state";
import { builderApi } from "../api";
import { errorText } from "../panel";
import type { WorkspaceView } from "../workspace-view";

/**
 * The workspace's current files running as the app, in a frame of the platform's own origin: like a published app it
 * reads the platform's host port for the reader, the theme and the language, but its business calls run on the
 * workspace's test data, which Java prepares, times and ends. The frame first loads once Java has answered for the
 * workspace, and loads again, each time with a new token, when the workspace's HEAD moves (a run's commit, a restore),
 * when Java answers another context or stage, or when the reader asks. A failed read leaves the frame as it is.
 *
 * The frame's top line says at all times that the preview runs on test data: from which sample and until when, or why
 * there is none to run on. What the agent's run does to the files shares that line instead of covering it. Real data
 * has no switch here; it shows once the application is published.
 *
 * `frameWindow` is the window of the frame shown now, null without one: the app speaks for the preview only from there.
 */
const props = defineProps<{ view: WorkspaceView; reload: number; flash: string | null }>();
const frameWindow = defineModel<Window | null>("frameWindow", { required: true });
const { t, locale } = useI18n();

let loads = 0;
const src = ref<string | null>(null);
const frame = ref(0);
const error = ref<string | null>(null);
const hasPage = computed(() => props.view.files.some((file) => file.path === "index.html"));
const workspace = computed(() => props.view.workspace);
const platform=inject(builderPlatformKey)!;
const testState=useBuildTestState(()=>workspace.value?.id ?? null);
defineExpose({buildTestState:testState.state,refreshBuildTestState:testState.refresh,previewError:computed(()=>error.value)});
/** What the frame runs on: Java's last answer for the workspace shown, none before the first; a failed read keeps it. */
const binding = computed(() => {
  const context = testState.binding.value;
  return context?.workspaceId === workspace.value?.id ? context : null;
});
let registration: ReturnType<typeof platform.registerPreviewFrame> | null = null;
// Another context, workspace or stage starts the app afresh, so data that became ready, expired, ended or failed reaches
// it; a new answer of the same stage only refreshes the frame's snapshot.
watch(binding, (next, previous) => {
  if (next && previous && next.workspaceId === previous.workspaceId && next.contextId === previous.contextId && next.status === previous.status) registration?.update(next);
  else void load();
});

async function load() {
  const current = workspace.value;
  const attempt = ++loads;
  error.value = null;
  src.value = null;
  // Before Java's first answer there is nothing to bind the frame to: it waits instead of loading twice on opening.
  if (!current || !hasPage.value || !binding.value) {
    src.value = null;
    return;
  }
  try {
    const token=await builderApi.previewToken(current.id);
    if (attempt !== loads) return;
    src.value = apiUrl(`/workspaces/${encodeURIComponent(current.id)}/preview/${encodeURIComponent(token.token)}/index.html`);
    frame.value++;
  } catch (reason) {
    if (attempt === loads) error.value = errorText(reason);
  }
}

watch([() => workspace.value?.id, () => workspace.value?.headCommit, hasPage, () => props.reload], load, { immediate: true });

// Each load makes a new frame element, so a reloaded app is a new window.
const iframe = ref<HTMLIFrameElement | null>(null);
watch(iframe, (element) => {
  registration?.dispose();registration=null;
  const source = element?.contentWindow ?? null;
  // A controlled model's prop updates on the parent's next render; register the actual new frame now.
  frameWindow.value = source;
  if(source) registration=platform.registerPreviewFrame(source,binding.value!);
}, { flush: "post" });
onBeforeUnmount(() => {registration?.dispose();frameWindow.value=null;});

/* ---- The frame's top line and notice: the test data the app runs on ---- */

const test = testState.state;

/** Java's clock as this page knows it, read every second for the countdown to Java's deadline. */
const now = ref(getSynchronizedNow());
const clock = setInterval(() => (now.value = getSynchronizedNow()), 1000);
onBeforeUnmount(() => clearInterval(clock));
/** Java's deadline has passed while the last read still says ready: the data is expired, Java rejects its calls. */
const due = computed(() => test.value.status === "READY" && now.value >= test.value.expiresAt!);
// Java is asked at its deadline instead of at the next poll, so the frame drops the last round's results right away.
watch(due, (passed) => {
  if (passed) void testState.refresh();
});
const phase = computed(() => (due.value ? "EXPIRED" : test.value.status));

const clockTime = (time: number) => new Intl.DateTimeFormat(locale.value, { timeStyle: "short" }).format(time);
const minutes = (count: number) =>
  new Intl.NumberFormat(locale.value, { style: "unit", unit: "minute", unitDisplay: "short" }).format(count);

/** The stages the line names in a word; ready and expired data name their deadline instead. */
const STAGE_TEXT = {
  LOADING: "assistant.loading",
  NONE: "appBuilder.testNone",
  PREPARING: "appBuilder.testPreparing",
  PREPARE_FAILED: "appBuilder.testFailed",
  CLOSED: "appBuilder.testClosed",
  UNAVAILABLE: "appBuilder.testUnavailable",
} as const;
/** The line's last part: until when the test data lasts, or the stage that leaves none to run on. */
const stateText = computed(() => {
  const stage = phase.value;
  const expiresAt = test.value.expiresAt!;
  if (stage === "READY")
    return t("appBuilder.testExpires", { time: clockTime(expiresAt), remaining: minutes(Math.ceil((expiresAt - now.value) / 60_000)) });
  if (stage === "EXPIRED") return t("appBuilder.testExpired", { time: clockTime(expiresAt) });
  return t(STAGE_TEXT[stage]);
});

/** What each stage without usable test data means for the page's business calls, and what brings the data back. */
const NOTICES = {
  NONE: { type: "info", title: "appBuilder.testNoneHint" },
  PREPARING: { type: "info", title: "appBuilder.testPreparingHint" },
  PREPARE_FAILED: { type: "error", title: "appBuilder.testFailedHint" },
  EXPIRED: { type: "warning", title: "appBuilder.testExpiredHint" },
  CLOSED: { type: "warning", title: "appBuilder.testClosedHint" },
  UNAVAILABLE: { type: "error", title: "appBuilder.testUnavailableHint" },
} as const;
/** The notice under the line, with the failure's reason as its detail when there is one. */
const notice = computed(() => {
  const stage = phase.value;
  if (stage === "READY" || stage === "LOADING") return null;
  const reason = test.value.error;
  // After a test the reason is its cleanup's; before, the failure's own.
  const detail = stage === "EXPIRED" || stage === "CLOSED" ? reason && t("appBuilder.testCleanupFailed", { reason }) : reason;
  return { type: NOTICES[stage].type, title: t(NOTICES[stage].title), detail };
});
</script>

<template>
  <div class="preview">
    <div class="preview-frame">
      <div class="frame-line">
        <el-tooltip :content="t('appBuilder.testDataHint')" placement="bottom-start" :show-after="200">
          <el-tag class="test-tag" type="warning" size="small" disable-transitions tabindex="0">{{ t("appBuilder.testData") }}</el-tag>
        </el-tooltip>
        <span v-if="test.contextId" class="test-sample" :title="test.sampleName">{{ test.sampleName }}</span>
        <span class="test-state">
          <LoaderCircle v-if="phase === 'LOADING' || phase === 'PREPARING'" :size="12" class="spin" aria-hidden="true" />
          {{ stateText }}
        </span>
        <span class="run-state" role="status">
          <template v-if="workspace?.activeRunId">
            <LoaderCircle :size="13" class="spin" aria-hidden="true" />
            <span>{{ t("appBuilder.previewRunning") }}</span>
          </template>
          <template v-else-if="flash">
            <Check :size="13" class="ok" aria-hidden="true" />
            <span>{{ flash }}</span>
          </template>
        </span>
      </div>
      <div v-if="notice" class="frame-notice">
        <el-alert :type="notice.type" :title="notice.title" :description="notice.detail ?? undefined" :closable="false" show-icon />
      </div>
      <div class="frame-body">
        <iframe v-if="src" :key="frame" ref="iframe" :src="src" :title="t('appBuilder.tabPreview')" class="app-frame" />
        <div v-else-if="error" class="frame-state" role="alert">
          <CircleAlert :size="20" aria-hidden="true" />
          <p>{{ error }}</p>
          <el-button size="small" @click="load">{{ t("common.retry") }}</el-button>
        </div>
        <div v-else-if="view.filesState === 'error'" class="frame-state" role="alert">
          <CircleAlert :size="20" aria-hidden="true" />
          <p>{{ t("assistant.loadFailed") }}</p>
          <el-button size="small" @click="view.loadFiles()">{{ t("common.retry") }}</el-button>
        </div>
        <div v-else-if="view.filesState === 'ready' && !hasPage" class="frame-state">
          <Files :size="28" aria-hidden="true" />
          <p class="state-title">{{ t("appBuilder.previewEmpty") }}</p>
          <span>{{ t("appBuilder.previewEmptyHint") }}</span>
        </div>
        <div v-else class="frame-state" aria-busy="true">
          <LoaderCircle :size="18" class="spin" aria-hidden="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The app sits in its own frame on the panel, so the page it draws never runs into the panel's edges. */
.preview {
  display: flex;
  height: 100%;
  box-sizing: border-box;
  padding: var(--spacing-md);
  background: var(--el-fill-color-lighter);
}
.preview-frame {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
/*
 * The frame's own line: the sample's name and the run's note wrap onto a second row when the panel is narrow, such as
 * beside the conversation, instead of each being cut to a few characters with an ellipsis. The stage stays whole and
 * the sample's name gives way only at the very end, when the row cannot hold even its first part.
 */
.frame-line {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 6px;
  min-height: var(--control-height-sm);
  padding: 2px var(--spacing-sm);
  overflow: hidden;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.test-tag {
  flex-shrink: 0;
}
.test-sample {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-regular);
}
.test-state {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.test-sample + .test-state::before {
  content: "·";
}
/* No `min-width: 0` on the row's parts: a flex item that may shrink is a flex item that is cut, which is what this
   line must not do. Everything that does not fit moves to the next row whole. */
.run-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-inline-start: auto;
  color: var(--el-text-color-regular);
}
.run-state span {
  white-space: normal;
  overflow-wrap: anywhere;
}
.run-state svg {
  flex-shrink: 0;
}
.ok {
  color: var(--el-color-success);
}
.frame-notice {
  flex-shrink: 0;
  padding: var(--spacing-sm);
}
.frame-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.app-frame {
  flex: 1;
  width: 100%;
  height: 100%;
  border: 0;
}
.frame-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: auto;
  padding: var(--spacing-xl);
  max-width: 320px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.frame-state p {
  margin: 4px 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  /* A version's digest or a path with no spaces in it breaks instead of running out of the panel. */
  overflow-wrap: anywhere;
}
.frame-state .state-title {
  color: var(--el-text-color-primary);
  font-weight: var(--font-medium);
}
.frame-state svg {
  color: var(--el-text-color-placeholder);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
