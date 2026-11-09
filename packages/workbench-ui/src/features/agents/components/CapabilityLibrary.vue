<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { useI18n } from "vue-i18n";
import { ChevronRight, Download, Pencil, Plug, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-vue-next";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { McpServiceView } from "@ontomato/contracts/agent-runtime-mcp";
import { agentDefinitionsApi } from "../../agents/api";
import { skillsApi } from "../../skills/api";
import {
  deleteMcpService,
  listExternalMcpTools,
  listMcpServices,
  listPublishedMcpServices,
  type McpTool,
  type PublishedMcpService,
} from "../../mcp/api";
import { ApiRequestError } from "../../../utils/api";
import { authHost } from "../../../utils/auth";
import { workbenchContent } from "../../../content";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import McpServiceDialog from "../../mcp/components/McpServiceDialog.vue";
import McpToolList from "../../mcp/components/McpToolList.vue";
import SkillDebugDialog from "../../skills/components/SkillDebugDialog.vue";
import SkillFormDialog from "../../skills/components/SkillFormDialog.vue";

/**
 * The capability library of the agent platform: the skills and the external MCP services in one table, so what an agent
 * can use is read in one place: its type, where it comes from, which agents use it and whether it is available. Editing,
 * uploading, adding, checking a connection and deleting reuse the existing interfaces and dialogs.
 */
const { t, locale } = useI18n();

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
/** The platform's own MCP endpoints, published for other systems: addresses and tools, read-only here. */
const published = ref<PublishedMcpService[]>([]);
const publishedFailed = ref(false);
const loading = ref(true);
const loadFailed = ref(false);
const search = ref("");
const kindFilter = ref<"all" | "skill" | "tool">("all");
const checking = ref<string | null>(null);
const toggleLoading = ref<Record<string, boolean>>({});

const skillDialog = ref(false);
const editingSkill = ref<SkillInfo | null>(null);
const debugDialog = ref(false);
const debuggingSkill = ref<SkillInfo | null>(null);
const serviceDialog = ref(false);
const editingService = ref<McpServiceView | null>(null);

async function load() {
  loading.value = true;
  loadFailed.value = false;
  try {
    const [skillResponse, services, agents] = await Promise.all([
      skillsApi.fetchSkills(),
      listMcpServices(),
      agentDefinitionsApi.list(),
    ]);
    const skillList: SkillInfo[] = skillResponse?.success ? skillResponse.skills : [];
    publishedFailed.value = false;
    try {
      published.value = await listPublishedMcpServices();
    } catch {
      publishedFailed.value = true;
    }
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
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(locale, load);

const visibleRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (kindFilter.value !== "all" && row.kind !== kindFilter.value) return false;
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
    const formData = new FormData();
    formData.append("file", file);
    const data = await skillsApi.importSkill(formData, overwrite);
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
            id: String((error.payload.details as { skillId?: unknown } | undefined)?.skillId || t("common.unknown")),
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

const { analysisMcpServerName, opsMcpServerName } = workbenchContent();
/** Published services this page knows: their cards show a localized title and a connection hint. */
const recognizedPublished = new Map([
  [analysisMcpServerName, { title: "mcp.agentService", hint: "mcp.publishedAuthHint" }],
  [opsMcpServerName, { title: "mcp.opsAgentService", hint: "mcp.opsPublishedAuthHint" }],
]);
const publishedCards = computed(() =>
  published.value.map((service) => {
    const text = recognizedPublished.get(service.name);
    return { service, title: text ? t(text.title) : service.title || service.name, hint: text ? t(text.hint) : "" };
  }),
);

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
    <PlatformPageHeader :title="t('capabilities.title')" :description="t('capabilities.description')">
      <template #actions>
        <el-button :icon="RefreshCw" :loading="loading" @click="load">{{ t("common.refresh") }}</el-button>
        <el-upload :show-file-list="false" accept=".zip" :auto-upload="false" :on-change="uploadSkill">
          <el-button :icon="Upload">{{ t("admin.importSkill") }}</el-button>
        </el-upload>
        <el-button :icon="Plus" @click="addSkill">{{ t("admin.addSkill") }}</el-button>
        <el-button type="primary" :icon="Plug" @click="addService">{{ t("hotData.addService") }}</el-button>
      </template>
    </PlatformPageHeader>
    <!-- The page under its header: the one wrapper that takes the page gutter, so no element of the page pads itself
         (the table's own root must not: Element Plus lays its columns out across its padding too). -->
    <div class="library-body platform-page-gutter">
      <div class="library-toolbar">
        <el-select v-model="kindFilter" :aria-label="t('capabilities.filter')" class="kind-filter">
          <el-option value="all" :label="t('common.all')" />
          <el-option value="skill" :label="t('capabilities.skills')" />
          <el-option value="tool" :label="t('capabilities.tools')" />
        </el-select>
        <el-input v-model="search" :placeholder="t('capabilities.search')" :prefix-icon="Search" clearable />
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
        <el-table-column :label="t('capabilities.name')" min-width="240">
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
            <span>{{ search ? t("capabilities.noMatch") : t("capabilities.empty") }}</span>
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

      <details v-if="publishedCards.length || publishedFailed" class="published">
        <summary>
          <ChevronRight class="disclosure-arrow" :size="14" aria-hidden="true" />
          <span class="published-title">{{ t("mcp.publishedTab") }}</span>
          <span class="published-count">{{ publishedCards.length }}</span>
        </summary>
        <div class="published-body">
          <p class="published-hint">{{ t("mcp.publishedHint") }}</p>
          <el-alert v-if="publishedFailed" type="warning" :closable="false" show-icon :title="t('mcp.loadFailed')" />
          <article v-for="card in publishedCards" v-else :key="card.service.name" class="published-card">
            <h4>{{ card.title }}</h4>
            <code class="published-address">{{ card.service.mcpUrl }}</code>
            <p v-if="card.hint" class="published-hint">{{ card.hint }}</p>
            <details class="published-tools">
              <summary><span class="disclosure-indicator"><ChevronRight :size="14" aria-hidden="true" /></span>{{ t("mcp.availableTools") }} · {{ card.service.tools.length }}</summary>
              <McpToolList :tools="card.service.tools" />
            </details>
          </article>
        </div>
      </details>
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
/* A section of its own, collapsed by default: the table above is the page's subject. */
.published {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: var(--spacing-sm);
}
.published > summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  height: var(--nav-row-height);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-radius: var(--radius-sm);
  padding: 0 var(--spacing-sm);
}
.published > summary:hover {
  background: var(--el-fill-color-light);
}
.published > summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.published > summary::marker,
.published > summary::-webkit-details-marker {
  display: none;
  content: "";
}
.disclosure-arrow { flex-shrink: 0; color: var(--el-text-color-secondary); transition: transform var(--transition-fast); }
details[open] > summary > .disclosure-arrow { transform: rotate(90deg); }
.disclosure-indicator {
  display: inline-flex;
  flex: 0 0 14px;
  color: var(--el-text-color-secondary);
  transition: transform var(--transition-fast);
}
.published-tools[open] > summary > .disclosure-indicator { transform: rotate(90deg); }
.published-count {
  padding: 0 6px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
}
.published-body {
  display: grid;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-sm) 0;
}
.published-hint {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.published-card {
  padding: var(--page-section-padding);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
}
.published-card h4 {
  margin: 0 0 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.published-address {
  display: block;
  font-size: var(--text-xs);
  color: var(--el-text-color-regular);
  overflow-wrap: anywhere;
}
.published-card .published-tools {
  margin-top: 8px;
}
.published-card .published-tools summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  list-style: none;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.published-tools summary::-webkit-details-marker { display: none; }
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
