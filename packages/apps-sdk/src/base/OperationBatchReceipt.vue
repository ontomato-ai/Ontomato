<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { formatOperationOutcome, type OperationBatchReceipt } from "./operation-dispatch";

const props = defineProps<OperationBatchReceipt & { dismissible?: boolean }>();
const emit = defineEmits<{ dismiss: [] }>();

const { t } = useI18n({
  useScope: "local",
  messages: {
    en: { platform: {
      operationSkipped: "Skipped: {reason}",
      operationBatchSkipped: "{count} skipped",
    } },
    "zh-CN": { platform: {
      operationSkipped: "已跳过：{reason}",
      operationBatchSkipped: "已跳过 {count} 项",
    } },
  },
});
const { t: tGlobal } = useI18n({ useScope: "global" });
const done = computed(() => props.items.filter(({ outcome }) => outcome.kind === "success").length);
const skipped = computed(() => props.items.filter(({ outcome }) => outcome.kind === "skipped").length);

function nameOf(target: PanelObjectIdentity): string {
  return props.named.find(({ target: known }) =>
    known.objectType === target.objectType && known.primaryKey === target.primaryKey)?.label ?? target.primaryKey;
}
</script>

<template>
  <div class="sdk-batch-receipt">
    <button v-if="dismissible" class="sdk-batch-receipt-dismiss" type="button" @click="emit('dismiss')">
      {{ tGlobal("common.close") }}
    </button>
    <div role="status">
      <p>
        {{ tGlobal("platform.operationBatchDone", { done, total: items.length }) }}
        <span v-if="skipped"> · {{ t("platform.operationBatchSkipped", { count: skipped }) }}</span>
      </p>
      <ul>
        <li
          v-for="item in items"
          :key="item.target.objectType + ':' + item.target.primaryKey"
          :data-outcome="item.outcome.kind"
        >{{ nameOf(item.target) }}: {{ formatOperationOutcome(item.outcome, item.outcome.kind === "skipped" ? t : tGlobal) }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.sdk-batch-receipt {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-batch-receipt p {
  margin: 0;
}
.sdk-batch-receipt ul {
  margin: var(--spacing-xs) 0 0;
  padding-inline-start: var(--spacing-lg);
}
.sdk-batch-receipt li[data-outcome="failure"],
.sdk-batch-receipt li[data-outcome="refusal"],
.sdk-batch-receipt li[data-outcome="unknown"] {
  color: var(--el-color-danger-text);
}
.sdk-batch-receipt-dismiss {
  float: inline-end;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
}
</style>
