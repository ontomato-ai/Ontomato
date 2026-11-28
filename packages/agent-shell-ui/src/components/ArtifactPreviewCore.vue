<script setup lang="ts">
import { computed } from "vue";
import type { DisplayLoad } from "@ontomato/contracts/agent-presentation";
import type { OpenArtifact } from "../types";
import ShellSidePanel from "./ShellSidePanel.vue";

/**
 * Shared artifact preview trail core rendered by both `AgentShell` and standalone `AgentArtifactPreview`.
 * Keeps each ancestor mounted while hidden so navigating back restores previous view state.
 */
const props = withDefaults(
  defineProps<{
    trail: readonly OpenArtifact[];
    visible?: boolean;
    inline?: boolean;
    showHeader?: boolean;
  }>(),
  {
    visible: true,
    inline: false,
    showHeader: true,
  },
);

const emit = defineEmits<{
  close: [key: string];
  loaded: [key: string, load: DisplayLoad];
}>();

const activeKey = computed(() => props.trail.at(-1)?.key ?? null);
</script>

<template>
  <ShellSidePanel
    v-for="(artifact, index) in trail"
    v-show="visible && artifact.key === activeKey"
    :key="artifact.key"
    :open="artifact"
    :back="index > 0"
    :inline="inline"
    :show-header="showHeader"
    @close="emit('close', artifact.key)"
    @loaded="emit('loaded', artifact.key, $event)"
  />
</template>
