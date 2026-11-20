<script setup lang="ts">
import { ElTooltip } from "element-plus";
import { actionTooltipProps } from "./action-tooltip";

/**
 * A short label on an icon-only control, with the platform's timing and spacing. Packages that may not depend on the
 * component library (the agent shell) reach the library's tooltip through this one.
 */
defineProps<{ content: string }>();
</script>

<template>
  <ElTooltip v-bind="actionTooltipProps" :content="content"><slot /></ElTooltip>
</template>
