<script setup lang="ts">
import { usePageDockSpace } from "../context";

/**
 * Where a page's content ends, where the `shell-dock-room` class cannot reach: the trailing item of a container that
 * spaces its children with `gap`, an `el-table`'s `append` slot, or under a bar fixed to the page's foot. The room is
 * the shell's stylesheet's (`shell-dock-room-end`, the same measured height); this leaves the element out while the pane
 * measures none, so a `gap` does not leave a slot for it beside the conversation.
 */
const space = usePageDockSpace();
</script>

<template>
  <div v-if="space > 0" class="shell-dock-room-end" aria-hidden="true" />
</template>
