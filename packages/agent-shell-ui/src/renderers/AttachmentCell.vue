<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowReactive, watch, type ObjectDirective } from "vue";
import { ElImage, ElImageViewer } from "@ontomato/foundation-ui/preview";
import { FileText, ExternalLink, File } from "lucide-vue-next";
import { cellAttachments, type CellAttachment } from "./cell-attachments";
import TableTextCell from "./TableTextCell.vue";
import { saveBlob } from "../artifacts";
import { shellContextKey } from "../context";
import { vectorResourceTarget } from "../vector-resource";

const props = defineProps<{ text: string; gallery?: CellAttachment[] }>();
const shell = inject(shellContextKey, undefined);
const attachments = computed(() => cellAttachments(props.text).map(item => ({
  ...item, target: vectorResourceTarget(item.url),
})));
const gallery = computed(() => (props.gallery ?? attachments.value).filter(item => item.kind === "image"));
const viewing = ref<string | null>(null);
const viewer = ref<InstanceType<typeof ElImageViewer> | null>(null);
const thumbnails = shallowReactive(new Set<string>());
const imageSources = shallowReactive(new Map<string, string>());
const unreadable = shallowReactive(new Set<string>());
const imageRequests = new Map<string, AbortController>();
const fileRequests = shallowReactive(new Map<string, { controller: AbortController; preview: Window | null }>());
const previewUrls = new Map<string, number>();
const thumbnailTargets = new WeakMap<Element, string>();
let observer: IntersectionObserver | undefined;

const vObserveThumbnail: ObjectDirective<HTMLElement, string> = {
  mounted(element, { value: url }) {
    if (!vectorResourceTarget(url)) return;
    thumbnailTargets.set(element, url);
    observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        const target = thumbnailTargets.get(entry.target);
        if (!entry.isIntersecting || target === undefined) continue;
        observer!.unobserve(entry.target);
        thumbnails.add(target);
      }
    });
    observer.observe(element);
  },
  beforeUnmount(element) {
    observer?.unobserve(element);
    thumbnailTargets.delete(element);
  },
};

function source(item: CellAttachment): string | undefined {
  return vectorResourceTarget(item.url) ? imageSources.get(item.url) : item.url;
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
function releaseImage(url: string) {
  imageRequests.get(url)?.abort();
  imageRequests.delete(url);
  const source = imageSources.get(url);
  if (source) URL.revokeObjectURL(source);
  imageSources.delete(url);
  unreadable.delete(url);
}

watch(() => new Set([
  ...thumbnails,
  ...(viewing.value === null ? [] : gallery.value.map(item => item.url)),
]), urls => {
  for (const url of imageRequests.keys()) if (!urls.has(url)) releaseImage(url);
  for (const url of urls) {
    const target = vectorResourceTarget(url);
    if (!target || imageRequests.has(url)) continue;
    const read = shell?.readVectorResource;
    if (!read) {
      unreadable.add(url);
      continue;
    }
    const request = new AbortController();
    imageRequests.set(url, request);
    void read(target, request.signal).then(blob => {
      if (!request.signal.aborted) imageSources.set(url, URL.createObjectURL(blob));
    }, () => {
      if (!request.signal.aborted) unreadable.add(url);
    });
  }
});

function revokePreview(url: string) {
  window.clearTimeout(previewUrls.get(url));
  previewUrls.delete(url);
  URL.revokeObjectURL(url);
}

function cancelFiles() {
  for (const { controller, preview } of fileRequests.values()) {
    controller.abort();
    preview?.close();
  }
  fileRequests.clear();
  for (const url of previewUrls.keys()) revokePreview(url);
}

watch(() => props.text, () => {
  viewing.value = null;
  const current = new Set(attachments.value.map(item => item.url));
  for (const url of thumbnails) if (!current.has(url)) thumbnails.delete(url);
  for (const url of unreadable) if (!current.has(url)) unreadable.delete(url);
  cancelFiles();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  for (const url of imageRequests.keys()) releaseImage(url);
  cancelFiles();
});

async function activateFile(item: (typeof attachments.value)[number]) {
  if (!item.target) return;
  const read = shell?.readVectorResource;
  if (!read) {
    unreadable.add(item.url);
    return;
  }
  unreadable.delete(item.url);
  // Open the PDF tab from the click so browsers allow it after the authenticated read.
  const preview = item.kind === "pdf" ? window.open("about:blank", "_blank") : null;
  if (preview) preview.opener = null;
  const controller = new AbortController();
  fileRequests.set(item.url, { controller, preview });
  try {
    const blob = await read(item.target, controller.signal);
    if (controller.signal.aborted || preview?.closed) return;
    if (preview) {
      const url = URL.createObjectURL(blob);
      previewUrls.set(url, window.setTimeout(() => revokePreview(url), 60_000));
      preview.location.replace(url);
    } else {
      saveBlob(blob, item.target.fileName);
    }
  } catch {
    if (!controller.signal.aborted) {
      preview?.close();
      unreadable.add(item.url);
    }
  } finally {
    if (!controller.signal.aborted) fileRequests.delete(item.url);
  }
}
</script>

<template>
  <div v-if="attachments.length" class="cell-attachments">
    <template v-for="(item, index) in attachments" :key="`${index}:${item.url}`">
      <figure v-if="item.kind === 'image'" v-observe-thumbnail="item.url" class="cell-image">
        <button type="button" class="image-open" :aria-label="item.caption" :disabled="!source(item)" @click.stop="viewing = item.url">
          <el-image v-if="source(item)" :src="source(item)" :alt="item.caption" :title="item.caption" fit="cover" loading="lazy">
            <template #error><span class="image-error">{{ item.caption }}</span></template>
          </el-image>
          <span v-else class="el-image image-error">{{ unreadable.has(item.url) ? shell?.labels.value.artifactMissing : item.caption }}</span>
        </button>
        <figcaption :title="item.caption">{{ item.caption }}</figcaption>
      </figure>
      <component
        :is="item.target ? 'button' : 'a'"
        v-else
        :type="item.target ? 'button' : undefined"
        :href="item.target ? undefined : item.url"
        :target="item.target ? undefined : '_blank'"
        :rel="item.target ? undefined : 'noopener noreferrer'"
        :disabled="item.target ? fileRequests.has(item.url) : undefined"
        class="cell-file"
        :title="item.caption"
        @click.stop="activateFile(item)"
      >
        <component :is="item.kind === 'pdf' ? FileText : File" :size="18" aria-hidden="true" />
        <span>{{ item.caption }}</span>
        <span v-if="item.kind === 'pdf'" class="file-kind">PDF</span>
        <ExternalLink :size="12" aria-hidden="true" />
        <span v-if="fileRequests.has(item.url)" role="status">{{ shell?.labels.value.loading }}</span>
        <span v-else-if="unreadable.has(item.url)" role="status">{{ shell?.labels.value.artifactMissing }}</span>
      </component>
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
button.cell-file { background: transparent; font: inherit; text-align: start; cursor: pointer; }
.cell-file > svg { flex-shrink: 0; }
.cell-file > span:first-of-type { min-width: 0; overflow-wrap: anywhere; }
.cell-file:hover { background: var(--el-fill-color-light); }
.cell-file:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.file-kind { font-size: 10px; color: var(--el-text-color-secondary); }
.viewer-caption { position: absolute; inset-inline: 20px; bottom: 100px; color: white; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; pointer-events: none; text-shadow: 0 1px 4px black; }
</style>
