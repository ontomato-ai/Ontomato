<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import { moved } from "./items";

/**
 * Which of the reader's dashboards the home shows, and in which order. Removing one here only takes it off the home;
 * the dashboard itself is created, renamed and deleted in the dashboards application.
 */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  /** The reader's dashboards. */
  dashboards: readonly DashboardListItem[];
  /** The ones the home shows now, in tab order. */
  shown: readonly string[];
  saving: boolean;
}>();
const emit = defineEmits<{ save: [ids: string[]] }>();
const { t } = useI18n();

const draft = ref<string[]>([]);
watch(open, (value) => { if (value) draft.value = [...props.shown]; }, { immediate: true });

const byId = computed(() => new Map(props.dashboards.map((dashboard) => [dashboard.id, dashboard])));
const chosen = computed(() => draft.value.map((id) => byId.value.get(id)!));
const others = computed(() => props.dashboards.filter((dashboard) => !draft.value.includes(dashboard.id)));
</script>

<template>
  <el-dialog v-model="open" :title="t('home.dashboardPicker.title')" width="560px" append-to-body>
    <p v-if="dashboards.length === 0" class="picker-empty">{{ t('home.dashboardPicker.none') }}</p>
    <template v-else>
      <section class="picker-section">
        <h3 class="picker-heading">{{ t('home.dashboardPicker.shown') }}</h3>
        <p v-if="chosen.length === 0" class="picker-empty">{{ t('home.dashboardPicker.nothingShown') }}</p>
        <ol v-else class="picker-list">
          <li v-for="(dashboard, index) in chosen" :key="dashboard.id" class="picker-row">
            <span class="picker-name">{{ dashboard.name }}</span>
            <el-button
              text
              size="small"
              :disabled="index === 0"
              :aria-label="t('home.moveEarlier', { name: dashboard.name })"
              :title="t('home.moveEarlier', { name: dashboard.name })"
              @click="draft = moved(draft, index, index - 1)"
            >
              <ArrowUp :size="14" aria-hidden="true" />
            </el-button>
            <el-button
              text
              size="small"
              :disabled="index === chosen.length - 1"
              :aria-label="t('home.moveLater', { name: dashboard.name })"
              :title="t('home.moveLater', { name: dashboard.name })"
              @click="draft = moved(draft, index, index + 1)"
            >
              <ArrowDown :size="14" aria-hidden="true" />
            </el-button>
            <el-button text size="small" @click="draft = draft.filter((id) => id !== dashboard.id)">
              <X :size="14" aria-hidden="true" />
              <span>{{ t('home.dashboardPicker.remove') }}</span>
            </el-button>
          </li>
        </ol>
      </section>
      <section v-if="others.length > 0" class="picker-section">
        <h3 class="picker-heading">{{ t('home.dashboardPicker.available') }}</h3>
        <ul class="picker-list">
          <li v-for="dashboard in others" :key="dashboard.id" class="picker-row">
            <span class="picker-name">{{ dashboard.name }}</span>
            <el-button text size="small" @click="draft = [...draft, dashboard.id]">
              <Plus :size="14" aria-hidden="true" />
              <span>{{ t('home.dashboardPicker.add') }}</span>
            </el-button>
          </li>
        </ul>
      </section>
    </template>
    <template #footer>
      <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="dashboards.length === 0" @click="emit('save', draft)">
        {{ t('common.save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.picker-section + .picker-section {
  margin-top: var(--spacing-lg);
}
.picker-heading {
  margin: 0 0 var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-xs);
}
.picker-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
}
.picker-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-height: var(--table-row-height);
  padding: 0 var(--spacing-sm) 0 var(--spacing-md);
}
.picker-row + .picker-row {
  border-top: 1px solid var(--el-border-color-lighter);
}
.picker-row .el-button + .el-button {
  margin-left: 0;
}
.picker-row .el-button span {
  margin-left: var(--spacing-xs);
}
.picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
</style>
