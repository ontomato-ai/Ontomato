<script setup lang="ts">
import { computed } from "vue";
import { ElTooltip } from "element-plus/es/components/tooltip/index";

/**
 * Surfaces an operation's owner-supplied unavailable reason in the platform tooltip (`ElTooltip` / `<sdk-tooltip>`).
 * Wraps the disabled control in a keyboard-focusable trigger only while a reason is present so hover and Tab focus
 * both reveal the tooltip without adding wrapper DOM when the operation is available.
 */
const props = withDefaults(
  defineProps<{
    reason?: string;
    label?: string;
    placement?: "top" | "bottom" | "left" | "right";
    block?: boolean;
  }>(),
  {
    reason: undefined,
    label: undefined,
    placement: "top",
    block: false,
  },
);

const tooltipContent = computed(() => props.reason?.trim() || undefined);
</script>

<template>
  <el-tooltip
    v-if="tooltipContent"
    :content="tooltipContent"
    :trigger="['hover', 'focus']"
    :placement="placement"
  >
    <span
      class="sdk-unavailable-trigger"
      :class="{ 'is-block': block }"
      tabindex="0"
      :aria-label="label ? `${label}: ${tooltipContent}` : tooltipContent"
    >
      <slot />
    </span>
  </el-tooltip>
  <slot v-else />
</template>

<style scoped>
.sdk-unavailable-trigger {
  display: inline-flex;
  align-items: center;
  cursor: not-allowed;
  border-radius: var(--el-border-radius-base, 4px);
}
.sdk-unavailable-trigger.is-block {
  display: flex;
  width: 100%;
}
.sdk-unavailable-trigger:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.sdk-unavailable-trigger > :deep(:disabled),
.sdk-unavailable-trigger > :deep(.is-disabled) {
  pointer-events: none;
}
</style>
