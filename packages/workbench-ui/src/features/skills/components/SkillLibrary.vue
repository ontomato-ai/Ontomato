<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { useI18n } from "vue-i18n";
import { BookOpen, FileCode, Upload } from "lucide-vue-next";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { ApiRequestError } from "../../../utils/api";
import { skillsApi } from "../api";
import { updateSkillLibraryCount } from "../count";

/**
 * The platform's skills, in the ontology manager's capability layer: one card a skill, with its name, where it came
 * from and what it is for. A skill is read in its own page; agents choose skills in their own settings, and a package
 * changes only by importing it again.
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
    <div v-loading="loading" class="library-body platform-page-gutter">
      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon :title="t('capabilities.loadFailed')">
        <el-button text @click="load">{{ t("common.retry") }}</el-button>
      </el-alert>
      <ul v-else-if="skills.length" class="skill-grid">
        <li v-for="skill in skills" :key="skill.id">
          <button type="button" class="skill-card" @click="open(skill)">
            <span class="card-head">
              <component :is="skill.type === 'executable' ? FileCode : BookOpen" class="card-icon" :size="16" aria-hidden="true" />
              <span class="card-name">{{ skill.title || skill.id }}</span>
              <el-tag size="small" :type="skill.isPublic ? 'info' : 'primary'" effect="plain" disable-transitions>
                {{ skill.isPublic ? t("capabilities.sourcePublic") : t("capabilities.sourceDomain") }}
              </el-tag>
            </span>
            <span v-if="skill.description" class="card-description">{{ skill.description }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">{{ t("capabilities.emptySkills") }}</p>
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
/* One card a skill: its name, where it came from and what it is for, in rows that fill the page's width. */
.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}
.skill-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  width: 100%;
  height: 100%;
  min-height: 88px;
  padding: var(--spacing-md);
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.skill-card:hover {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-light);
}
.skill-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}
.card-icon {
  flex: 0 0 auto;
  color: var(--el-color-primary);
}
.card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.card-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
</style>
