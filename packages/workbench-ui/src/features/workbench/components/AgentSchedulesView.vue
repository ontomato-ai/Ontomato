<script setup lang="ts">
import { PlatformSchedulesPage } from "@ontomato/platform-schedules";
import { useI18n } from "vue-i18n";
import { schedulesHost } from "../../../utils/schedules-host";

/**
 * The agent platform's scheduled tasks: the platform's one list, limited to the agent this application is showing.
 *
 * The list is the same component the scheduled-tasks application shows, so a task looks and behaves the same wherever it
 * is read; this view only narrows it to one agent and supplies the platform's request layer.
 */
const props = defineProps<{ agentId: string | null }>();
const emit = defineEmits<{ openSession: [sessionId: string] }>();
const { locale } = useI18n();

/** The same host the platform's own scheduled-tasks page reads through, with this view's way of opening a run. */
const host = schedulesHost({
  openSession: (sessionId) => emit("openSession", sessionId),
  locale: () => locale.value,
});
</script>

<template>
  <PlatformSchedulesPage :host="host" :agent-id="props.agentId" @open-session="emit('openSession', $event)" />
</template>
