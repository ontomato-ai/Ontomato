<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { AgentExecutionOptions } from "@ontomato/contracts/assistant-chat";
import { agentDefinitionsApi } from "../api";

/**
 * Whose permissions the agent runs with: the reader's own (null), or one member of this domain. Only a domain governance
 * administrator may change it; everyone else reads the reference it holds.
 *
 * The identity service answers in one call: the members an administrator may choose from, and — for whoever may read the
 * settings — the referenced member itself, by name and whether it is still usable. So a reference is never judged by
 * whether it fell inside a page of the member list: the server says what it is, and a member who has been disabled,
 * deleted or removed from the domain keeps its value with the reason it cannot run, instead of being cleared.
 */
const model = defineModel<string | null>({ required: true });
const props = defineProps<{
  /** The agent as the owner stores it; a new agent has none and starts with the reader's own permissions. */
  stored: string | null;
  disabled: boolean;
}>();
const { t } = useI18n();

const options = ref<AgentExecutionOptions>({ canSetExecutionUser: false, users: [] });
const keyword = ref("");
const busy = ref(false);
const failure = ref<string | null>(null);
onMounted(() => void read(""));
watch(keyword, (value) => void read(value));

async function read(search: string) {
  busy.value = true;
  failure.value = null;
  try {
    options.value = await agentDefinitionsApi.executionOptions(search, props.stored);
  } catch (error) {
    // The domain's answer, in its own words: "the member is not in this domain" is not the same page as "unreachable".
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

/** Whether the reader may change the reference at all; the editor sends the field only then. */
defineExpose({ canSet: computed(() => options.value.canSetExecutionUser) });

const selected = computed(() => options.value.selected ?? null);
const chosenName = computed(() => selected.value?.name ?? options.value.users.find((user) => user.id === model.value)?.name ?? null);
const own = computed(() => t("agents.executionOwn"));
/** The server's verdict on the stored reference: unavailable, and by which of its codes. */
const unavailable = computed(() => selected.value !== null && !selected.value.available);
const reason = computed(() =>
  selected.value?.reason ? t(`agents.executionReason.${selected.value.reason}`) : t("agents.executionReasonUnknown"),
);
</script>

<template>
  <div class="execution-setting">
    <el-select
      v-if="options.canSetExecutionUser"
      v-model="model"
      filterable
      remote
      clearable
      :remote-method="(value: string) => (keyword = value)"
      :loading="busy"
      :disabled="disabled"
      :aria-label="t('agents.executionUser')"
      :placeholder="own"
      class="execution-select"
    >
      <el-option :label="own" :value="null" />
      <el-option v-for="user in options.users" :key="user.id" :label="user.name" :value="user.id" />
      <!-- The referenced member stays choosable even when the list's page does not reach it. -->
      <el-option v-if="selected && !options.users.some((user) => user.id === selected!.id)" :label="selected.name" :value="selected.id" />
    </el-select>
    <p v-else class="execution-read">{{ chosenName ?? model ?? own }}</p>
    <p v-if="failure" class="execution-unavailable" role="alert">
      {{ t("agents.executionOptionsFailed") }} {{ failure }}
      <el-button size="small" link type="primary" @click="read(keyword)">{{ t("common.retry") }}</el-button>
    </p>
    <p v-else-if="unavailable" class="execution-unavailable" role="alert">
      {{ t("agents.executionUnavailable", { name: chosenName ?? model, reason }) }}
    </p>
    <p v-else-if="!options.canSetExecutionUser" class="execution-hint">{{ t("agents.executionReadOnly") }}</p>
  </div>
</template>

<style scoped>
.execution-setting {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 480px;
}
.execution-select {
  width: 100%;
}
.execution-read {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.execution-hint,
.execution-unavailable {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.execution-unavailable {
  color: var(--el-color-warning);
}
</style>
