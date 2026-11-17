<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { AgentExecutionOptions } from "@ontomato/contracts/assistant-chat";
import { agentDefinitionsApi } from "../api";

/**
 * Whose permissions the agent runs with: the reader's own (null), or one member of this domain. Only a domain governance
 * administrator may change it; everyone else reads the reference it holds. The options come from the domain's own
 * identity service, which answers `canSetExecutionUser` and, for an administrator, the members to choose from. A
 * reference that is no longer a usable member keeps its value: the page shows it, names why it cannot be used, and lets
 * an administrator correct it rather than silently clearing it.
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
const failed = ref(false);
onMounted(() => void read(""));
watch(keyword, (value) => void read(value));

async function read(search: string) {
  busy.value = true;
  failed.value = false;
  try {
    options.value = await agentDefinitionsApi.executionOptions(search);
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

/** Whether the reader may change the reference at all; the editor sends the field only then. */
defineExpose({ canSet: computed(() => options.value.canSetExecutionUser) });

/**
 * The chosen member's name; a reader without the permission is offered no members, so they read the reference by its ID
 * rather than being told it is unavailable. Only an administrator's empty list means the member is no longer usable.
 */
const chosenName = computed(() => options.value.users.find((user) => user.id === model.value)?.name ?? null);
const unavailable = computed(
  () => options.value.canSetExecutionUser && model.value !== null && chosenName.value === null && model.value === props.stored,
);
const own = computed(() => t("agents.executionOwn"));
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
    </el-select>
    <p class="execution-read">
      <template v-if="options.canSetExecutionUser">{{ chosenName ?? own }}</template>
      <template v-else>{{ chosenName ?? model ?? own }}</template>
    </p>
    <p v-if="failed" class="execution-unavailable" role="alert">
      {{ t("agents.executionOptionsFailed") }}
      <el-button size="small" link type="primary" @click="read(keyword)">{{ t("common.retry") }}</el-button>
    </p>
    <p v-else-if="unavailable" class="execution-unavailable" role="alert">
      {{ t("agents.executionUnavailable", { id: model }) }}
    </p>
    <p v-else-if="!options.canSetExecutionUser" class="execution-hint">{{ t("agents.executionReadOnly") }}</p>
    <p v-else class="execution-hint">{{ t("agents.executionHint") }}</p>
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
