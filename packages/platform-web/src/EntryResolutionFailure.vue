<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { entryResolutionFailureFor } from "./entry-resolution-failure";

const route = useRoute();
const { t } = useI18n();
const message = computed(() => entryResolutionFailureFor(route.path));
</script>

<template>
  <main v-if="message" class="entry-resolution-failure" role="alert">
    <h1>{{ t("platform.entryReadFailed") }}</h1>
    <p>{{ message }}</p>
  </main>
</template>

<style scoped>
.entry-resolution-failure {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 48px 24px;
  color: var(--el-text-color-primary, #303133);
  background: var(--el-bg-color, #fff);
}
.entry-resolution-failure h1 {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 600;
}
.entry-resolution-failure p {
  margin: 0;
  color: var(--el-text-color-secondary, #606266);
  overflow-wrap: anywhere;
}
</style>
