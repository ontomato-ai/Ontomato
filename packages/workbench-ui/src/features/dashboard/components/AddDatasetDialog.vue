<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import {
  addDatasetToDashboard,
  createDashboardFromDatasets,
  fetchDashboardGroups,
  fetchDashboardList,
} from "../api";

/** Puts a conversation dataset on a dashboard: into a group of an existing one, or as a new one. */
const props = defineProps<{ sessionId: string; artifactId: string; title: string }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ added: [dashboardId: string] }>();
const { t } = useI18n();

const NEW = "__new__";
const dashboards = ref<DashboardListItem[]>([]);
const groups = ref<{ id: string; title: string }[]>([]);
const dashboardId = ref<string>(NEW);
const groupId = ref("");
const loading = ref(false);
const saving = ref(false);
const creating = computed(() => dashboardId.value === NEW);

watch(visible, async (open) => {
  if (!open) return;
  loading.value = true;
  try {
    dashboards.value = await fetchDashboardList();
    dashboardId.value = dashboards.value[0]?.id ?? NEW;
  } finally {
    loading.value = false;
  }
});

watch(dashboardId, async (id) => {
  groups.value = [];
  groupId.value = "";
  if (id === NEW) return;
  groups.value = (await fetchDashboardGroups(id)).map((group) => ({ id: group.id, title: group.title ?? group.id }));
  groupId.value = groups.value[0]?.id ?? "";
});

async function confirm() {
  saving.value = true;
  try {
    if (creating.value) {
      const created = await createDashboardFromDatasets(props.sessionId, [props.artifactId]);
      emit("added", created.id);
    } else {
      await addDatasetToDashboard({
        sessionId: props.sessionId,
        datasetArtifactId: props.artifactId,
        dashboardId: dashboardId.value,
        groupId: groupId.value,
      });
      emit("added", dashboardId.value);
    }
    ElMessage.success(t("assistant.addedToDashboard"));
    visible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('assistant.addToDashboard')" width="min(440px, calc(100vw - 24px))" append-to-body>
    <p class="dataset-title">{{ title }}</p>
    <el-form v-loading="loading" label-position="top" :disabled="saving">
      <el-form-item :label="t('assistant.dashboard')">
        <el-select v-model="dashboardId" class="full">
          <el-option :value="NEW" :label="t('assistant.newDashboard')" />
          <el-option v-for="item in dashboards" :key="item.id" :value="item.id" :label="item.name" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="!creating" :label="t('assistant.dashboardGroup')" required>
        <el-select v-model="groupId" class="full">
          <el-option v-for="group in groups" :key="group.id" :value="group.id" :label="group.title" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!creating && !groupId" @click="confirm">
        {{ t("common.confirm") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dataset-title {
  margin: 0 0 14px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.full {
  width: 100%;
}
</style>
