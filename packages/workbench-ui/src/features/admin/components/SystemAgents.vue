<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ScanEye } from "lucide-vue-next";
import { useAdminAccess } from "../composables/useAdminAccess";

const router = useRouter();
const { t } = useI18n();
const access = useAdminAccess();

const canOpenOpsAgent = computed(() => access.can("observer"));

function openOpsAgent() {
  window.open(router.resolve({ name: "ObserveDiagnosis" }).href, "_blank");
}

</script>

<template>
  <div class="system-agent-grid">
    <section v-if="canOpenOpsAgent" class="system-agent-card">
      <div class="system-agent-icon"><ScanEye :size="20" /></div>
      <div class="system-agent-body">
        <h3>{{ t("admin.opsAgent") }}</h3>
        <p>{{ t("admin.opsAgentDescription") }}</p>
      </div>
      <el-button type="primary" @click="openOpsAgent">{{ t("admin.openEntry") }}</el-button>
    </section>
  </div>
</template>

<style scoped>
.system-agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-lg);
}

.system-agent-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-2xl);
  background: var(--el-bg-color);
  box-shadow: var(--shadow-card);
}

.system-agent-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.system-agent-body {
  flex: 1;
  min-width: 0;
}

.system-agent-body h3 {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.system-agent-body p {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
