<script setup lang="ts">
import { provide } from "vue";
import { listBatchReceiptKey, type OperationBatchReceipt } from "./operation-dispatch";

const props = defineProps<{ publishReceipt: (receipt: OperationBatchReceipt | null) => void }>();
provide(listBatchReceiptKey, props.publishReceipt);
</script>

<template>
  <div class="sdk-object-list-batch-actions" role="group">
    <slot></slot>
  </div>
</template>
