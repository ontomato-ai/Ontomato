<script setup lang="ts">
import { onMounted, ref, provide } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentHostAgent } from "@ontomato/agent-shell-ui";
import { builderApi } from "../api";
import { errorText } from "../panel";
import { builderPlatformKey, type AppBuilderPlatform } from "../platform";
import BuilderShell from "./BuilderShell.vue";

/**
 * 应用构建's page: the builder opens once the server names the domain's builder agent. The platform hands it what only it
 * holds: its app host's page contexts, its application catalog and its permission management.
 */
const props=defineProps<{ platform: AppBuilderPlatform }>();
provide(builderPlatformKey,props.platform);
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
  <BuilderShell v-if="agent" :agent="agent" :platform="platform" />
  <div v-else v-loading="error === null" class="builder-loading" :aria-busy="error === null" :element-loading-text="t('assistant.loading')">
    <p v-if="error" role="alert">
      <span>{{ error }}</span>
      <el-button size="small" @click="load">{{ t("common.retry") }}</el-button>
    </p>
  </div>
</template>

<style scoped>
.builder-loading {
  flex: 1;
  min-height: 0;
  position: relative;
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
