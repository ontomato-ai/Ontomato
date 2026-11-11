<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { useI18n } from "vue-i18n";
import { Download, Pencil, Plug, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-vue-next";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { McpServiceView } from "@ontomato/contracts/agent-runtime-mcp";
import { agentDefinitionsApi } from "../../agents/api";
import { skillsApi } from "../../skills/api";
import {
  deleteMcpService,
  listExternalMcpTools,
  listMcpServices,
  type McpTool,
} from "../../mcp/api";
import { ApiRequestError } from "../../../utils/api";
import { authHost } from "../../../utils/auth";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import McpServiceDialog from "../../mcp/components/McpServiceDialog.vue";
import McpToolList from "../../mcp/components/McpToolList.vue";
import SkillDebugDialog from "../../skills/components/SkillDebugDialog.vue";
import SkillFormDialog from "../../skills/components/SkillFormDialog.vue";
import { updateSkillLibraryCount } from "../../skills/count";

/**
 * Separate Skill and MCP pages reuse the existing management interfaces and dialogs.
 */
const props = withDefaults(defineProps<{ kind?: "skill" | "tool" }>(), { kind: "skill" });
const { t, locale } = useI18n();
const isSkill = computed(() => props.kind === "skill");

interface RowBase {
  key: string;
  name: string;
  description: string;
  /** Which agents use it, by name. */
  usedBy: string[];
  enabled: boolean;
  /** Errors of the last action on this row, shown in place. */
  failed: boolean;
}
type Row =
  | (RowBase & { kind: "skill"; skill: SkillInfo })
  | (RowBase & { kind: "tool"; service: McpServiceView; tools: McpTool[] | null });

const rows = ref<Row[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
const search = ref("");
const checking = ref<string | null>(null);
const toggleLoading = ref<Record<string, boolean>>({});

const skillDialog = ref(false);
const editingSkill = ref<SkillInfo | null>(null);
const debugDialog = ref(false);
const debuggingSkill = ref<SkillInfo | null>(null);
const serviceDialog = ref(false);
const editingService = ref<McpServiceView | null>(null);
let loadVersion = 0;

async function load() {
  const version = ++loadVersion;
  const kind = props.kind;
  loading.value = true;
  loadFailed.value = false;
  try {
    const [skillResponse, services, agents] = await Promise.all([
      kind === "skill" ? skillsApi.fetchSkills() : Promise.resolve(null),
      kind === "tool" ? listMcpServices() : Promise.resolve([]),
      agentDefinitionsApi.list(),
    ]);
    if (version !== loadVersion) return;
    if (kind === "skill" && !skillResponse?.success) throw new Error("Failed to load skills");
    const skillList: SkillInfo[] = skillResponse?.success ? skillResponse.skills : [];
    if (kind === "skill") updateSkillLibraryCount(skillList.length);
    const toolRows: Row[] = services.map((service) => ({
      kind: "tool",
      key: `tool:${service.id}`,
      service,
      tools: null,
      name: service.name,
      description: service.url,
      usedBy: agents.filter((agent) => agent.enabledMcpServiceIds.includes(service.id)).map((agent) => agent.name),
      enabled: true,
      failed: false,
    }));
    rows.value = [
      ...skillList.map<Row>((skill) => ({
        kind: "skill",
        key: `skill:${skill.id}`,
        skill,
        name: skill.title || skill.id,
        description: skill.description || "",
        usedBy: agents
          .filter((agent) => agent.skills.some((ref) => runtimeSkillKey(ref) === runtimeSkillKey(skill.skill)))
          .map((agent) => agent.name),
        enabled: skill.enabled,
        failed: false,
      })),
      ...toolRows,
    ];
  } catch {
    if (version === loadVersion) loadFailed.value = true;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}
onMounted(load);
watch(locale, load);
watch(() => props.kind, () => {
  search.value = "";
  rows.value = [];
  void load();
});

const visibleRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (row.kind !== props.kind) return false;
    if (!keyword) return true;
    return row.name.toLowerCase().includes(keyword) || row.description.toLowerCase().includes(keyword);
  });
});

const sourceLabel = (row: Row) =>
  row.kind === "skill"
    ? row.skill.isPublic
      ? t("capabilities.sourcePublic")
      : t("capabilities.sourceDomain")
    : t("capabilities.sourceService");

async function toggle(row: Row) {
  if (row.kind !== "skill") return;
  const id = row.skill.id;
  toggleLoading.value[id] = true;
  try {
    const data = await skillsApi.toggleSkill(id);
    if (data.success) {
      row.enabled = data.enabled;
      row.skill.enabled = data.enabled;
      ElMessage.success(data.enabled ? t("admin.skillEnabled") : t("admin.skillDisabled"));
    } else {
      ElMessage.warning(data.error || t("admin.operationFailed"));
    }
  } catch {
    ElMessage.error(t("admin.operationFailed"));
  } finally {
    toggleLoading.value[id] = false;
  }
}

function edit(row: Row) {
  if (row.kind === "skill") {
    editingSkill.value = row.skill;
    skillDialog.value = true;
    return;
  }
  editingService.value = row.service;
  serviceDialog.value = true;
}

function addSkill() {
  editingSkill.value = null;
  skillDialog.value = true;
}

function addService() {
  editingService.value = null;
  serviceDialog.value = true;
}

/** Checking a connection discovers the service's tools; the result stays in the row it belongs to. */
async function check(row: Row) {
  if (row.kind !== "tool") return;
  checking.value = row.key;
  row.failed = false;
  try {
    row.tools = await listExternalMcpTools(row.service.id);
    ElMessage.success(t("capabilities.connectionOk", { count: row.tools.length }));
  } catch {
    row.failed = true;
    row.tools = null;
  } finally {
    checking.value = null;
  }
}

async function remove(row: Row) {
  if (row.kind === "skill") {
    const skill = row.skill;
    let confirmation = t("admin.deleteSkillConfirm", { id: skill.id });
    try {
      const referenceData = await skillsApi.getReferences(skill.id);
      const affected: Array<{ name: string }> = Array.isArray(referenceData?.affectedAgents)
        ? referenceData.affectedAgents
        : [];
      if (affected.length) {
        confirmation = t("admin.deleteSkillAffectedConfirm", {
          id: skill.id,
          agents: affected.map((agent) => agent.name).join(", "),
        });
      }
    } catch {
      // The reference read is a courtesy; deleting still asks the plain question.
    }
    try {
      await ElMessageBox.confirm(confirmation, t("common.deleteConfirm"), {
        type: "warning",
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
      });
    } catch {
      return;
    }
    try {
      const data = await skillsApi.deleteSkill(skill.id);
      if (data.success) {
        rows.value = rows.value.filter((item) => item.key !== row.key);
        updateSkillLibraryCount(rows.value.filter((item) => item.kind === "skill").length);
        ElMessage.success(t("admin.skillDeleted"));
      }
    } catch {
      ElMessage.error(t("admin.deleteFailed"));
    }
    return;
  }
  try {
    await ElMessageBox.confirm(t("hotData.deleteMcpConfirm", { name: row.service.name }), t("common.tip"), {
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await deleteMcpService(row.service.id);
    rows.value = rows.value.filter((item) => item.key !== row.key);
    ElMessage.success(t("admin.deletedSuccess"));
  } catch {
    ElMessage.error(t("admin.deleteFailed"));
  }
}

async function importSkill(file: File, overwrite = false) {
  try {
    const data = await skillsApi.importSkill(file, overwrite);
    if (data.success) {
      ElMessage.success(
        t("admin.skillImportSuccess", { id: data.skill.id, action: overwrite ? t("admin.overwrite") : t("common.import") }),
      );
      await load();
      return;
    }
    ElMessage.error(data.error || t("admin.importFailed"));
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "SKILL_EXISTS") {
      try {
        await ElMessageBox.confirm(
          t("admin.skillExists", {
            id: (error.payload.details as { skillId: string }).skillId,
          }),
          t("common.tip"),
          { confirmButtonText: t("admin.overwrite"), cancelButtonText: t("common.cancel"), type: "warning" },
        );
      } catch {
        return;
      }
      await importSkill(file, true);
      return;
    }
    ElMessage.error(error instanceof Error ? error.message : t("admin.importFailed"));
  }
}

async function uploadSkill(uploaded: UploadFile) {
  const file = uploaded.raw;
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    ElMessage.warning(t("admin.zipOnly"));
    return;
  }
  await importSkill(file);
}

function exportSkill(row: Row) {
  if (row.kind !== "skill") return;
  const link = document.createElement("a");
  const params = new URLSearchParams();
  const token = authHost().getToken();
  const apiKey = authHost().getApiKey();
  if (token) params.set("tk", token);
  else if (apiKey) params.set("apiKey", apiKey);
  link.href = skillsApi.exportUrl(row.skill.id, params.toString());
  link.download = `${row.skill.id}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function debug(row: Row) {
  if (row.kind !== "skill" || row.skill.type !== "executable") return;
  debuggingSkill.value = row.skill;
  debugDialog.value = true;
}

const kindLabel = (row: Row) =>
  row.kind === "skill"
    ? row.skill.type === "executable"
      ? t("capabilities.kindExecutableSkill")
      : t("capabilities.kindKnowledgeSkill")
    : t("capabilities.kindTool");
</script>

<template>
  <div class="capability-library platform-page">
    <!-- The library's own page header: it is a page of the agent settings, not a panel inside another page. -->
    <PlatformPageHeader :title="t(isSkill ? 'capabilities.skillTitle' : 'capabilities.mcpTitle')" :description="t(isSkill ? 'capabilities.skillDescription' : 'capabilities.mcpDescription')">
      <template #actions>
        <el-button :icon="RefreshCw" :loading="loading" @click="load">{{ t("common.refresh") }}</el-button>
        <el-upload v-if="isSkill" :show-file-list="false" accept=".zip" :auto-upload="false" :on-change="uploadSkill">
          <el-button :icon="Upload">{{ t("admin.importSkill") }}</el-button>
        </el-upload>
        <el-button v-if="isSkill" type="primary" :icon="Plus" @click="addSkill">{{ t("admin.addSkill") }}</el-button>
        <el-button v-else type="primary" :icon="Plug" @click="addService">{{ t("hotData.addService") }}</el-button>
      </template>
    </PlatformPageHeader>
    <!-- The page under its header: the one wrapper that takes the page gutter, so no element of the page pads itself
         (the table's own root must not: Element Plus lays its columns out across its padding too). -->
    <div class="library-body platform-page-gutter">
      <div class="library-toolbar">
        <el-input v-model="search" :placeholder="t(isSkill ? 'capabilities.searchSkills' : 'capabilities.searchMcp')" :prefix-icon="Search" clearable />
      </div>

      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon :title="t('capabilities.loadFailed')">
        <el-button text @click="load">{{ t("common.retry") }}</el-button>
      </el-alert>

      <el-table
        v-else
        v-loading="loading"
        :data="visibleRows"
        class="capability-table"
        :fit="true"
        :max-height="undefined"
      >
        <el-table-column :label="t(isSkill ? 'capabilities.skillTitle' : 'capabilities.mcpTitle')" min-width="240">
          <template #default="{ row }">
            <div class="name-cell">
              <span class="row-name">{{ row.name }}</span>
              <el-tag size="small" effect="plain">{{ kindLabel(row) }}</el-tag>
            </div>
            <p v-if="row.description" class="row-description">{{ row.description }}</p>
          </template>
        </el-table-column>
        <el-table-column :label="t('capabilities.source')" width="140">
          <template #default="{ row }">{{ sourceLabel(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('capabilities.usedBy')" min-width="180">
          <template #default="{ row }">
            <span v-if="row.usedBy.length">{{ row.usedBy.join(", ") }}</span>
            <span v-else class="muted">{{ t("capabilities.unused") }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('capabilities.status')" width="130">
          <template #default="{ row }">
            <el-switch
              v-if="row.kind === 'skill'"
              :model-value="row.enabled"
              :loading="toggleLoading[row.skill.id]"
              size="small"
              :aria-label="t('capabilities.status')"
              @change="toggle(row)"
            />
            <el-tag v-else size="small" :type="row.failed ? 'danger' : 'success'" effect="plain">
              {{ row.failed ? t("capabilities.unreachable") : t("capabilities.available") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('capabilities.actions')" width="260" align="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button v-if="row.kind === 'tool'" size="small" text :loading="checking === row.key" @click="check(row)">
                {{ t("capabilities.check") }}
              </el-button>
              <el-button v-if="row.kind === 'skill' && row.skill.type === 'executable'" size="small" text @click="debug(row)">
                {{ t("common.debug") }}
              </el-button>
              <el-button v-if="row.kind === 'skill'" size="small" text :icon="Download" :aria-label="t('common.export')" @click="exportSkill(row)" />
              <el-button size="small" text :icon="Pencil" :aria-label="t('common.edit')" @click="edit(row)">
                {{ row.kind === "skill" && row.skill.isPublic ? t("common.view") : t("common.edit") }}
              </el-button>
              <el-button
                v-if="row.kind === 'tool' || !row.skill.isPublic"
                size="small"
                text
                type="danger"
                :icon="Trash2"
                :aria-label="t('common.delete')"
                @click="remove(row)"
              />
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty">
            <span>{{ search ? t("capabilities.noMatch") : t(isSkill ? "capabilities.emptySkills" : "capabilities.emptyMcp") }}</span>
          </div>
        </template>
      </el-table>

      <section v-if="visibleRows.some((row) => row.kind === 'tool' && row.tools)" class="discovered">
        <template v-for="row in visibleRows" :key="row.key">
          <article v-if="row.kind === 'tool' && row.tools" class="discovered-card">
            <h4>{{ row.name }}</h4>
            <McpToolList :tools="row.tools" />
          </article>
        </template>
      </section>

    </div>

    <SkillFormDialog
      v-model:visible="skillDialog"
      :edit-skill="editingSkill"
      initial-category="analysis"
      @created="load"
      @updated="load"
    />
    <SkillDebugDialog v-model:visible="debugDialog" :skill="debuggingSkill" />
    <McpServiceDialog v-model:visible="serviceDialog" :service="editingService" @saved="load" />
  </div>
</template>

<style scoped>
/*
 * The library grows with its content and the page scrolls: no scroll box inside the page, so the table is never squeezed
 * into a few rows by whatever sits below it.
 */
/*
 * The page fills the area it is mounted in. Its horizontal padding is the page header's grid: this page is its own
 * frame (it draws the header), so nothing above it supplies the gutter. The body under the header takes it
 * (`platform-page-gutter`): the table inside keeps the full width it is given, and scrolls sideways in its own frame
 * when its columns need more.
 */
.capability-library {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 0;
  box-sizing: border-box;
  min-width: 0;
}
.library-body {
  display: flex;
  flex-direction: column;
  gap: var(--page-content-gap);
  padding-block: var(--page-content-gap) var(--spacing-xl);
  min-width: 0;
}
.library-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.library-toolbar .el-input {
  width: 240px;
  max-width: 100%;
}
.kind-filter { width: 160px; max-width: 100%; }
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-left: auto;
  flex-wrap: wrap;
}
.toolbar-actions :deep(.el-button) {
  margin: 0;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.capability-table {
  --el-table-header-bg-color: var(--el-fill-color);
  --el-table-row-hover-bg-color: var(--el-fill-color-light);
  --el-table-border-color: var(--el-border-color-light);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.capability-table :deep(.el-table__inner-wrapper::before) { display: none; }
.capability-table :deep(th.el-table__cell) {
  height: var(--table-head-height);
  padding-block: 0;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  border-bottom-color: var(--el-border-color);
}
.capability-table :deep(td.el-table__cell) {
  height: var(--list-row-height);
  padding-block: var(--spacing-sm);
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
}
.capability-table :deep(.cell) { padding-inline: var(--spacing-md); }
.capability-table :deep(tr:last-child td.el-table__cell) { border-bottom: 0; }
.row-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.row-description {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.muted {
  color: var(--el-text-color-tertiary);
}
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.row-actions :deep(.el-button) {
  margin: 0;
}
.empty {
  padding: var(--spacing-xl);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.discovered {
  display: grid;
  gap: var(--spacing-md);
}
.discovered-card {
  padding: var(--page-section-padding);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
}
.discovered-card h4 {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
@media (max-width: 900px) {
  .toolbar .el-input {
    width: 100%;
  }
  .toolbar-actions {
    margin-left: 0;
    flex-wrap: wrap;
  }
}
</style>
