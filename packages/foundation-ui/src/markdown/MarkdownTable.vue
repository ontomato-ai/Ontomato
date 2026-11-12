<script setup lang="ts">
import { onMounted, onUpdated, ref, type Component } from "vue";
import { TableNode } from "markstream-vue";

/**
 * markstream's table node. Its column resize handles answer only to a pointer, so they are hidden from assistive
 * technology and kept out of the tab order: otherwise a screen reader announces a control the keyboard cannot use, by
 * the fixed English name markstream gives it ("Resize columns 1 and 2") whatever the page's language.
 */
defineOptions({ inheritAttrs: false });

/** markstream draws it with the node's own props, passed through untouched. */
const table: Component = TableNode;

const root = ref<HTMLElement>();

function quietHandles() {
  for (const handle of root.value?.querySelectorAll<HTMLElement>(".table-node__resize-handle") ?? []) {
    handle.setAttribute("aria-hidden", "true");
    handle.removeAttribute("aria-label");
    handle.tabIndex = -1;
  }
}

onMounted(quietHandles);
onUpdated(quietHandles);
</script>

<template>
  <div ref="root" class="markdown-table"><component :is="table" v-bind="$attrs" /></div>
</template>

<style scoped>
.markdown-table {
  display: contents;
}
</style>
