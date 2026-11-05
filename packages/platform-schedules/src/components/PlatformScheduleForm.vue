<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import {
  SCHEDULED_TASK_PROMPT_MAX,
  platformTaskInputSchema,
  type PlatformTask,
  type PlatformTaskFrequency,
  type PlatformTaskFunctionTarget,
  type PlatformTaskInput,
} from "@ontomato/contracts/platform-schedules";
import { weekdayName } from "../frequency";
import type { Translate } from "../i18n";

/**
 * One task's definition: what it runs (an agent with a prompt, or a zero-parameter write function), how often, in
 * which zone, and whether to mail the result. The whole draft is validated with the contract's own input schema, so
 * the fields the service would refuse are the fields marked here.
 */
const props = defineProps<{
  /** null registers a new task. */
  task: PlatformTask | null;
  agents: readonly AgentHostAgent[];
  /** The service's function targets; empty when it offers none or this account may not schedule functions. */
  functions: readonly PlatformTaskFunctionTarget[];
  /** The account may not schedule functions at all: say so instead of "this domain has none". */
  functionsRefused?: boolean;
  /** The service's zone: a new task's default; an edited task keeps the zone it was saved with. */
  timeZone: string;
  /** The agent whose tasks the page is showing, preselected for a new task. */
  defaultAgentId?: string | null;
  /** The page's language, used to name weekdays. */
  locale: string;
  saving: boolean;
  /** The page's own text, so the form reads the same language as the list around it. */
  t: Translate;
}>();
const emit = defineEmits<{ submit: [input: PlatformTaskInput]; cancel: [] }>();

type Kind = PlatformTaskFrequency["kind"];
const initialTarget = props.task?.target;
const initialFrequency = props.task?.frequency;

function firstEnabledAgent() {
  return props.agents.find((agent) => agent.enabled)?.id ?? props.agents[0]?.id ?? "";
}

const form = reactive({
  name: props.task?.name ?? "",
  description: props.task?.description ?? "",
  target: (initialTarget?.kind ?? "agent") as "agent" | "function",
  agentId: initialTarget?.kind === "agent" ? initialTarget.agentId : (props.defaultAgentId ?? firstEnabledAgent()),
  prompt: initialTarget?.kind === "agent" ? initialTarget.prompt : "",
  functionId: initialTarget?.kind === "function" ? initialTarget.functionId : (props.functions[0]?.id ?? ""),
  kind: (initialFrequency?.kind ?? "daily") as Kind,
  every: initialFrequency?.kind === "interval" ? initialFrequency.every : 1,
  unit: initialFrequency?.kind === "interval" ? initialFrequency.unit : ("hour" as "minute" | "hour" | "day"),
  time: initialFrequency && "time" in initialFrequency ? initialFrequency.time : "09:00",
  weekday: initialFrequency?.kind === "weekly" ? initialFrequency.weekday : 1,
  day: initialFrequency?.kind === "monthly" ? initialFrequency.day : 1,
  expression: initialFrequency?.kind === "cron" ? initialFrequency.expression : "0 0 9 * * *",
  timeZone: props.task?.timeZone ?? props.timeZone,
  mail: Boolean(props.task?.notifyEmail),
  email: props.task?.notifyEmail ?? "",
  enabled: props.task?.enabled ?? true,
});
const attempted = ref(false);

const frequency = computed<PlatformTaskFrequency>(() => {
  switch (form.kind) {
    case "interval":
      return { kind: "interval", every: form.every, unit: form.unit };
    case "daily":
      return { kind: "daily", time: form.time };
    case "weekly":
      return { kind: "weekly", weekday: form.weekday, time: form.time };
    case "monthly":
      return { kind: "monthly", day: form.day, time: form.time };
    case "cron":
      return { kind: "cron", expression: form.expression };
  }
  throw new Error(`unknown frequency ${form.kind}`);
});

const draft = computed(() => ({
  name: form.name,
  description: form.description.trim() ? form.description : null,
  target:
    form.target === "agent"
      ? { kind: "agent" as const, agentId: form.agentId, prompt: form.prompt }
      : { kind: "function" as const, functionId: form.functionId },
  frequency: frequency.value,
  timeZone: form.timeZone,
  notifyEmail: form.mail ? form.email : null,
}));

const parsed = computed(() => platformTaskInputSchema.safeParse(draft.value));
const issues = computed(() => {
  const result = parsed.value;
  if (result.success) return { name: false, target: false, frequency: false, notifyEmail: false };
  const failed = (field: string) => result.error.issues.some((issue) => issue.path[0] === field);
  // Both targets fail on `target`: the agent fields or the function picker carries the message.
  return {
    name: failed("name"),
    target: failed("target"),
    frequency: failed("frequency"),
    notifyEmail: failed("notifyEmail"),
  };
});

const weekdays = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: weekdayName(value, props.locale) })),
);

/** The agent an existing task runs, if it runs one; a function task keeps no agent in its picker. */
const taskAgentId = initialTarget?.kind === "agent" ? initialTarget.agentId : null;

/** A disabled agent stays listed while an existing task uses it, so the task opens with its own agent in view. */
const selectableAgents = computed(() =>
  props.agents.filter((agent) => agent.enabled || agent.id === taskAgentId),
);

const frequencyHint = computed(() => {
  switch (form.kind) {
    case "interval":
      return props.t("form.intervalHint");
    case "cron":
      return props.t("form.cronHint");
    case "monthly":
      return `${props.t("form.monthEndHint")} ${props.t("form.timeZoneHint", { zone: form.timeZone })}`;
    default:
      return props.t("form.timeZoneHint", { zone: form.timeZone });
  }
});

/** Suggested zones; the field still accepts any IANA name. The browser's own zone comes first. */
const timeZones = (() => {
  const suggested = [
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "UTC",
  ];
  const local = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([local, ...suggested].filter(Boolean))];
})();

function submit() {
  attempted.value = true;
  if (parsed.value.success) emit("submit", parsed.value.data);
}
</script>

<template>
  <el-form class="task-form" label-position="top" @submit.prevent="submit">
    <el-form-item :label="t('form.name')" :error="attempted && issues.name ? t('form.nameRequired') : ''">
      <el-input v-model="form.name" :placeholder="t('form.namePlaceholder')" maxlength="120" />
    </el-form-item>
    <el-form-item :label="t('form.description')">
      <el-input
        v-model="form.description"
        type="textarea"
        :rows="2"
        :placeholder="t('form.descriptionPlaceholder')"
      />
    </el-form-item>

    <el-form-item :label="t('form.whatRuns')">
      <el-segmented
        v-model="form.target"
        :options="[
          { label: t('app.agents'), value: 'agent' },
          { label: t('app.ontology'), value: 'function' },
        ]"
      />
    </el-form-item>

    <template v-if="form.target === 'agent'">
      <el-form-item :label="t('form.agent')" :error="attempted && issues.target ? t('form.agentRequired') : ''">
        <el-select v-model="form.agentId" :placeholder="t('form.agent')" filterable>
          <el-option
            v-for="agent in selectableAgents"
            :key="agent.id"
            :value="agent.id"
            :label="agent.name"
            :disabled="!agent.enabled"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('form.prompt')" :error="attempted && issues.target ? t('form.promptRequired') : ''">
        <el-input
          v-model="form.prompt"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 10 }"
          :maxlength="SCHEDULED_TASK_PROMPT_MAX"
          show-word-limit
          :placeholder="t('form.promptPlaceholder')"
        />
      </el-form-item>
    </template>

    <el-form-item
      v-else
      :label="t('form.function')"
      :error="attempted && issues.target ? t('form.functionRequired') : ''"
    >
      <el-select
        v-model="form.functionId"
        :placeholder="functions.length ? t('form.function') : t(functionsRefused ? 'form.functionsRefused' : 'form.noFunctions')"
        :disabled="functions.length === 0"
        filterable
      >
        <el-option v-for="fn in functions" :key="fn.id" :value="fn.id" :label="fn.name">
          <span>{{ fn.name }}</span>
          <span v-if="fn.description" class="option-hint">{{ fn.description }}</span>
        </el-option>
      </el-select>
      <p class="hint">{{ t(functionsRefused ? 'form.functionsRefusedHint' : 'form.functionHint') }}</p>
    </el-form-item>

    <el-form-item :label="t('form.frequency')" :error="attempted && issues.frequency ? t('form.frequencyInvalid') : ''">
      <div class="frequency">
        <el-select v-model="form.kind" class="kind">
          <el-option value="interval" :label="t('form.kind.interval')" />
          <el-option value="daily" :label="t('form.kind.daily')" />
          <el-option value="weekly" :label="t('form.kind.weekly')" />
          <el-option value="monthly" :label="t('form.kind.monthly')" />
          <el-option value="cron" :label="t('form.kind.cron')" />
        </el-select>
        <template v-if="form.kind === 'interval'">
          <el-input-number
            v-model="form.every"
            class="number"
            :min="1"
            :max="1000"
            :step="1"
            step-strictly
            controls-position="right"
          />
          <el-select v-model="form.unit" class="unit">
            <el-option value="minute" :label="t('form.unit.minute')" />
            <el-option value="hour" :label="t('form.unit.hour')" />
            <el-option value="day" :label="t('form.unit.day')" />
          </el-select>
        </template>
        <el-select v-if="form.kind === 'weekly'" v-model="form.weekday" class="unit">
          <el-option v-for="day in weekdays" :key="day.value" :value="day.value" :label="day.label" />
        </el-select>
        <el-input-number
          v-if="form.kind === 'monthly'"
          v-model="form.day"
          class="number"
          :min="1"
          :max="31"
          :step="1"
          step-strictly
          controls-position="right"
        />
        <el-time-select
          v-if="form.kind === 'daily' || form.kind === 'weekly' || form.kind === 'monthly'"
          v-model="form.time"
          class="time"
          start="00:00"
          end="23:55"
          step="00:05"
          :clearable="false"
        />
        <el-input
          v-if="form.kind === 'cron'"
          v-model="form.expression"
          class="cron"
          :placeholder="t('form.cronPlaceholder')"
        />
      </div>
      <p class="hint">{{ frequencyHint }}</p>
    </el-form-item>

    <el-form-item :label="t('form.timeZone')">
      <el-select v-model="form.timeZone" filterable allow-create class="zone">
        <el-option v-for="zone in timeZones" :key="zone" :value="zone" :label="zone" />
      </el-select>
    </el-form-item>

    <el-form-item :error="attempted && issues.notifyEmail ? t('form.emailInvalid') : ''">
      <div class="mail">
        <el-switch v-model="form.mail" :active-text="t('form.notify')" />
        <el-input
          v-if="form.mail"
          v-model="form.email"
          type="email"
          autocomplete="email"
          :placeholder="t('form.notifyEmail')"
        />
      </div>
    </el-form-item>

    <el-form-item v-if="!task">
      <el-switch v-model="form.enabled" :active-text="t('form.createEnabled')" />
    </el-form-item>

    <footer class="actions">
      <el-button @click="emit('cancel')">{{ t('form.cancel') }}</el-button>
      <el-button type="primary" native-type="submit" :loading="saving">
        {{ task ? t('form.save') : t('form.create') }}
      </el-button>
    </footer>
  </el-form>
</template>

<style scoped>
.task-form {
  display: flex;
  flex-direction: column;
}
.frequency {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  width: 100%;
}
.kind {
  width: 150px;
}
.unit {
  width: 140px;
}
.number {
  width: 110px;
}
.time {
  width: 130px;
}
.cron {
  width: 200px;
}
.zone {
  width: 100%;
}
.hint {
  width: 100%;
  margin: var(--spacing-xs) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.mail {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
}
.option-hint {
  margin-left: var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-sm);
}
</style>
