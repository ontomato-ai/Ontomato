<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { buildExecutionContext, buildTestContextSchema } from "@ontomato/contracts/build-tests";
import type { WorkspacePreviewToken } from "@ontomato/contracts/workspaces";
import { apiUrl, nodeApiGet, nodeApiPost } from "@ontomato/workbench-ui";
import { registerBuildPreview } from "../app-host";

const props = defineProps<{ workspaceId: string }>();
const { locale, t } = useI18n();

const workspacePath = computed(() => `/workspaces/${encodeURIComponent(props.workspaceId)}`);
const back = computed(() => ({ path: "/app-builder/workspace", query: { workspace: props.workspaceId } }));
const refresh = ref(0);
const preview = shallowRef<{ src: string; context: ReturnType<typeof buildExecutionContext> } | null>(null);
const context = shallowRef<ReturnType<typeof buildExecutionContext> | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const iframe = ref<HTMLIFrameElement | null>(null);

watch([workspacePath, refresh], async ([path], _previous, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  preview.value = null;
  context.value = null;
  error.value = null;
  loading.value = true;
  try {
    const workspaceId = props.workspaceId;
    const data = buildTestContextSchema.nullable().parse(await nodeApiGet(`${path}/build-tests`));
    if (!active) return;
    const binding = buildExecutionContext(workspaceId, data);
    context.value = binding;
    const { token } = await nodeApiPost(`${path}/preview-token`, {}) as WorkspacePreviewToken;
    if (active) preview.value = { src: apiUrl(`${path}/preview/${encodeURIComponent(token)}/index.html`), context: binding };
  } catch (reason) {
    if (!active) return;
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (active) loading.value = false;
  }
}, { immediate: true });

watch(iframe, (element, _previous, onCleanup) => {
  if (!element?.contentWindow || !preview.value) return;
  const binding = registerBuildPreview(element.contentWindow, preview.value.context);
  onCleanup(() => binding.dispose());
  element.src = preview.value.src;
}, { flush: "post" });

const statusLabel = computed(() => {
  const test = context.value;
  if (!test) return error.value ? t("appBuilder.testUnavailable") : "";
  switch (test.status) {
    case "NONE": return t("appBuilder.testNone");
    case "READY": return test.sampleName;
    case "PREPARING": return t("appBuilder.testPreparing");
    case "PREPARE_FAILED": return t("appBuilder.testFailed");
    case "CLOSED": return t("appBuilder.testClosed");
    case "EXPIRED": return t("appBuilder.testExpired", { time: new Date(test.expiresAt!).toLocaleTimeString(locale.value) });
    default: return "";
  }
});
</script>

<template>
  <section class="hosted-preview">
    <header>
      <RouterLink :to="back">{{ t("appBuilder.panel") }}</RouterLink>
      <span v-if="statusLabel" role="status">{{ t("appBuilder.testData") }} · {{ statusLabel }}</span>
      <button type="button" :disabled="loading" @click="refresh++">{{ t("appBuilder.refreshPreview") }}</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <iframe v-if="preview" ref="iframe" :key="preview.src" :title="t('appBuilder.tabPreview')" referrerpolicy="no-referrer" />
  </section>
</template>

<style scoped>
.hosted-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-regular);
}
header a {
  color: var(--el-color-primary);
}
header button {
  margin-inline-start: auto;
}
iframe {
  flex: 1;
  width: 100%;
  border: 0;
}
p {
  margin: 12px;
}
</style>
