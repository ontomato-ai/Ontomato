<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus, Search } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { modelApiLabels } from "../apis";
import type { ProviderDraft } from "../draft";

/** The providers of the draft as a list: a status dot, the protocol and the model count, search, add, select. */
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

/**
 * The dot: a saved provider whose connection is complete is ready, an unsaved one or one missing its address, key or
 * models is incomplete. Anything else is still being edited.
 */
function state(provider: ProviderDraft): "ready" | "incomplete" | "draft" {
  if (!provider.savedKeyMask) return "draft";
  const connected = provider.baseUrl.trim() !== "" && provider.apiKey.trim() !== "";
  return connected && provider.models.length > 0 ? "ready" : "incomplete";
}

function stateLabel(value: ReturnType<typeof state>) {
  return t(`admin.providerStates.${value}`);
}
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
          <span class="provider-row-head">
            <span :class="['provider-state', state(provider)]" :title="stateLabel(state(provider))" role="img" :aria-label="stateLabel(state(provider))" />
            <span class="provider-row-name">{{ provider.name || provider.id }}</span>
          </span>
          <span class="provider-row-meta">
            <span class="provider-row-protocol">{{ modelApiLabels[provider.api] }}</span>
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

.provider-row-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--spacing-sm);
}

/* A status dot, not a badge: colour role plus a word for screen readers. */
.provider-state {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 9999px;
  background: var(--el-text-color-disabled);
}

.provider-state.ready {
  background: var(--el-color-success);
}

.provider-state.incomplete {
  background: var(--el-color-warning);
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

.provider-row-protocol {
  overflow: hidden;
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
