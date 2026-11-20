<script setup lang="ts">
import type { Component } from "vue";
import { ElTooltip } from "element-plus";
import { LoaderCircle } from "lucide-vue-next";
import { actionTooltipProps } from "@ontomato/foundation-ui/overlay";

defineOptions({ inheritAttrs: false });
defineProps<{ icon: Component; label: string; disabled?: boolean; loading?: boolean; danger?: boolean }>();
</script>

<template>
  <ElTooltip v-bind="actionTooltipProps" :content="label">
    <button v-bind="$attrs" type="button" class="manager-icon-button" :class="{ 'is-danger': danger }" :aria-label="label"
      :disabled="disabled || loading" :aria-busy="loading || undefined">
      <component :is="loading ? LoaderCircle : icon" :class="{ 'manager-icon-spinner': loading }" :size="16" aria-hidden="true" />
    </button>
  </ElTooltip>
</template>
