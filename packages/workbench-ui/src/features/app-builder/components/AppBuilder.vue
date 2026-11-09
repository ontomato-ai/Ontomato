<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentHostAgent } from "@ontomato/agent-shell-ui";
import { builderApi } from "../api";
import { errorText } from "../panel";
import BuilderShell from "./BuilderShell.vue";

/** 应用构建's page: the builder opens once the server names the domain's builder agent. */
const { t } = useI18n();
const agent = ref<AgentHostAgent | null>(null);
const error = ref<string | null>(null);

async function load() {
  error.value = null;
  try {
    agent.value = await builderApi.agent();
  } catch (reason) {
    error.value = errorText(reason);
  }
}
onMounted(load);
</script>

<template>
  <BuilderShell v-if="agent" :agent="agent" />
  <div v-else class="builder-loading" :aria-busy="error === null">
    <p v-if="error" role="alert">
      <span>{{ error }}</span>
      <el-button size="small" @click="load">{{ t("common.retry") }}</el-button>
    </p>
  </div>
</template>

<style scoped>
.builder-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.builder-loading p {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: 0;
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
