<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Check, CircleAlert, Loader2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { PptArtifactCard, type ConversationInputRun } from "@ontomato/agent-shell-ui";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { readReportPptMessage } from "../report-ppt";

const props = defineProps<{
  message: string;
  run: ConversationInputRun | null;
  pending: boolean;
  queued: boolean;
  preparationFailed: boolean;
  canRetry: boolean;
  request: (message: string) => Promise<void>;
  resolve: (runId: string, path: string) => Promise<RuntimeArtifact | null>;
}>();
const emit = defineEmits<{ result: [artifact: RuntimeArtifact | null] }>();
const { locale } = useI18n();
const text = computed(() => locale.value === "zh-CN" ? {
  working: "正在生成 PPT…", sending: "正在提交…", ready: "PPT 已生成", failed: "PPT 生成失败",
  submitFailed: "未能提交 PPT 生成任务", stopped: "PPT 生成已停止", noFile: "生成已结束，未找到 PPT 文件",
  lookupFailed: "暂时无法读取 PPT 文件", retry: "重新生成", check: "重新检查",
} : locale.value === "zh-TW" ? {
  working: "正在產生 PPT…", sending: "正在提交…", ready: "PPT 已產生", failed: "PPT 產生失敗",
  submitFailed: "無法提交 PPT 產生任務", stopped: "PPT 產生已停止", noFile: "產生已結束，找不到 PPT 檔案",
  lookupFailed: "暫時無法讀取 PPT 檔案", retry: "重新產生", check: "重新檢查",
} : {
  working: "Generating PPT…", sending: "Submitting…", ready: "PPT ready", failed: "PPT generation failed",
  submitFailed: "Could not submit the PPT request", stopped: "PPT generation stopped", noFile: "Generation ended without a PPT file",
  lookupFailed: "Could not read the PPT file", retry: "Generate again", check: "Check again",
});
const request = computed(() => readReportPptMessage(props.message));
const recorded = computed(() => props.run?.artifacts.reduce<RuntimeArtifact | null>((latest, file) =>
  file.runId === props.run?.id && file.path === request.value?.path && (!latest || file.seq >= latest.seq) ? file : latest, null));
const result = shallowRef<RuntimeArtifact | null>(null);
watch(result, artifact => emit("result", artifact));
onBeforeUnmount(() => emit("result", null));
const lookup = ref<"idle" | "checking" | "missing" | "failed">("idle");
const checkAgain = ref(0);
const retrying = ref(false);
const retryFailed = ref(false);
const retried = ref(false);
const terminal = computed(() => props.run?.status === "stopped");
const runError = computed(() => terminal.value && (Boolean(props.run?.errorMessage) || props.run?.stopReason === "error" || props.run?.stopReason === "length"));
const stopped = computed(() => terminal.value && props.run?.stopReason === "aborted");

watch([() => props.run?.id, terminal, runError, stopped, recorded, () => request.value?.path, checkAgain],
  async ([id, complete, failed, aborted, file, path], _, onCleanup) => {
    result.value = null;
    lookup.value = "idle";
    if (!id || !path || !complete || failed || aborted) return;
    if (file) {
      result.value = file;
      return;
    }
    let current = true;
    onCleanup(() => { current = false; });
    lookup.value = "checking";
    try {
      const resolved = await props.resolve(id, path);
      if (!current) return;
      // A result from an earlier run must not satisfy a new generation of the same report.
      result.value = resolved?.runId === id && resolved.path === path ? resolved : null;
      lookup.value = result.value ? "idle" : "missing";
    } catch {
      if (current) lookup.value = "failed";
    }
  }, { immediate: true });

const state = computed(() => {
  if (props.pending || retrying.value) return "sending";
  if (props.preparationFailed) return "submitFailed";
  if (stopped.value) return "stopped";
  if (runError.value) return "failed";
  if (result.value) return "ready";
  if (lookup.value === "failed") return "lookupFailed";
  if (lookup.value === "missing") return "noFile";
  if (!props.run && !props.queued) return "stopped";
  return "working";
});
const busy = computed(() => state.value === "sending" || state.value === "working");

async function retry() {
  if (!props.canRetry || retrying.value) return;
  retrying.value = true;
  retryFailed.value = false;
  try {
    await props.request(props.message);
    retried.value = true;
  } catch {
    retryFailed.value = true;
  } finally {
    retrying.value = false;
  }
}
</script>

<template>
  <div v-if="request" class="ppt-turn">
    <div class="ppt-turn-summary" :class="{ ready: state === 'ready', attention: !busy && state !== 'ready' }">
      <span class="ppt-turn-icon">
        <Loader2 v-if="busy" class="ppt-turn-spinner" :size="17" aria-hidden="true" />
        <Check v-else-if="state === 'ready'" :size="17" aria-hidden="true" />
        <CircleAlert v-else :size="17" aria-hidden="true" />
      </span>
      <span class="ppt-turn-label">
        <strong role="status">{{ text[state] }}</strong>
        <span v-if="!result" :title="request.title">{{ request.title }}</span>
      </span>
      <button v-if="state === 'lookupFailed'" type="button" @click="checkAgain++">{{ text.check }}</button>
      <button v-else-if="!busy && state !== 'ready' && !retried" type="button" :disabled="!canRetry" @click="retry">{{ text.retry }}</button>
    </div>
    <PptArtifactCard v-if="result" :key="result.id" :artifact="result" :run-id="result.runId" :path="result.path" :title="request.title" />
    <p v-if="retryFailed" class="ppt-retry-error" role="alert">{{ text.submitFailed }}</p>
  </div>
</template>

<style scoped>
.ppt-turn { display: grid; gap: 4px; width: min(100%, 540px); }
.ppt-turn-summary {
  display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px 10px;
  border: 1px solid var(--el-border-color); border-radius: var(--radius-lg, 12px);
  background: var(--el-bg-color); font-size: var(--text-sm, 13px);
}
.ppt-turn-summary.ready { border: 0; padding-block: 3px; background: transparent; }
.ppt-turn-icon { display: inline-flex; color: var(--el-color-primary); }
.ready .ppt-turn-icon { color: var(--el-color-success); }
.attention .ppt-turn-icon, .ppt-retry-error { color: var(--el-color-danger); }
.ppt-turn-label { display: grid; flex: 1; gap: 2px; min-width: 0; }
.ppt-turn-label > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); }
.ppt-turn button {
  flex: none; padding: 5px 8px; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm, 6px);
  background: var(--el-bg-color); color: var(--el-color-primary); font: inherit; cursor: pointer;
}
.ppt-turn button:disabled { opacity: .55; cursor: default; }
.ppt-retry-error { margin: 0; font-size: var(--text-sm, 13px); }
.ppt-turn-spinner { animation: ppt-turn-spin 1s linear infinite; }
@keyframes ppt-turn-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ppt-turn-spinner { animation: none; } }
</style>
