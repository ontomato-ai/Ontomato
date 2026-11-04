<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus, Search } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { ProviderDraft } from "../draft";

/** The providers of the draft as a list panel: search by name or ID, add, and choose the one shown on the right. */
const props = defineProps<{
  providers: readonly ProviderDraft[];
  selectedId: string | null;
}>();
const emit = defineEmits<{ select: [id: string]; add: [] }>();
const { t } = useI18n();

const query = ref("");
const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.providers;
  return props.providers.filter(
    (provider) => provider.id.toLowerCase().includes(text) || provider.name.toLowerCase().includes(text)
  );
});
</script>

<template>
  <aside class="provider-list" :aria-label="t('admin.modelProviders')">
    <div class="provider-list-tools">
      <el-input
        v-model="query"
        :prefix-icon="Search"
        :placeholder="t('admin.searchProviders')"
        :aria-label="t('admin.searchProviders')"
        clearable
      />
      <el-button :icon="Plus" :aria-label="t('admin.addProvider')" :title="t('admin.addProvider')" @click="emit('add')" />
    </div>
    <ul v-if="shown.length > 0" class="provider-rows">
      <li v-for="provider in shown" :key="provider.id">
        <button
          type="button"
          :class="['provider-row', { active: provider.id === props.selectedId }]"
          :aria-current="provider.id === props.selectedId ? 'true' : undefined"
          @click="emit('select', provider.id)"
        >
          <span class="provider-row-name">{{ provider.name || provider.id }}</span>
          <span class="provider-row-meta">
            <span class="mono">{{ provider.id }}</span>
            <span>{{ t("admin.providerModelCount", { n: provider.models.length }) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-else class="provider-list-empty">
      {{ props.providers.length === 0 ? t("admin.noProviders") : t("admin.noMatchingProviders") }}
    </p>
  </aside>
</template>

<style scoped>
.provider-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: var(--el-bg-color-page);
}

.provider-list-tools {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
}

.provider-list-tools .el-button {
  flex: 0 0 auto;
  margin: 0;
}

.provider-rows {
  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 0 var(--spacing-sm) var(--spacing-md);
  overflow: auto;
  list-style: none;
}

.provider-row {
  display: flex;
  width: 100%;
  min-height: var(--list-row-height);
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.provider-row:hover {
  background: var(--el-fill-color-light);
}

.provider-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.provider-row.active {
  background: var(--el-color-primary-light-9);
}

.provider-row-name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-row.active .provider-row-name {
  font-weight: var(--font-semibold);
}

.provider-row-meta {
  display: flex;
  min-width: 0;
  gap: var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}

.provider-row-meta .mono {
  overflow: hidden;
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-row-meta span:last-child {
  flex: 0 0 auto;
  margin-inline-start: auto;
}

.provider-list-empty {
  margin: 0;
  padding: var(--spacing-lg) var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
