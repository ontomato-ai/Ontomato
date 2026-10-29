<script setup lang="ts">
import { inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { WorkspaceManifest, ArtifactFileTreeNode, ArtifactFilePreview } from "@ontomato/contracts/observe";
import { diagnosisApi } from "../api";
import { diagnosisActionKey } from "../ops-host";
import { authHost } from "../../../utils/auth";
import FilePreview from "./FilePreview.vue";
import ArtifactRetentionButton from "./ArtifactRetentionButton.vue";
const props = defineProps<{ apiPrefix: string; title?: string; question?: string; subtitle?: string; triggerBuildBody?: Record<string, unknown>; triggerBuildUrl?: string; kept?: boolean; retentionLoading?: boolean }>();
const emit = defineEmits<{ loaded: []; "toggle-retention": [] }>();
const { t } = useI18n(), diagnose = inject(diagnosisActionKey);
const manifest = ref<WorkspaceManifest | null>(null), files = ref<ArtifactFileTreeNode[]>([]), preview = ref<ArtifactFilePreview | null>(null), selected = ref<ArtifactFileTreeNode | null>(null);
const loading = ref(false), refreshing = ref(false), error = ref("");
let generation = 0;
async function load() {
  const own = ++generation;
  loading.value = true; error.value = ""; preview.value = null; selected.value = null;
  try {
    const value = await diagnosisApi.getArtifactManifest(props.apiPrefix), tree = await diagnosisApi.getArtifactTree(props.apiPrefix);
    if (own !== generation) return;
    manifest.value = value; files.value = Array.isArray(tree) ? tree : tree.children ?? [tree]; emit("loaded");
  } catch (e) { if (own === generation) { manifest.value = null; error.value = e instanceof Error ? e.message : t("diagnosis.requestFailed"); } }
  finally { if (own === generation) loading.value = false; }
}
async function selectFile(node: ArtifactFileTreeNode) {
  if (node.type === "directory") return;
  const own = generation; selected.value = node; preview.value = null;
  try {
    const value = await diagnosisApi.getArtifactFile(props.apiPrefix, node.path.split("/").map(encodeURIComponent).join("/"));
    if (own === generation && selected.value?.path === node.path) preview.value = value;
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : t("diagnosis.requestFailed")); }
}
async function refresh() {
  if (!props.triggerBuildUrl || refreshing.value) return;
  refreshing.value = true;
  try { await diagnosisApi.rebuildArtifact(props.triggerBuildUrl, { ...props.triggerBuildBody, force: true }); await load(); }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : t("diagnosis.requestFailed")); }
  finally { refreshing.value = false; }
}
function download() { window.open(diagnosisApi.artifactDownloadUrl(props.apiPrefix, authHost().getToken() || ""), "_blank", "noopener,noreferrer"); }
watch(() => props.apiPrefix, load, { immediate: true });
</script>
<template>
  <section class="artifact-detail" v-loading="loading">
    <header>
      <strong>{{ question || title || t('ops.references') }}</strong>
      <el-button v-if="diagnose && manifest?.evidence" @click="diagnose(manifest.evidence.target)">{{ t('ops.diagnose') }}</el-button>
      <ArtifactRetentionButton v-if="kept !== undefined" :kept="kept" :loading="retentionLoading" @toggle="emit('toggle-retention')" />
      <el-button v-if="triggerBuildUrl" :loading="refreshing" @click="refresh">{{ t('ops.refresh') }}</el-button>
      <el-button :disabled="!manifest?.evidence" @click="download">{{ t('common.download') }}</el-button>
    </header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="manifest">
      <p>{{ manifest.evidence ? t('ops.referenceHint') : t('ops.legacy') }}</p>
      <div v-if="manifest.evidence" class="references">
        <el-alert v-for="gap in manifest.evidence.gaps" :key="gap.source + gap.code" :title="gap.message" type="warning" :closable="false" />
        <table><thead><tr><th>Owner</th><th>Session / Run</th><th>Artifacts</th></tr></thead>
          <tbody><tr v-for="run in manifest.evidence.runs" :key="run.runId"><td>{{ run.owner }}</td><td><code>{{ run.sessionId }}<br>{{ run.runId }}</code></td><td><code v-for="id in run.artifactIds" :key="id">{{ id }}<br></code></td></tr></tbody>
        </table>
        <details><summary>{{ t('ops.references') }}</summary><pre>{{ JSON.stringify(manifest.evidence, null, 2) }}</pre></details>
      </div>
      <div class="files">
        <el-tree :data="files" :props="{ label: 'name', children: 'children' }" node-key="path" @node-click="selectFile" />
        <FilePreview v-if="selected && preview" :filename="selected.name" :file-path="selected.path" :content="preview.content" :truncated="preview.truncated" />
      </div>
    </template>
  </section>
</template>
<style scoped>
.artifact-detail { height: 100%; overflow: auto; padding: 12px; box-sizing: border-box; }
header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
header strong { margin-right: auto; overflow-wrap: anywhere; }
.references { overflow: auto; margin: 12px 0; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--el-border-color); vertical-align: top; }
code, pre { overflow-wrap: anywhere; white-space: pre-wrap; }
.files { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(0, 4fr); min-height: 250px; gap: 12px; }
@media(max-width: 700px) { .files { display: block; } }
</style>
