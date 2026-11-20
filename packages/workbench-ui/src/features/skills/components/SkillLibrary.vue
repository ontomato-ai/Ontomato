<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { useI18n } from "vue-i18n";
import { Download, Trash2, Upload } from "lucide-vue-next";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { ApiRequestError } from "../../../utils/api";
import { skillsApi } from "../api";
import { updateSkillLibraryCount } from "../count";
import { deleteSkill, exportSkill } from "../actions";
import { skillSource } from "../source";

/**
 * The platform's skills, in the ontology manager's capability layer: one card a skill, with its name, where it came
 * from and what it is for, and its export and (for this domain's own) delete at hand. A skill is read in its own page;
 * agents choose skills in their own settings, and a package changes only by importing it again, which first says what
 * a package looks like.
 */
const { t, locale } = useI18n();
const router = useRouter();
const skills = ref<SkillInfo[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
const importing = ref(false);
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

async function remove(skill: SkillInfo) {
  if (await deleteSkill(skill.id, t)) await load();
}

async function upload(uploaded: UploadFile) {
  if (!uploaded.raw) return;
  importing.value = false;
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
        <el-button type="primary" :icon="Upload" @click="importing = true">{{ t("admin.importSkill") }}</el-button>
      </template>
    </PlatformPageHeader>
    <div v-loading="loading" class="library-body platform-page-gutter">
      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon :title="t('capabilities.loadFailed')">
        <el-button text @click="load">{{ t("common.retry") }}</el-button>
      </el-alert>
      <ul v-else-if="skills.length" class="skill-grid">
        <li v-for="skill in skills" :key="skill.id" class="skill-card">
          <button type="button" class="card-open" @click="open(skill)">
            <span class="card-name" :title="skill.title">{{ skill.title }}</span>
            <span v-if="skill.description" class="card-description">{{ skill.description }}</span>
          </button>
          <span class="card-actions">
            <span class="card-source">{{ skillSource(skill, t).label }}</span>
            <el-button size="small" text :icon="Download" @click="exportSkill(skill.id)">{{ t("common.export") }}</el-button>
            <!-- A skill the domain does not own (built-in, or a provider's) stays: its delete is there, greyed, and says why. -->
            <el-tooltip :disabled="!skill.writeRestriction" :content="skillSource(skill, t).noDelete ?? ''" placement="top">
              <span>
                <el-button size="small" text type="danger" :icon="Trash2" :disabled="!!skill.writeRestriction" @click="remove(skill)">
                  {{ t("common.delete") }}
                </el-button>
              </span>
            </el-tooltip>
          </span>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">{{ t("capabilities.emptySkills") }}</p>
    </div>
    <!-- What a package looks like comes before the file is chosen, not after an import failed. -->
    <el-dialog v-model="importing" :title="t('admin.importSkill')" width="480px" append-to-body>
      <p class="import-intro">{{ t("capabilities.importIntro") }}</p>
      <ul class="import-rules">
        <li>{{ t("capabilities.importRuleRoot") }}</li>
        <li>{{ t("capabilities.importRuleFrontmatter") }}</li>
        <li>{{ t("capabilities.importRuleText") }}</li>
        <li>{{ t("capabilities.importRuleOverwrite") }}</li>
      </ul>
      <template #footer>
        <span class="import-footer">
          <el-button @click="importing = false">{{ t("common.cancel") }}</el-button>
          <el-upload :show-file-list="false" accept=".zip" :auto-upload="false" :on-change="upload">
            <el-button type="primary" :icon="Upload">{{ t("capabilities.importChoose") }}</el-button>
          </el-upload>
        </span>
      </template>
    </el-dialog>
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
/* One card a skill: its name, where it came from and what it is for, its actions along the foot. */
.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: var(--spacing-md);
  margin: 0;
  padding: 0;
  list-style: none;
}
.skill-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  transition: border-color var(--transition-fast);
}
.skill-card:hover {
  border-color: var(--el-border-color-dark);
}
.card-open {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-lg);
  border: 0;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: none;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.card-open:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-lg);
  line-height: var(--leading-lg);
  font-weight: var(--font-medium);
}
.card-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.card-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-lg);
  border-block-start: 1px dashed var(--el-border-color);
}
.card-source {
  margin-inline-end: auto;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  overflow-wrap: anywhere;
}
.card-actions :deep(.el-button) {
  margin: 0;
}
.empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.import-intro {
  margin: 0 0 var(--spacing-sm);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.import-rules {
  display: grid;
  gap: var(--spacing-xs);
  margin: 0;
  padding-left: 1.2em;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.import-footer {
  display: inline-flex;
  gap: var(--spacing-sm);
}
.import-footer :deep(.el-button) {
  margin: 0;
}
</style>
