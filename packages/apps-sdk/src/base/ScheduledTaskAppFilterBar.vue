<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import { appIcon } from "@ontomato/platform-shell/icons";
import { useMemberData, useMemberParam, panelMemberKey } from "../panel/member";
import type { ScheduledTaskAppFilterItem } from "./scheduled-task-app-filter-types";

const props = defineProps<{
  /** Standalone counts in owner order. An empty key supplies the owner's total. */
  items?: readonly ScheduledTaskAppFilterItem[];
  /** Selected application key. An empty string or null represents all applications. */
  selected?: string | null;
  /** Number of application chips before the More menu (defaults to five). */
  maxVisible?: number;
}>();

const emit = defineEmits<{
  "update:selected": [key: string];
  select: [key: string];
}>();

const { t } = useI18n();
const member = inject(panelMemberKey, null)?.();
const counts = member?.projection.data?.counts ? useMemberData("counts") : null;
const selectedParam = member ? useMemberParam("selected") : null;
const chevron = appIcon("chevron-down");

const items = computed(() => props.items ?? (counts?.value.status === "ready"
  ? counts.value.value as unknown as readonly ScheduledTaskAppFilterItem[]
  : []));
const applications = computed(() => items.value.filter(({ key }) => key !== ""));
const total = computed(() => items.value.find(({ key }) => key === "") ?? {
  key: "",
  label: t("platformSchedules.filter.all"),
  count: applications.value.reduce((sum, { count }) => sum + count, 0),
});
const limit = computed(() => Math.max(0, props.maxVisible ?? Number(member?.projection.config?.maxVisible ?? 5)));
const visible = computed(() => [total.value, ...applications.value.slice(0, limit.value)]);
const overflow = computed(() => applications.value.slice(limit.value));
const standaloneSelection = ref("");
const selected = computed(() => {
  if (props.selected !== undefined) return props.selected ?? "";
  return selectedParam ? selectedParam.value.value ?? "" : standaloneSelection.value;
});
const selectedOverflow = computed(() => overflow.value.find(({ key }) => key === selected.value));

function select(key: string) {
  if (key === selected.value) return;
  if (selectedParam) selectedParam.set(key);
  else standaloneSelection.value = key;
  emit("update:selected", key);
  emit("select", key);
}
</script>

<template>
  <div class="sdk-scheduled-app-filter" role="group" :aria-label="t('platformSchedules.filter.label')">
    <button
      v-for="item in visible"
      :key="item.key"
      type="button"
      class="sdk-saf-chip"
      :class="{ 'is-active': item.key === selected }"
      :aria-pressed="item.key === selected"
      @click="select(item.key)"
    >
      <span>{{ item.label }}</span>
      <span class="sdk-saf-count">{{ item.count }}</span>
    </button>
    <ElDropdown
      v-if="overflow.length"
      trigger="click"
      :popper-options="dropdownBoundaryOptions"
      @command="select"
    >
      <button type="button" class="sdk-saf-chip" :class="{ 'is-active': selectedOverflow }">
        <span>{{ selectedOverflow?.label ?? t("common.more") }}</span>
        <span v-if="selectedOverflow" class="sdk-saf-count">{{ selectedOverflow.count }}</span>
        <component :is="chevron" :size="14" aria-hidden="true" />
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="item in overflow"
            :key="item.key"
            :command="item.key"
            :class="{ 'sdk-saf-overflow-selected': item.key === selected }"
            :aria-current="item.key === selected ? 'true' : undefined"
          >
            <span>{{ item.label }}</span>
            <span class="sdk-saf-count">{{ item.count }}</span>
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </div>
</template>

<style scoped>
.sdk-scheduled-app-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs, 6px);
}

.sdk-saf-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs, 6px);
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font: inherit;
  cursor: pointer;
}

.sdk-saf-chip:hover,
.sdk-saf-chip.is-active,
.sdk-saf-overflow-selected {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.sdk-saf-chip.is-active {
  border-color: var(--el-color-primary-light-5);
}

.sdk-saf-chip:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.sdk-saf-count {
  margin-inline-start: 2px;
  font-size: var(--text-xs, 12px);
  font-variant-numeric: tabular-nums;
  opacity: .8;
}
</style>
