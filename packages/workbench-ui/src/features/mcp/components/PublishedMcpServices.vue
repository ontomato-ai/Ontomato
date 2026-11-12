<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RefreshCw } from "lucide-vue-next";
import { usePageActions } from "@ontomato/platform-shell";
import { workbenchContent } from "../../../content";
import { listPublishedMcpServices, type PublishedMcpService } from "../api";
import McpToolList from "./McpToolList.vue";

const { t, locale } = useI18n();
const services = ref<PublishedMcpService[]>([]);
const loading = ref(false);
const failed = ref(false);
let version = 0;
async function load() {
  const current = ++version;
  loading.value = true;
  failed.value = false;
  try {
    const result = await listPublishedMcpServices();
    if (current === version) services.value = result;
  } catch {
    if (current === version) failed.value = true;
  } finally {
    if (current === version) loading.value = false;
  }
}
onMounted(load);
watch(locale, load);
// The system settings draw the page's header; refreshing the list is its one action there.
usePageActions(() => ({
  actions: [{ id: "refresh", label: t("common.refresh"), icon: RefreshCw, loading: loading.value, onClick: () => void load() }],
}));
const content = workbenchContent();
const cards = computed(() => services.value.map(service => {
  const keys = service.name === content.analysisMcpServerName
    ? ["mcp.agentService", "mcp.publishedAuthHint"]
    : service.name === content.opsMcpServerName
      ? ["mcp.opsAgentService", "mcp.opsPublishedAuthHint"] : null;
  return { service, title: keys ? t(keys[0]!) : service.title || service.name, hint: keys ? t(keys[1]!) : "" };
}));
</script>

<template>
  <div class="published-mcp-services platform-page">
    <div v-loading="loading" class="published-body">
      <el-alert v-if="failed" type="error" :closable="false" show-icon :title="t('mcp.loadFailed')">
        <el-button text @click="load">{{ t('common.retry') }}</el-button>
      </el-alert>
      <template v-else>
        <article v-for="card in cards" :key="card.service.name" class="published-card">
          <h3>{{ card.title }}</h3>
          <code class="published-address">{{ card.service.mcpUrl }}</code>
          <p v-if="card.hint" class="published-hint">{{ card.hint }}</p>
          <details class="published-tools">
            <summary>{{ t('mcp.availableTools') }} · {{ card.service.tools.length }}</summary>
            <McpToolList :tools="card.service.tools" />
          </details>
        </article>
        <el-empty v-if="!loading && !cards.length" :description="t('mcp.noPublishedServices')" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.published-body { display: grid; gap: var(--spacing-md); }
.published-card { padding: var(--page-section-padding); border: 1px solid var(--el-border-color-light); border-radius: var(--radius-md); }
.published-card h3 { margin: 0 0 var(--spacing-sm); font-size: var(--text-sm); }
.published-address { overflow-wrap: anywhere; }
.published-hint { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 1.6; }
.published-tools { margin-top: var(--spacing-sm); }
.published-tools summary { cursor: pointer; font-size: var(--text-sm); }
</style>
