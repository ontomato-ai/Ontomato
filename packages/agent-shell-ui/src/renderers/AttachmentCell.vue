<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowReactive, watch } from "vue";
import { ElImage, ElImageViewer } from "@ontomato/foundation-ui/preview";
import { FileText, ExternalLink, File } from "lucide-vue-next";
import { cellAttachments, type CellAttachment } from "./cell-attachments";
import TableTextCell from "./TableTextCell.vue";
import { saveBlob } from "../artifacts";
import { shellContextKey } from "../context";
import { vectorResourceTarget } from "../vector-resource";

const props = defineProps<{ text: string; gallery?: CellAttachment[] }>();
const shell = inject(shellContextKey, undefined);
const attachments = computed(() => cellAttachments(props.text));
const gallery = computed(() => (props.gallery ?? attachments.value).filter(item => item.kind === "image"));
const viewing = ref<string | null>(null);
const viewer = ref<InstanceType<typeof ElImageViewer> | null>(null);
const resources = shallowReactive(new Map<string, { url: string; blob: Blob }>());
const requests = new Map<string, AbortController>();

function source(item: CellAttachment): string | undefined {
  return vectorResourceTarget(item.url) ? resources.get(item.url)?.url : item.url;
}

const viewable = computed(() => gallery.value.flatMap(item => {
  const url = source(item);
  return url ? [{ ...item, source: url }] : [];
}));
const images = computed(() => viewable.value.map(item => item.source));
const viewIndex = computed(() => viewable.value.findIndex(item => item.url === viewing.value));
const viewedCaption = computed(() => viewable.value[viewIndex.value]?.caption);
watch(viewIndex, index => {
  if (index >= 0) viewer.value?.setActiveItem(index);
}, { flush: "post" });
watch(() => props.text, () => { viewing.value = null; });

function release(url: string) {
  requests.get(url)?.abort();
  requests.delete(url);
  const resource = resources.get(url);
  if (resource) URL.revokeObjectURL(resource.url);
  resources.delete(url);
}

watch(() => [...attachments.value, ...(viewing.value === null ? [] : gallery.value)], items => {
  const current = new Set(items.map(item => item.url));
  for (const url of requests.keys()) if (!current.has(url)) release(url);
  const read = shell?.readVectorResource;
  if (!read) return;
  for (const url of current) {
    const target = vectorResourceTarget(url);
    if (!target || requests.has(url)) continue;
    const request = new AbortController();
    requests.set(url, request);
    void read(target, request.signal).then(blob => {
      if (!request.signal.aborted) resources.set(url, { blob, url: URL.createObjectURL(blob) });
    }, () => {
      // An unavailable protected resource has no browser source.
    });
  }
}, { immediate: true });
onBeforeUnmount(() => { for (const url of requests.keys()) release(url); });

function activateFile(item: CellAttachment, event: MouseEvent) {
  const resource = resources.get(item.url);
  if (resource?.blob.type !== "application/octet-stream") return;
  event.preventDefault();
  saveBlob(resource.blob, vectorResourceTarget(item.url)!.fileName);
}
</script>

<template>
  <div v-if="attachments.length" class="cell-attachments">
    <template v-for="(item, index) in attachments" :key="`${index}:${item.url}`">
      <figure v-if="item.kind === 'image'" class="cell-image">
        <button type="button" class="image-open" :aria-label="item.caption" :disabled="!source(item)" @click.stop="viewing = item.url">
          <el-image v-if="source(item)" :src="source(item)" :alt="item.caption" :title="item.caption" fit="cover" loading="lazy">
            <template #error><span class="image-error">{{ item.caption }}</span></template>
          </el-image>
          <span v-else class="el-image image-error">{{ item.caption }}</span>
        </button>
        <figcaption :title="item.caption">{{ item.caption }}</figcaption>
      </figure>
      <a v-else :href="source(item)" target="_blank" rel="noopener noreferrer" class="cell-file" :title="item.caption" @click.stop="activateFile(item, $event)">
        <component :is="item.kind === 'pdf' ? FileText : File" :size="18" aria-hidden="true" />
        <span>{{ item.caption }}</span>
        <span v-if="item.kind === 'pdf'" class="file-kind">PDF</span>
        <ExternalLink :size="12" aria-hidden="true" />
      </a>
    </template>
  </div>
  <TableTextCell v-else :text="text" />
  <el-image-viewer v-if="viewIndex >= 0" ref="viewer" :url-list="images" :initial-index="viewIndex" teleported hide-on-click-modal @switch="viewing = viewable[$event]?.url ?? null" @close="viewing = null">
    <template #default><div v-if="viewedCaption" class="viewer-caption">{{ viewedCaption }}</div></template>
  </el-image-viewer>
</template>

<style scoped>
.cell-attachments { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding-block: 4px; }
.cell-image { margin: 0; width: 88px; }
.image-open { display: block; padding: 0; border: 0; border-radius: 6px; background: transparent; cursor: zoom-in; }
.image-open:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.cell-image :deep(.el-image) { display: block; width: 88px; height: 66px; border-radius: 6px; border: 1px solid var(--el-border-color-light); cursor: zoom-in; }
.cell-image figcaption { margin-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.image-error { padding: 4px; font-size: 12px; overflow-wrap: anywhere; }
.cell-file { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 6px 8px; border: 1px solid var(--el-border-color-light); border-radius: 6px; color: var(--el-color-primary); text-decoration: none; }
.cell-file > svg { flex-shrink: 0; }
.cell-file > span:first-of-type { min-width: 0; overflow-wrap: anywhere; }
.cell-file:hover { background: var(--el-fill-color-light); }
.cell-file:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.file-kind { font-size: 10px; color: var(--el-text-color-secondary); }
.viewer-caption { position: absolute; inset-inline: 20px; bottom: 100px; color: white; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; pointer-events: none; text-shadow: 0 1px 4px black; }
</style>
