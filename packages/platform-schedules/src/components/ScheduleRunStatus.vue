<script setup lang="ts">
import type { PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import { useScheduleText } from "../text";

defineProps<{ status: PlatformTaskRun["status"] }>();
const { runStatus } = useScheduleText();
const types = { completed: "success", failed: "danger", running: "primary", skipped: "info" } as const;
</script>

<template>
  <el-tag :type="types[status]" size="small" disable-transitions>{{ runStatus(status) }}</el-tag>
</template>
