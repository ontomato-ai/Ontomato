<template>
  <div class="skill-selector">
    <AgentConfigurationHeader class="skill-selector-toolbar" :title="title || ''" :hint="hint" :count="title ? selectedSkills.length : undefined">
      <template #icon><slot name="icon" /></template>
    </AgentConfigurationHeader>
    <el-alert
      v-if="loadError"
      :title="`${t('admin.skillLoadFailed')}${detailSeparator}${loadError}`"
      type="error"
      show-icon
      :closable="false"
    />
    <div v-loading="loading" class="skill-list">
      <div
        v-for="skill in displayedSkills"
        :key="runtimeSkillKey(skill.skill)"
        class="skill-card"
        :class="{ selected: isSelected(skill.skill) }"
        @click="toggleSkill(skill.skill)"
      >
        <div class="skill-header">
          <div class="skill-title-row">
            <div class="skill-title">{{ skill.title || skill.skill.name }}</div>
            <el-tag v-if="skill.unavailable" size="small" type="warning">
              {{ t("assistant.unavailable") }}
            </el-tag>
          </div>
          <el-checkbox
            :model-value="isSelected(skill.skill)"
            @click.stop="toggleSkill(skill.skill)"
          />
        </div>
        <div v-if="skill.description" class="skill-description">
          {{ skill.description }}
        </div>
        <div v-if="skill.tags && skill.tags.length > 0" class="skill-tags">
          <el-tag v-for="tag in skill.tags" :key="tag" size="small" type="info">
            {{ tag }}
          </el-tag>
        </div>
      </div>

      <el-empty
        v-if="!loading && !loadError && displayedSkills.length === 0"
        :image-size="48"
        :description="t('admin.noAvailableSkills')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { agentDefinitionsApi } from "../api";
import type { AssistantSkillOption } from "@ontomato/contracts/assistant-chat";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import AgentConfigurationHeader from "./AgentConfigurationHeader.vue";
import { useI18n } from "vue-i18n";
import { errorPunctuation } from "../../../utils/error-punctuation";

const { detailSeparator } = errorPunctuation();

const { t } = useI18n();

const props = defineProps<{
  modelValue?: RuntimeSkillRef[];
  title?: string;
  hint?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: RuntimeSkillRef[]];
  ready: [value: boolean];
}>();

const skills = ref<AssistantSkillOption[]>([]);
const selectedSkills = ref<RuntimeSkillRef[]>([]);
const loadError = ref("");
const loading = ref(false);
const displayedSkills = computed(() => {
  // Until the catalogue arrives, nothing can be judged unavailable.
  if (loading.value) return [];
  const available = new Set(skills.value.map((item) => runtimeSkillKey(item.skill)));
  return [
    ...skills.value.map((item) => ({ ...item, unavailable: false })),
    ...selectedSkills.value
      .filter((skill) => !available.has(runtimeSkillKey(skill)))
      .map((skill) => ({ skill, title: skill.name, description: "", tags: [], unavailable: true })),
  ];
});

// One list for the agent: analysis and visualization skills alike.
async function loadSkills() {
  loading.value = true;
  emit("ready", false);
  try {
    loadError.value = "";
    skills.value = await agentDefinitionsApi.skills();
    emit("ready", true);
  } catch (error) {
    skills.value = [];
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function isSelected(skill: RuntimeSkillRef) {
  return selectedSkills.value.some((item) => runtimeSkillKey(item) === runtimeSkillKey(skill));
}
function toggleSkill(skill: RuntimeSkillRef) {
  const key = runtimeSkillKey(skill);
  const index = selectedSkills.value.findIndex((item) => runtimeSkillKey(item) === key);
  selectedSkills.value = index >= 0
    ? selectedSkills.value.filter((item) => runtimeSkillKey(item) !== key)
    : [...selectedSkills.value, skill];
  emit("update:modelValue", selectedSkills.value);
}

// Watch external value changes
watch(
  () => props.modelValue,
  (newValue) => {
    selectedSkills.value = [...(newValue ?? [])];
  },
  { immediate: true }
);

// Initialize
loadSkills();
</script>

<style scoped>
.skill-selector {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.skill-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: var(--spacing-sm);
  min-height: 48px;
}
.skill-list > .el-empty { grid-column: 1 / -1; padding: 16px 0; }

.skill-card {
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.skill-card:hover {
  border-color: var(--el-color-primary-light-7);
  box-shadow: var(--el-shadow-sm);
}

.skill-card.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs);
}

.skill-title {
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.skill-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.skill-description {
  overflow-wrap: anywhere;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: var(--spacing-sm);
  line-height: 1.5;
}

.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
