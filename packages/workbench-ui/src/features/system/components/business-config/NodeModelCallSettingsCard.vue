<script setup lang="ts">
import type { SystemModelConfig } from "@ontomato/contracts/system-model";

import { computed, ref, watch } from "vue";
import { Radio } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

/** This card owns only the workbench model call mode; the query settings card owns its own two fields. */
type NodeModelCallDraft = Pick<SystemModelConfig, "nodeModelStreamingEnabled">;

const props = defineProps<{
  loading: boolean;
  saving: boolean;
  loadError: string;
}>();

const model = defineModel<NodeModelCallDraft>("model", { required: true });

const emit = defineEmits<{
  save: [];
  retry: [];
}>();

const savedSignature = ref("");
const signature = () => JSON.stringify([model.value.nodeModelStreamingEnabled]);
const dirty = computed(() => savedSignature.value !== "" && signature() !== savedSignature.value);
watch(
  () => props.loading,
  (loading) => {
    if (!loading && !props.loadError) markSaved();
  },
  { immediate: true }
);

function markSaved() {
  savedSignature.value = signature();
}

defineExpose({ markSaved });
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Radio /></el-icon>
      <span>{{ t("admin.nodeModelCallSettings") }}</span>
      <el-tag
        v-if="dirty && !props.loadError && !props.loading"
        type="warning"
        size="small"
        class="dirty-tag"
      >
        {{ t("admin.unsaved") }}
      </el-tag>
    </div>
    <div class="card-body">
      <el-skeleton v-if="props.loading" :rows="1" animated />
      <div v-else-if="props.loadError" class="load-error" role="alert">
        <span>{{ t("admin.loadConfigFailed") }}{{ businessConfigSeparator }}{{ props.loadError }}</span>
        <el-button size="small" @click="emit('retry')">{{ t("common.retry") }}</el-button>
      </div>
      <template v-else>
        <el-form
          class="config-form"
          :disabled="props.saving"
          label-width="160px"
          label-position="left"
          size="default"
        >
          <el-form-item :label="t('admin.nodeModelStreaming')">
            <el-switch v-model="model.nodeModelStreamingEnabled" />
          </el-form-item>
        </el-form>

        <p class="node-model-call-hint">{{ t("admin.nodeModelStreamingDescription") }}</p>
        <p class="node-model-call-hint">{{ t("admin.nodeModelStreamingScope") }}</p>
        <p class="node-model-call-hint">{{ t("admin.nodeModelStreamingEffective") }}</p>
        <p class="node-model-call-hint">{{ t("admin.nodeModelStreamingLegacyStream") }}</p>
      </template>

      <el-form-item class="form-actions">
        <el-button
          type="primary"
          :loading="props.saving"
          :disabled="!!props.loadError || props.loading"
          @click="emit('save')"
        >
          {{ t("common.saveConfig") }}
        </el-button>
      </el-form-item>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
