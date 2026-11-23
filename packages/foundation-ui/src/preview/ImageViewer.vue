<script setup lang="ts">
import { ElImageViewer } from "element-plus/es/components/image-viewer/index";

/**
 * Lightbox image viewer backed by Element Plus. Packages that may not depend on the component library (such as the
 * agent shell) reach `ElImageViewer` through this wrapper.
 */
defineProps<{
  urlList: string[];
  initialIndex?: number;
  teleported?: boolean;
  hideOnClickModal?: boolean;
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <ElImageViewer
    :url-list="urlList"
    :initial-index="initialIndex"
    :teleported="teleported"
    :hide-on-click-modal="hideOnClickModal"
    @close="$emit('close')"
  />
</template>
