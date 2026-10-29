<script setup lang="ts">
import type { Slot } from "vue";

/** Renders a host slot captured by the shell at a nested position. */
const props = defineProps<{ content?: Slot; scope: Record<string, unknown> }>();
const render = () => props.content?.(props.scope);
</script>

<template>
  <component :is="render" v-if="content" />
</template>
