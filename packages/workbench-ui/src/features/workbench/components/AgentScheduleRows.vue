<script setup lang="ts">
import { Calendar } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { PlatformTask } from "@ontomato/contracts/platform-schedules";
import { scheduledTaskFrequencyText } from "@ontomato/platform-schedules/panel-text";

defineProps<{
  tasks: readonly PlatformTask[];
  selectedId: string | null;
  agentNames?: ReadonlyMap<string, string>;
}>();
const emit = defineEmits<{ select: [task: PlatformTask] }>();
const { t, locale } = useI18n();
</script>

<template>
  <ul class="agent-schedule-list">
    <li v-for="task in tasks" :key="task.id">
      <div class="session-item" :class="{ active: selectedId === task.id }">
        <button type="button" class="session-open agent-schedule-open" :title="task.title"
          :aria-current="selectedId === task.id ? 'page' : undefined" @click="emit('select', task)">
          <strong class="session-title">{{ task.title }}</strong>
          <span class="history-list-meta">
            <span v-if="agentNames && task.targetKind === 'application' && task.content.agentId">
              {{ agentNames.get(task.content.agentId) || t('scheduledTasks.unavailableAgent') }} ·
            </span>
            <Calendar :size="12" aria-hidden="true" />
            {{ scheduledTaskFrequencyText(task.frequency, locale, t) }}
            <span v-if="!task.enabled" class="agent-schedule-status">{{ t('platformSchedules.panelFields.stateOff') }}</span>
            <span v-else-if="task.pause" class="agent-schedule-status" data-status="paused">{{ t('platformSchedules.panelFields.statePaused') }}</span>
            <span v-else class="agent-schedule-status" data-status="scheduled">{{ t('platformSchedules.card.scheduled') }}</span>
          </span>
        </button>
      </div>
    </li>
  </ul>
</template>
