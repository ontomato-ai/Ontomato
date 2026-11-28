<script setup lang="ts">
import { computed, inject, shallowRef, watch } from "vue";
import { ArrowUpRight, Download, Presentation } from "lucide-vue-next";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { fileName, formatSize } from "../artifacts";
import { shellContextKey } from "../context";
import { useArtifactDownload } from "../useArtifactDownload";

const props = defineProps<{ runId: string; path: string; title: string; artifact?: RuntimeArtifact }>();
const shell = inject(shellContextKey)!;
const resolved = shallowRef<RuntimeArtifact | null>(null);
const missing = shallowRef(false);
const artifact = computed(() => props.artifact ?? resolved.value);
const title = computed(() => props.title || fileName(props.path));
const { saving, failed, download } = useArtifactDownload(shell.readArtifact);
const created = computed(() => artifact.value ? new Date(artifact.value.createdAt).toLocaleString(undefined, {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
}) : "");

watch([() => props.runId, () => props.path, () => props.artifact, shell.artifactRevision], async (_, previous, onCleanup) => {
  if (props.artifact) return;
  if (previous?.[0] !== props.runId || previous?.[1] !== props.path) resolved.value = null;
  let current = true;
  onCleanup(() => { current = false; });
  const next = await shell.resolveArtifact(props.runId, props.path).catch(() => null);
  if (!current) return;
  resolved.value = next;
  missing.value = next === null;
}, { immediate: true });

function openDetails() {
  if (!artifact.value) return;
  const file = artifact.value;
  shell.openArtifact({ key: [props.runId, props.path].join(":"), artifact: file, title: title.value });
}
</script>

<template>
  <div class="ppt-artifact">
    <div class="ppt-file">
      <span class="ppt-icon"><Presentation :size="18" aria-hidden="true" /></span>
      <span class="ppt-file-text">
        <strong :title="title">{{ title }}</strong>
        <span class="ppt-meta">
          <template v-if="missing && !artifact">{{ shell.labels.value.artifactMissing }}</template>
          <template v-else>PPTX<template v-if="artifact"> · {{ formatSize(artifact.size) }} · <time :datetime="artifact.createdAt">{{ created }}</time></template></template>
        </span>
      </span>
      <button v-if="artifact" type="button" class="ppt-details" :title="shell.labels.value.fileDetails ?? shell.labels.value.open"
        :aria-label="shell.labels.value.fileDetails ?? shell.labels.value.open" @click="openDetails">
        <ArrowUpRight :size="15" aria-hidden="true" />
      </button>
      <button v-if="artifact" type="button" class="ppt-download" :disabled="saving" :aria-busy="saving" @click="download(artifact)">
        <Download :size="15" aria-hidden="true" />
        {{ saving ? shell.labels.value.loading : shell.labels.value.downloadPptx ?? shell.labels.value.download }}
      </button>
    </div>
    <p v-if="failed" class="ppt-error" role="alert">{{ shell.labels.value.downloadFailed ?? shell.labels.value.loadFailed }}</p>
  </div>
</template>

<style scoped>
.ppt-artifact {
  display: inline-block;
  width: min(100%, 540px);
  margin-block: 2px;
  vertical-align: middle;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg, 12px);
  background: var(--el-bg-color);
}
.ppt-file { display: flex; align-items: center; gap: 10px; padding: 10px; }
.ppt-icon {
  display: grid; flex: none; place-items: center; width: 36px; height: 36px;
  border-radius: var(--radius-md, 8px); background: var(--el-color-primary-light-9); color: var(--el-color-primary);
}
.ppt-file-text { display: grid; flex: 1; min-width: 0; gap: 3px; }
.ppt-file-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm, 13px); }
.ppt-meta { color: var(--el-text-color-secondary); font-size: var(--text-xs, 12px); overflow-wrap: anywhere; }
.ppt-artifact button {
  display: inline-flex; flex: none; align-items: center; gap: 5px; padding: 6px 8px;
  border: 1px solid transparent; border-radius: var(--radius-sm, 6px); font: inherit;
  font-size: var(--text-sm, 13px); white-space: nowrap; cursor: pointer;
}
.ppt-details { background: transparent; color: var(--el-text-color-secondary); }
.ppt-details:hover { background: var(--el-fill-color); }
.ppt-download { background: var(--el-color-primary); color: var(--el-color-white, white); }
.ppt-download:hover { background: var(--el-color-primary-light-3); }
.ppt-download:disabled { opacity: .65; cursor: wait; }
.ppt-artifact button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.ppt-error { margin: 0 10px 10px; color: var(--el-color-danger); font-size: var(--text-sm, 13px); }
</style>
