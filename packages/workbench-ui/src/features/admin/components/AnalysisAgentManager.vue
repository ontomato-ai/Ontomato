<template>
  <div
    class="analysis-agent-manager"
    :class="
      dialogDisplay.labelWrap
        ? 'analysis-agent-manager--label-wrap'
        : 'analysis-agent-manager--label-nowrap'
    "
  >
    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="openCreateAgent">
        {{ t("admin.newAgent") }}
      </el-button>
    </div>

    <div
      ref="dropZone"
      class="agents-container"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="lineup.length > 1" class="sort-hint">
        <el-icon :size="14"><GripVertical /></el-icon>
        {{ t("admin.dragToSort") }}
      </div>
      <div v-loading="loading" class="agents-grid">
        <div
          v-for="(entry, index) in lineup"
          :key="lineupEntryId(entry)"
          class="agent-card"
          :class="{
            disabled: entry.kind === 'agent' && !entry.agent.isEnabled,
            dragging: dragFrom === index,
            'insert-before': insertMarker?.index === index && insertMarker.side === 'before',
            'insert-after': insertMarker?.index === index && insertMarker.side === 'after',
          }"
          draggable="true"
          @dragstart="onDragStart($event, index)"
          @dragend="endDrag"
        >
          <template v-if="entry.kind === 'qa'">
            <div class="agent-header">
              <div class="agent-title-row">
                <div class="drag-handle">
                  <el-icon :size="16"><GripVertical /></el-icon>
                </div>
                <span class="agent-title">{{ qaAgent.name }}</span>
              </div>
            </div>
            <div class="agent-description">{{ qaAgent.description }}</div>
            <div class="no-skills">{{ t("admin.qaAgentOrderOnly") }}</div>
          </template>
          <template v-else>
            <div class="agent-header">
              <div class="agent-title-row">
                <div class="drag-handle">
                  <el-icon :size="16"><GripVertical /></el-icon>
                </div>
                <span class="agent-title">{{ displayAgentName(entry.agent.name) }}</span>
                <div class="agent-actions">
                  <el-dropdown trigger="click" placement="bottom-end">
                    <el-button class="more-btn" :icon="MoreHorizontal" size="small" text />
                    <template #dropdown>
                      <el-dropdown-menu class="agent-dropdown-menu">
                        <el-dropdown-item @click="editAgent(entry.agent)">
                          {{ t("common.edit") }}
                        </el-dropdown-item>
                        <el-dropdown-item @click="toggleAgentStatus(entry.agent)">
                          {{ entry.agent.isEnabled ? t("common.disable") : t("common.enable") }}
                        </el-dropdown-item>
                        <el-dropdown-item divided @click="deleteAgent(entry.agent)">
                          {{ t("common.delete") }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </div>

            <div class="agent-description">
              {{ displayAgentDescription(entry.agent.description) || t("common.noDescription") }}
            </div>

            <div
              v-if="
                entry.agent.enabledSkillIds?.length ||
                entry.agent.enabledVisualizationSkillIds?.length
              "
              class="agent-skills"
            >
              <el-tag
                v-for="skillName in getSkillNames(entry.agent.enabledSkillIds)"
                :key="skillName"
                size="small"
                type="primary"
                effect="plain"
              >
                {{ skillName }}
              </el-tag>
              <el-tag
                v-for="skillName in getVisualizationSkillNames(
                  entry.agent.enabledVisualizationSkillIds
                )"
                :key="skillName"
                size="small"
                type="success"
                effect="plain"
              >
                📊 {{ skillName }}
              </el-tag>
            </div>
            <div v-else class="no-skills">{{ t("admin.noSkillsConfigured") }}</div>
          </template>
        </div>
      </div>
      <div v-if="!loading && !lineup.some((entry) => entry.kind === 'agent')" class="empty-state">
        <el-empty :description="t('admin.noAgentHint')" />
      </div>
    </div>

    <AgentCreateDialog
      v-model:visible="showCreateDialog"
      :editing-agent="editingAgent"
      v-bind="dialogDisplay"
      @created="handleAgentSaved"
      @updated="handleAgentSaved"
    />
  </div>
</template>

<script setup lang="ts">
import {
  QA_AGENT_LINEUP_ID,
  type AgentLineupEntry,
  type AnalysisAgent,
} from "@ontomato/contracts/analysis-agent";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";

import { computed, ref, onMounted, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { analysisAgentApi } from "../../analysis/api";
import { skillsApi, type AnalysisSkill } from "../../skills/api";
import { Plus, MoreHorizontal, GripVertical } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import AgentCreateDialog from "../../analysis/components/AgentCreateDialog.vue";
import { createQaAgent, getWorkbenchAppearance } from "../../workbench";
import { workbenchContent } from "../../../content";

type CardRect = Pick<DOMRect, "top" | "bottom" | "left" | "right">;
/** `slot` is the gap index (0..n) in the current order; `marker` is the card edge that shows it. */
interface InsertSlot {
  slot: number;
  marker: { index: number; side: "before" | "after" };
}

/**
 * Finds the gap a pointer points at in a row-major card grid: the row is the one the pointer is
 * in (or nearest to), and within it the pointer goes before the first card whose horizontal
 * middle lies to its right, otherwise after the row's last card. A pointer below the last row
 * resolves to the end of the list whatever its horizontal position.
 */
function findInsertSlot(rects: CardRect[], x: number, y: number): InsertSlot | null {
  if (rects.length === 0) return null;
  const rows: number[][] = [];
  rects.forEach((rect, index) => {
    const row = rows.find((r) => Math.abs(rects[r[0]].top - rect.top) < 1);
    if (row) row.push(index);
    else rows.push([index]);
  });
  const distance = (row: number[]) => {
    const top = Math.min(...row.map((i) => rects[i].top));
    const bottom = Math.max(...row.map((i) => rects[i].bottom));
    return y < top ? top - y : y > bottom ? y - bottom : 0;
  };
  const last = rects.length - 1;
  if (y > Math.max(...rects.map((rect) => rect.bottom))) {
    return { slot: last + 1, marker: { index: last, side: "after" } };
  }
  const row = rows.reduce((best, r) => (distance(r) < distance(best) ? r : best));
  const before = row.find((i) => x < (rects[i].left + rects[i].right) / 2);
  if (before !== undefined) return { slot: before, marker: { index: before, side: "before" } };
  const rowEnd = row[row.length - 1];
  return { slot: rowEnd + 1, marker: { index: rowEnd, side: "after" } };
}

const { t } = useI18n();
const content = workbenchContent();
const dialogDisplay = content.agentDialogDisplay;

function displayAgentName(name?: string): string {
  if (!name) return "";
  return content.defaultAgentNames.includes(name) ? t("service.defaultAgentName") : name;
}

function displayAgentDescription(desc?: string): string {
  if (!desc) return "";
  return content.defaultAgentDescriptions.includes(desc)
    ? t("service.defaultAgentDescription")
    : desc;
}

const loading = ref(false);

/** The domain's whole lineup (disabled agents included) in the server's display order. */
const lineup = ref<AgentLineupEntry[]>([]);
const appearance = ref<WorkbenchAppearance | null>(null);
const qaAgent = computed(() => createQaAgent(appearance.value, t));
const dropZone = ref<HTMLElement | null>(null);
/** Index of the card being dragged; null when no card drag is in progress. */
const dragFrom = ref<number | null>(null);
/** Where the dragged card would land, or null when releasing now would change nothing. */
const insertSlot = ref<InsertSlot | null>(null);
const insertMarker = computed(() => insertSlot.value?.marker ?? null);
const allSkills = ref<AnalysisSkill[]>([]);
const showCreateDialog = ref(false);
const editingAgent = ref<AnalysisAgent | null>(null);

// Load all visualization skills
const allVisualizationSkills = ref<AnalysisSkill[] | null>(null);

async function loadVisualizationSkills() {
  try {
    allVisualizationSkills.value = await skillsApi.listVisualizationSkills();
  } catch {
    allVisualizationSkills.value = [];
  }
}

function lineupEntryId(entry: AgentLineupEntry): string {
  return entry.kind === "qa" ? QA_AGENT_LINEUP_ID : entry.agent.id;
}

async function loadAgents() {
  loading.value = true;
  try {
    lineup.value = await analysisAgentApi.getAgentLineup();
  } catch (error) {
    ElMessage.error(
      t("admin.loadFailed") +
        content.analysisAgentLoadErrorSeparator +
        (error instanceof Error ? error.message : String(error))
    );
    lineup.value = [];
  } finally {
    loading.value = false;
  }
}

/** Only the Q&A card's name, description and avatar come from appearance; it falls back to the built-in texts. */
async function loadAppearance() {
  try {
    appearance.value = await getWorkbenchAppearance();
  } catch {
    ElMessage.error(t("appearance.loadFailed"));
  }
}

async function loadSkills() {
  try {
    const res = await skillsApi.listAnalysisSkills();
    allSkills.value = res;
  } catch {
    allSkills.value = [];
  }
}

function getSkillNames(skillIds: string[] = []): string[] {
  if (!skillIds || skillIds.length === 0) return [];
  return skillIds
    .map((id) => {
      const skill = allSkills.value.find((s) => s.id === id);
      return skill?.title || id;
    })
    .slice(0, 5);
}

function getVisualizationSkillNames(skillIds: string[] = []): string[] {
  if (!skillIds || skillIds.length === 0) return [];
  return skillIds
    .map((id) => {
      const skill = allVisualizationSkills.value?.find((s) => s.id === id);
      return skill?.title || id;
    })
    .slice(0, 3);
}

function openCreateAgent() {
  editingAgent.value = null;
  showCreateDialog.value = true;
}

function onDragStart(e: DragEvent, index: number) {
  dragFrom.value = index;
  insertSlot.value = null;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }
}

function cardRects(): CardRect[] {
  const cards = dropZone.value?.querySelectorAll<HTMLElement>(".agents-grid > .agent-card") ?? [];
  return Array.from(cards, (card) => card.getBoundingClientRect());
}

/** The slot only counts when it actually moves the dragged card. */
function movingSlot(e: DragEvent): InsertSlot | null {
  const from = dragFrom.value;
  if (from === null) return null;
  const slot = findInsertSlot(cardRects(), e.clientX, e.clientY);
  return slot && slot.slot !== from && slot.slot !== from + 1 ? slot : null;
}

/** Only this page's own card drags are accepted, anywhere inside the card area. */
function onDragOver(e: DragEvent) {
  if (dragFrom.value === null) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  insertSlot.value = movingSlot(e);
}

function onDragLeave(e: DragEvent) {
  const next = e.relatedTarget as Node | null;
  if (!next || !dropZone.value?.contains(next)) insertSlot.value = null;
}

/** Leaving the card area or pressing Esc ends the drag without a drop: nothing moves. */
function endDrag() {
  dragFrom.value = null;
  insertSlot.value = null;
}

async function onDrop(e: DragEvent) {
  const from = dragFrom.value;
  if (from === null) return;
  e.preventDefault();
  const slot = movingSlot(e);
  endDrag();
  if (!slot) return;

  const list = [...lineup.value];
  const [moved] = list.splice(from, 1);
  list.splice(slot.slot > from ? slot.slot - 1 : slot.slot, 0, moved);
  lineup.value = list;

  try {
    await analysisAgentApi.saveAgentLineup(list.map(lineupEntryId));
  } catch {
    ElMessage({ message: t("admin.sortUpdateFailed"), type: "error" });
    await loadAgents();
  }
}

async function toggleAgentStatus(agent: AnalysisAgent) {
  const newState = !agent.isEnabled;
  try {
    await analysisAgentApi.updateAgent(agent.id, { isEnabled: newState });
    agent.isEnabled = newState;
    ElMessage({ message: newState ? t("common.enabled") : t("common.disabled"), type: "success" });
  } catch {
    ElMessage({ message: t("admin.updateFailed"), type: "error" });
  }
}

function editAgent(agent: AnalysisAgent) {
  editingAgent.value = agent;
  showCreateDialog.value = true;
}

// Delete an agent
async function deleteAgent(agent: AnalysisAgent) {
  try {
    await ElMessageBox.confirm(
      t("admin.deleteAgentConfirm", { name: displayAgentName(agent.name) }),
      t("common.confirmDelete"),
      {
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      }
    );

    await analysisAgentApi.deleteAgent(agent.id);
    ElMessage({
      message: t("admin.deletedSuccess"),
      type: "success",
    });
    await loadAgents();
  } catch (error: any) {
    if (error !== "cancel") {
      ElMessage({
        message: t("admin.deleteFailed"),
        type: "error",
      });
    }
  }
}

async function handleAgentSaved() {
  editingAgent.value = null;
  await loadAgents();
}

watch(showCreateDialog, (visible) => {
  if (!visible) {
    editingAgent.value = null;
  }
});

onMounted(() => {
  loadAgents();
  loadAppearance();
  loadSkills();
  loadVisualizationSkills();
});
</script>

<style scoped>
.analysis-agent-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.toolbar {
  display: flex;
  justify-content: flex-start;
}

.agent-form-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-xl);
  max-height: 70vh;
  overflow-y: auto;
  padding-right: var(--spacing-md);
}

.form-left,
.form-right {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.skill-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0 0 var(--spacing-sm) 0;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

/* Form item labels wrap or not according to agentDialogDisplay.labelWrap (the same input as the edit dialog) */
.analysis-agent-manager--label-nowrap :deep(.el-form-item__label) {
  white-space: nowrap !important;
}
.analysis-agent-manager--label-wrap :deep(.el-form-item__label) {
  white-space: normal;
  line-height: 1.4;
  height: auto;
  word-break: break-word;
}

.skills-group {
  margin-top: var(--spacing-md);
}

.skills-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: var(--spacing-sm);
}

.visualization-skills-section {
  margin-top: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-md);
  border: 1px solid var(--el-border-color-lighter);
}

.form-tip {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-left: 10px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

/* Left-align the dialog title */
.agent-edit-dialog :deep(.el-dialog__header) {
  padding-right: var(--el-dialog-padding);
}

.agent-edit-dialog :deep(.el-dialog__title) {
  text-align: left;
}

.agent-skills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.visualization-skills-section {
  margin-top: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-md);
  border: 1px solid var(--el-border-color-lighter);
}

.form-tip {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-left: 10px;
}

.agents-container {
  flex: 1;
  overflow-y: auto;
}

.sort-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  margin-bottom: var(--spacing-md);
}

.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-lg);
}

.agent-card {
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  transition: all 0.2s ease;
  box-shadow: var(--el-shadow-sm);
  cursor: default;
  position: relative;
}

.agent-card.dragging {
  opacity: 0.4;
}

/* Insertion bar centred in the grid gap on the side where the dragged card will land */
.agent-card.insert-before::before,
.agent-card.insert-after::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 999px;
  background: var(--el-color-primary);
  pointer-events: none;
}

.agent-card.insert-before::before {
  left: calc(var(--spacing-lg) / -2 - 2px);
}

.agent-card.insert-after::after {
  right: calc(var(--spacing-lg) / -2 - 2px);
}

.agent-card:hover {
  border-color: var(--el-border-color);
  box-shadow: var(--el-shadow-md);
}

.agent-card.disabled {
  opacity: 0.5;
}

.agent-header {
  margin-bottom: 16px;
}

.agent-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.drag-handle {
  flex-shrink: 0;
  cursor: grab;
  color: var(--el-text-color-placeholder);
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 4px;
  transition: color 0.15s ease;
}

.drag-handle:hover {
  color: var(--el-color-primary);
}

.drag-handle:active {
  cursor: grabbing;
}

.agent-title {
  flex: 1;
  font-weight: 600;
  font-size: var(--text-lg);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-actions {
  flex-shrink: 0;
}

.more-btn {
  color: var(--el-text-color-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.more-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}

.agent-description {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  margin-bottom: var(--spacing-sm);
}

.no-skills {
  font-size: var(--text-xs);
  color: var(--el-text-color-placeholder);
  font-style: italic;
}

.empty-state {
  text-align: center;
  padding: var(--spacing-3xl) var(--spacing-xl);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-xl);
  border: 2px dashed var(--el-border-color);
}

.agent-dropdown-menu {
  padding: 4px 0;
}

.agent-dropdown-menu .el-dropdown-menu__item {
  padding: 6px 16px;
  font-size: var(--text-sm);
  border-radius: 4px;
  margin: 0 4px;
}

.agent-dropdown-menu .el-dropdown-menu__item:hover {
  background: var(--el-fill-color-light);
}

.agent-dropdown-menu .el-dropdown-menu__item--divided {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--el-border-color-light);
}

:deep(.el-dialog) {
  border-radius: var(--radius-lg);
}

:deep(.el-dialog__header) {
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

:deep(.el-dialog__title) {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

:deep(.el-dialog__body) {
  padding: var(--spacing-lg);
}

:deep(.el-dialog__footer) {
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-lighter);
}

:deep(.el-form-item__label) {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

:deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}

@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-sm);
  }

  .agents-grid {
    grid-template-columns: 1fr;
  }
}

.admin-avatar-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.admin-avatar-option {
  width: 36px;
  height: 36px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
  color: var(--el-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.16s ease;
  padding: 0;
}
.admin-avatar-option:hover,
.admin-avatar-option.active {
  border-color: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}
.admin-avatar-color-option {
  width: 36px;
  height: 36px;
  border: 2px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.16s ease;
  padding: 0;
}
.admin-avatar-color-option:hover {
  transform: scale(1.1);
}
.admin-avatar-color-option.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 15%, transparent);
}
</style>
