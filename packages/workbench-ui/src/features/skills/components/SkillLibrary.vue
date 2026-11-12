<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { useI18n } from "vue-i18n";
import { Upload } from "lucide-vue-next";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { ApiRequestError } from "../../../utils/api";
import { skillsApi } from "../api";
import { updateSkillLibraryCount } from "../count";

/**
 * The platform's skills, in the ontology manager's capability layer: what there is and where it came from. A skill is
 * read in its own page; agents choose skills in their own settings, and a package changes only by importing it again.
 */
const { t, locale } = useI18n();
const router = useRouter();
const skills = ref<SkillInfo[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
let loadVersion = 0;

async function load() {
  const version = ++loadVersion;
  loading.value = true;
  loadFailed.value = false;
  try {
    const response = await skillsApi.fetchSkills();
    if (version !== loadVersion) return;
    skills.value = response.skills;
    updateSkillLibraryCount(response.skills.length);
  } catch {
    if (version === loadVersion) loadFailed.value = true;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}
onMounted(load);
watch(locale, load);

function open(skill: SkillInfo) {
  void router.push({ name: platformRoutes.ontologySkill.name, params: { skillId: skill.id } });
}

async function importSkill(file: File, overwrite = false) {
  try {
    const data = await skillsApi.importSkill(file, overwrite);
    ElMessage.success(
      t("admin.skillImportSuccess", { id: data.skill.id, action: overwrite ? t("admin.overwrite") : t("common.import") }),
    );
    await load();
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.code === "SKILL_EXISTS")) {
      ElMessage.error(error instanceof Error ? error.message : t("admin.importFailed"));
      return;
    }
    try {
      await ElMessageBox.confirm(
        t("admin.skillExists", { id: (error.payload.details as { skillId: string }).skillId }),
        t("common.tip"),
        { confirmButtonText: t("admin.overwrite"), cancelButtonText: t("common.cancel"), type: "warning" },
      );
    } catch {
      return;
    }
    await importSkill(file, true);
  }
}

async function upload(uploaded: UploadFile) {
  if (!uploaded.raw) return;
  if (!uploaded.raw.name.toLowerCase().endsWith(".zip")) {
    ElMessage.warning(t("admin.zipOnly"));
    return;
  }
  await importSkill(uploaded.raw);
}
</script>

<template>
  <div class="skill-library platform-page">
    <PlatformPageHeader :title="t('capabilities.skillTitle')" :description="t('capabilities.skillDescription')">
      <template #actions>
        <el-upload :show-file-list="false" accept=".zip" :auto-upload="false" :on-change="upload">
          <el-button type="primary" :icon="Upload">{{ t("admin.importSkill") }}</el-button>
        </el-upload>
      </template>
    </PlatformPageHeader>
    <div class="library-body platform-page-gutter">
      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon :title="t('capabilities.loadFailed')">
        <el-button text @click="load">{{ t("common.retry") }}</el-button>
      </el-alert>
      <el-table v-else v-loading="loading" :data="skills" class="skill-table" row-class-name="skill-row" @row-click="open">
        <el-table-column :label="t('capabilities.skillTitle')" min-width="240">
          <template #default="{ row }">
            <span class="row-name">{{ row.title || row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('capabilities.source')" width="160">
          <template #default="{ row }">
            {{ row.isPublic ? t("capabilities.sourcePublic") : t("capabilities.sourceDomain") }}
          </template>
        </el-table-column>
        <template #empty>
          <span class="empty">{{ t("capabilities.emptySkills") }}</span>
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.skill-library {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  min-width: 0;
}
.library-body {
  padding-block: var(--page-content-gap) var(--spacing-xl);
  min-width: 0;
}
.skill-table {
  --el-table-header-bg-color: var(--el-fill-color);
  --el-table-row-hover-bg-color: var(--el-fill-color-light);
  --el-table-border-color: var(--el-border-color-light);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
}
.skill-table :deep(.el-table__inner-wrapper::before) { display: none; }
.skill-table :deep(th.el-table__cell) {
  height: var(--table-head-height);
  padding-block: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.skill-table :deep(td.el-table__cell) {
  height: var(--list-row-height);
  font-size: var(--text-sm);
}
.skill-table :deep(.cell) { padding-inline: var(--spacing-md); }
.skill-table :deep(tr:last-child td.el-table__cell) { border-bottom: 0; }
.skill-table :deep(.skill-row) { cursor: pointer; }
.row-name {
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.empty {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
</style>
