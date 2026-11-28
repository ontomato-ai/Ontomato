<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElImage, ElImageViewer } from "@ontomato/foundation-ui/preview";
import { FileText, ExternalLink, File } from "lucide-vue-next";
import { cellAttachments, type CellAttachment } from "./cell-attachments";

const props = defineProps<{ text: string; gallery?: CellAttachment[] }>();
const attachments = computed(() => cellAttachments(props.text));
const gallery = computed(() => (props.gallery ?? attachments.value).filter(item => item.kind === "image"));
const images = computed(() => gallery.value.map(item => item.url));
const viewing = ref<number | null>(null);
const viewedCaption = computed(() => viewing.value === null ? "" : gallery.value[viewing.value]?.caption);
watch(() => props.text, () => { viewing.value = null; });
</script>

<template>
  <div v-if="attachments.length" class="cell-attachments" title="">
    <template v-for="(item, index) in attachments" :key="`${index}:${item.url}`">
      <figure v-if="item.kind === 'image'" class="cell-image">
        <button type="button" class="image-open" :aria-label="item.caption" @click.stop="viewing = images.indexOf(item.url)">
        <el-image :src="item.url" :alt="item.caption" :title="item.caption" fit="cover" loading="lazy">
          <template #error><span class="image-error">{{ item.caption }}</span></template>
        </el-image>
        </button>
        <figcaption :title="item.caption">{{ item.caption }}</figcaption>
      </figure>
      <a v-else :href="item.url" target="_blank" rel="noopener noreferrer" class="cell-file" :title="item.caption" @click.stop>
        <component :is="item.kind === 'pdf' ? FileText : File" :size="18" aria-hidden="true" />
        <span>{{ item.caption }}</span>
        <span v-if="item.kind === 'pdf'" class="file-kind">PDF</span>
        <ExternalLink :size="12" aria-hidden="true" />
      </a>
    </template>
  </div>
  <template v-else>{{ text }}</template>
  <el-image-viewer v-if="viewing !== null" :url-list="images" :initial-index="viewing" teleported hide-on-click-modal @switch="viewing = $event" @close="viewing = null">
    <template #default><div v-if="viewedCaption" class="viewer-caption">{{ viewedCaption }}</div></template>
  </el-image-viewer>
</template>

<style scoped>
.cell-attachments { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding-block: 4px; white-space: normal; }
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
