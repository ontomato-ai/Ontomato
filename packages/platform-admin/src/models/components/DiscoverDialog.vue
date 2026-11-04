<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { Plus, Search } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { RuntimeModelDiscoveryResponse } from "@ontomato/contracts/runtime-model-test";
import { useModelErrors } from "../errors";

type Candidate = RuntimeModelDiscoveryResponse["models"][number];

/*
 * The provider's model list, read with the unsaved connection when the dialog opens. Each candidate is added one by
 * one; the type and dimensions are chosen in the model dialog that "+" opens. When the list cannot be read the
 * failure is shown and the model can be added by hand.
 */
const props = defineProps<{
  visible: boolean;
  providerLabel: string;
  /** Reads the list with the provider as currently edited. */
  discover: () => Promise<RuntimeModelDiscoveryResponse>;
  /** IDs already in the provider. */
  takenIds: readonly string[];
}>();
const emit = defineEmits<{ "update:visible": [visible: boolean]; add: [candidate: Candidate]; manual: [] }>();
const { t } = useI18n();
const describeError = useModelErrors();

const loading = ref(false);
const error = ref("");
const candidates = shallowRef<Candidate[]>([]);
const query = ref("");
let readSeq = 0;

async function load() {
  const seq = ++readSeq;
  loading.value = true;
  error.value = "";
  candidates.value = [];
  try {
    const result = await props.discover();
    if (seq === readSeq) candidates.value = result.models;
  } catch (e) {
    if (seq === readSeq) error.value = describeError(e, "admin.discoverFailed");
  } finally {
    if (seq === readSeq) loading.value = false;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    query.value = "";
    void load();
  },
  { immediate: true }
);

const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text
    ? candidates.value.filter((c) => c.id.toLowerCase().includes(text) || c.name?.toLowerCase().includes(text))
    : candidates.value;
});
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    :title="t('admin.discoverTitle', { name: props.providerLabel })"
    width="min(640px, calc(100vw - 32px))"
    class="model-dialog"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <div v-if="error" class="discover-error" role="alert">
      <el-alert type="error" :title="error" :closable="false" show-icon />
      <div class="discover-error-actions">
        <el-button @click="load">{{ t("common.retry") }}</el-button>
        <el-button type="primary" @click="emit('manual')">{{ t("admin.addModelManually") }}</el-button>
      </div>
    </div>
    <template v-else>
      <el-input
        v-model="query"
        :prefix-icon="Search"
        :placeholder="t('admin.searchModels')"
        :aria-label="t('admin.searchModels')"
        :disabled="loading"
        clearable
      />
      <div v-loading="loading" class="discover-list">
        <ul v-if="shown.length > 0" class="model-rows">
          <li v-for="candidate in shown" :key="candidate.id" class="model-row">
            <span class="model-row-text">
              <span class="model-row-name">{{ candidate.name ?? candidate.id }}</span>
              <span v-if="candidate.name && candidate.name !== candidate.id" class="model-row-id">{{ candidate.id }}</span>
            </span>
            <span v-if="props.takenIds.includes(candidate.id)" class="model-row-added">{{ t("admin.modelAdded") }}</span>
            <el-button
              v-else
              size="small"
              :icon="Plus"
              :aria-label="t('admin.addNamedModel', { id: candidate.id })"
              :title="t('admin.addNamedModel', { id: candidate.id })"
              @click="emit('add', candidate)"
            />
          </li>
        </ul>
        <p v-else-if="!loading" class="model-empty">
          {{ candidates.length === 0 ? t("admin.discoverEmpty") : t("admin.noMatchingModels") }}
        </p>
      </div>
    </template>
    <template #footer>
      <el-button v-if="!error" link type="primary" @click="emit('manual')">{{ t("admin.addModelManually") }}</el-button>
      <el-button @click="emit('update:visible', false)">{{ t("common.close") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped src="../models.css"></style>
