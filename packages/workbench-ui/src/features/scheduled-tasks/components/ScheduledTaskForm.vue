<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import {
  SCHEDULED_TASK_PROMPT_MAX,
  scheduledTaskInputSchema,
  type ScheduledTask,
  type ScheduledTaskFrequency,
  type ScheduledTaskInput,
} from "@ontomato/contracts/scheduled-tasks";
import { weekdayName } from "../frequency";

/** Registering a task takes a prompt, an agent and a frequency; mail is optional. */
const props = defineProps<{
  /** null registers a new task. */
  task: ScheduledTask | null;
  agents: AgentHostAgent[];
  timeZone: string;
  saving: boolean;
}>();
const emit = defineEmits<{ submit: [input: ScheduledTaskInput]; cancel: [] }>();
const { t, locale } = useI18n();

type Kind = ScheduledTaskFrequency["kind"];
const initial = props.task?.frequency;
const form = reactive({
  prompt: props.task?.prompt ?? "",
  agentId: props.task?.agentId ?? props.agents.find((agent) => agent.enabled)?.id ?? "",
  kind: (initial?.kind ?? "daily") as Kind,
  every: initial?.kind === "interval" ? initial.every : 1,
  unit: initial?.kind === "interval" ? initial.unit : ("hour" as "minute" | "hour" | "day"),
  time: initial && initial.kind !== "interval" ? initial.time : "09:00",
  weekday: initial?.kind === "weekly" ? initial.weekday : 1,
  day: initial?.kind === "monthly" ? initial.day : 1,
  mail: Boolean(props.task?.notifyEmail),
  email: props.task?.notifyEmail ?? "",
});
const attempted = ref(false);

const frequency = computed<ScheduledTaskFrequency>(() => {
  switch (form.kind) {
    case "interval":
      return { kind: "interval", every: form.every, unit: form.unit };
    case "daily":
      return { kind: "daily", time: form.time };
    case "weekly":
      return { kind: "weekly", weekday: form.weekday, time: form.time };
    case "monthly":
      return { kind: "monthly", day: form.day, time: form.time };
  }
  throw new Error("unknown frequency");
});
const input = computed(() =>
  scheduledTaskInputSchema.safeParse({
    agentId: form.agentId,
    prompt: form.prompt,
    frequency: frequency.value,
    notifyEmail: form.mail ? form.email : null,
  }),
);
const issues = computed(() => {
  const paths = new Set(input.value.success ? [] : input.value.error.issues.map((issue) => String(issue.path[0])));
  return { prompt: paths.has("prompt"), agentId: paths.has("agentId"), frequency: paths.has("frequency"), notifyEmail: paths.has("notifyEmail") };
});
const weekdays = computed(() => [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: weekdayName(value, locale.value) })));
const frequencyHint = computed(() =>
  form.kind === "interval"
    ? t("scheduledTasks.intervalHint")
    : [form.kind === "monthly" ? t("scheduledTasks.monthEndHint") : "", t("scheduledTasks.timeZoneHint", { zone: props.timeZone })]
        .filter(Boolean)
        .join(" "),
);
const selectableAgents = computed(() =>
  props.agents.filter((agent) => agent.enabled || agent.id === props.task?.agentId),
);

function submit() {
  attempted.value = true;
  if (input.value.success) emit("submit", input.value.data);
}
</script>

<template>
  <el-form class="task-form" label-position="top" @submit.prevent="submit">
    <el-form-item
      :label="t('scheduledTasks.prompt')"
      :error="attempted && issues.prompt ? t('scheduledTasks.promptRequired') : ''"
    >
      <el-input
        v-model="form.prompt"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 10 }"
        :maxlength="SCHEDULED_TASK_PROMPT_MAX"
        :placeholder="t('scheduledTasks.promptPlaceholder')"
      />
    </el-form-item>
    <el-form-item
      :label="t('scheduledTasks.agent')"
      :error="attempted && issues.agentId ? t('scheduledTasks.agentRequired') : ''"
    >
      <el-select v-model="form.agentId" :placeholder="t('scheduledTasks.agent')">
        <el-option
          v-for="agent in selectableAgents"
          :key="agent.id"
          :value="agent.id"
          :label="agent.name"
          :disabled="!agent.enabled"
        />
      </el-select>
    </el-form-item>
    <el-form-item :label="t('scheduledTasks.frequency')">
      <div class="frequency">
        <el-select v-model="form.kind" class="kind">
          <el-option value="interval" :label="t('scheduledTasks.kind.interval')" />
          <el-option value="daily" :label="t('scheduledTasks.kind.daily')" />
          <el-option value="weekly" :label="t('scheduledTasks.kind.weekly')" />
          <el-option value="monthly" :label="t('scheduledTasks.kind.monthly')" />
        </el-select>
        <template v-if="form.kind === 'interval'">
          <el-input-number v-model="form.every" :min="1" :max="1000" :step="1" step-strictly controls-position="right" />
          <el-select v-model="form.unit" class="unit">
            <el-option value="minute" :label="t('scheduledTasks.unit.minute')" />
            <el-option value="hour" :label="t('scheduledTasks.unit.hour')" />
            <el-option value="day" :label="t('scheduledTasks.unit.day')" />
          </el-select>
        </template>
        <el-select v-if="form.kind === 'weekly'" v-model="form.weekday" class="unit">
          <el-option v-for="day in weekdays" :key="day.value" :value="day.value" :label="day.label" />
        </el-select>
        <el-input-number
          v-if="form.kind === 'monthly'"
          v-model="form.day"
          :min="1"
          :max="31"
          :step="1"
          step-strictly
          controls-position="right"
        />
        <el-time-select
          v-if="form.kind !== 'interval'"
          v-model="form.time"
          class="time"
          start="00:00"
          end="23:55"
          step="00:05"
          :clearable="false"
        />
      </div>
      <p class="hint">{{ frequencyHint }}</p>
    </el-form-item>
    <el-form-item :error="attempted && issues.notifyEmail ? t('scheduledTasks.emailInvalid') : ''">
      <div class="mail">
        <el-switch v-model="form.mail" :active-text="t('scheduledTasks.mail')" />
        <el-input
          v-if="form.mail"
          v-model="form.email"
          type="email"
          autocomplete="email"
          :placeholder="t('scheduledTasks.emailPlaceholder')"
        />
      </div>
    </el-form-item>
    <footer class="actions">
      <el-button @click="emit('cancel')">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" native-type="submit" :loading="saving">
        {{ task ? t("common.save") : t("scheduledTasks.create") }}
      </el-button>
    </footer>
  </el-form>
</template>

<style scoped>
.frequency {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.kind {
  width: 140px;
}
.unit {
  width: 140px;
}
.time {
  width: 130px;
}
.hint {
  width: 100%;
  margin: 6px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.mail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
</style>
