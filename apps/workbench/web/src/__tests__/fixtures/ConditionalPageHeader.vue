<script setup lang="ts">
import PageHeader from "../../../../../../packages/apps-sdk/src/base/PageHeader.vue";

defineProps<{ showActions: boolean; showTitle: boolean }>();
</script>

<template>
  <PageHeader>
    <template v-if="showActions" #actions>
      <button type="button" data-testid="detail">Inspect</button>
    </template>
    <template v-if="showTitle" #title>
      <span data-testid="detail">Detail</span>
    </template>
  </PageHeader>
</template>
