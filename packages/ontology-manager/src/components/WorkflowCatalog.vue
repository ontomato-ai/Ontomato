<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  ElButton,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  vLoading,
} from "element-plus";
import { ArrowDownUp, Pause, Play, Plus, Trash2 } from "lucide-vue-next";
import type { SmartAsset, SubjectRecord, WorkflowRecord, WorkflowStepRecord } from "../api";
import { useManagerClient, useOntologyText } from "../context";
import { useManagerFeedback } from "../feedback";

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const {
  loadWorkflows,
  saveWorkflow,
  activateWorkflow,
  deactivateWorkflow,
  deleteWorkflow,
  loadSmartAssets,
  loadSubjects,
} = useManagerClient();

const workflows = ref<WorkflowRecord[]>([]);
const actions = ref<SmartAsset[]>([]);
/** Provenance ids are what is stored; names are resolved here so a renamed account reads current. */
const subjectNames = ref<Record<string, string>>({});
const loading = ref(false);
const saving = ref(false);
const editing = ref(false);
const form = reactive<WorkflowRecord>({ name: "", description: "", steps: [] });

/**
 * Status is only a projection of the newest event, so the wording names what the process may do now:
 * an active revision conveys authority, a draft and an inactive one convey none.
 */
function statusTag(status?: string) {
  if (status === "ACTIVE") return { type: "success" as const, text: ot("workflowActive") };
  if (status === "INACTIVE") return { type: "info" as const, text: ot("workflowInactive") };
  return { type: "warning" as const, text: ot("workflowDraft") };
}

/**
 * Provenance is stored as a subject id, so the table resolves it rather than storing a copy of the
 * name. An unresolvable id shows as a dash instead of the raw id: a bare uuid in a column that says
 * "who" reads as a person, which it is not.
 */
function subjectName(id?: string | null) {
  if (!id) return ot("unspecified");
  return subjectNames.value[id] ?? ot("unspecified");
}

/** Only actions with an id can be named by a step; the catalogue's drafts may have none. */
const publishedActions = computed(() =>
  actions.value.filter(
    (action): action is SmartAsset & { id: string } =>
      typeof action.id === "string" && (!action.status || action.status === "PUBLISHED")
  )
);

async function refresh() {
  loading.value = true;
  try {
    workflows.value = await loadWorkflows();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refresh();
  try {
    // Names are a display concern: a missing directory must not block the page.
    const subjects = await loadSubjects();
    subjectNames.value = Object.fromEntries(
      subjects.map((subject: SubjectRecord) => [
        subject.id,
        subject.displayName || subject.loginCode || subject.id,
      ])
    );
  } catch {
    subjectNames.value = {};
  }
  try {
    actions.value = await loadSmartAssets("actions");
  } catch {
    // The step editor still accepts free text; a missing catalogue must not block the page.
    actions.value = [];
  }
});

function openCreate() {
  Object.assign(form, { id: undefined, name: "", description: "", steps: [blankStep(1)] });
  editing.value = true;
}

function openEdit(workflow: WorkflowRecord) {
  Object.assign(form, {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? "",
    steps: (workflow.steps ?? []).map((step) => ({ ...step })),
  });
  editing.value = true;
}

function blankStep(no: number): WorkflowStepRecord {
  return { stepNo: no, name: "", roleCode: "", actionId: "", actionType: "approve", assignRule: "dept_role" };
}

function addStep() {
  const steps = form.steps ?? (form.steps = []);
  steps.push(blankStep(steps.length + 1));
}

function removeStep(index: number) {
  form.steps?.splice(index, 1);
  form.steps?.forEach((step, at) => (step.stepNo = at + 1));
}

async function save() {
  const name = (form.name ?? "").trim();
  if (!name) {
    message.warning(ot("workflowNameRequired"));
    return;
  }
  const steps = (form.steps ?? []).filter((step) => (step.roleCode ?? "").trim() || (step.actionId ?? "").trim());
  saving.value = true;
  try {
    await saveWorkflow({ ...form, name, steps });
    message.success(ot("workflowSaved"));
    editing.value = false;
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

/** Activation is the moment authority starts, so a refusal here is the point, not an obstacle. */
async function activate(workflow: WorkflowRecord) {
  try {
    await confirm(ot("workflowActivateConfirm", { name: workflow.name }), ot("workflowActivateTitle"));
  } catch {
    return;
  }
  try {
    await activateWorkflow(workflow.id as string);
    message.success(ot("workflowActivated"));
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  }
}

async function deactivate(workflow: WorkflowRecord) {
  try {
    await confirm(ot("workflowDeactivateConfirm", { name: workflow.name }), ot("workflowDeactivateTitle"));
  } catch {
    return;
  }
  try {
    await deactivateWorkflow(workflow.id as string);
    message.success(ot("workflowDeactivated"));
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  }
}

async function remove(workflow: WorkflowRecord) {
  try {
    await confirm(ot("workflowDeleteConfirm", { name: workflow.name }), ot("workflowDeleteTitle"));
  } catch {
    return;
  }
  try {
    await deleteWorkflow(workflow.id as string);
    message.success(ot("workflowDeleted"));
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  }
}

function stepSummary(workflow: WorkflowRecord) {
  const steps = workflow.steps ?? [];
  if (steps.length === 0) return ot("workflowNoSteps");
  return steps.map((step) => step.name || step.actionId || "-").join(" → ");
}
</script>

<template>
  <section class="workflow-surface">
    <header class="workflow-header">
      <div>
        <h2>{{ ot("workflowTitle") }}</h2>
        <p>{{ ot("workflowDesc") }}</p>
      </div>
      <div class="workflow-header__actions">
        <el-button :loading="loading" @click="refresh">{{ ot("workflowRefresh") }}</el-button>
        <el-button type="primary" @click="openCreate">
          <Plus :size="16" />
          <span>{{ ot("workflowCreate") }}</span>
        </el-button>
      </div>
    </header>

    <div v-loading="loading" class="workflow-body">
      <el-empty v-if="!loading && workflows.length === 0" :description="ot('workflowEmpty')" />
      <el-table v-else :data="workflows" row-key="id" class="workflow-table">
        <el-table-column :label="ot('workflowColumnName')" min-width="200">
          <template #default="{ row }">
            <div class="workflow-name">{{ row.name }}</div>
            <div v-if="row.description" class="workflow-desc">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="ot('workflowColumnStatus')" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status).type" effect="light">{{ statusTag(row.status).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="ot('workflowColumnVersion')" width="90">
          <template #default="{ row }">v{{ row.version ?? 0 }}</template>
        </el-table-column>
        <el-table-column :label="ot('workflowColumnSteps')" min-width="280">
          <template #default="{ row }">
            <span class="workflow-steps">{{ stepSummary(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="ot('workflowColumnCreatedBy')" width="130">
          <template #default="{ row }">{{ subjectName(row.createdBy) }}</template>
        </el-table-column>
        <el-table-column :label="ot('workflowColumnReviewedBy')" width="130">
          <template #default="{ row }">{{ subjectName(row.reviewedBy) }}</template>
        </el-table-column>
        <el-table-column :label="ot('workflowColumnOps')" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">
              <ArrowDownUp :size="14" />
              <span>{{ ot("workflowEdit") }}</span>
            </el-button>
            <el-button v-if="row.status !== 'ACTIVE'" link type="success" @click="activate(row)">
              <Play :size="14" />
              <span>{{ ot("workflowActivate") }}</span>
            </el-button>
            <el-button v-else link type="warning" @click="deactivate(row)">
              <Pause :size="14" />
              <span>{{ ot("workflowDeactivate") }}</span>
            </el-button>
            <el-button link type="danger" :disabled="row.status === 'ACTIVE'" @click="remove(row)">
              <Trash2 :size="14" />
              <span>{{ ot("workflowDelete") }}</span>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editing" :lock-scroll="false" :title="form.id ? ot('workflowEdit') : ot('workflowCreate')" width="min(860px, 94cqw)">
      <el-form label-position="top" class="workflow-form">
        <el-form-item :label="ot('workflowColumnName')">
          <el-input v-model="form.name" :placeholder="ot('workflowNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="ot('workflowColumnDesc')">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>

      <div class="workflow-steps-editor">
        <div class="workflow-steps-editor__header">
          <span>{{ ot("workflowColumnSteps") }}</span>
          <el-button link type="primary" @click="addStep">
            <Plus :size="14" />
            <span>{{ ot("workflowAddStep") }}</span>
          </el-button>
        </div>
        <div v-for="(step, index) in form.steps" :key="index" class="workflow-step-row">
          <span class="workflow-step-no">{{ index + 1 }}</span>
          <el-input v-model="step.name" :placeholder="ot('workflowStepName')" class="workflow-step-name" />
          <el-input v-model="step.roleCode" :placeholder="ot('workflowStepRole')" class="workflow-step-role" />
          <el-select v-model="step.actionId" filterable clearable :placeholder="ot('workflowStepAction')" class="workflow-step-action">
            <el-option v-for="action in publishedActions" :key="action.id" :label="action.name" :value="action.id" />
          </el-select>
          <el-button link type="danger" @click="removeStep(index)">
            <Trash2 :size="14" />
          </el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="editing = false">{{ ot("workflowCancel") }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ ot("workflowSave") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.workflow-surface {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  height: 100%;
  overflow: auto;
}
.workflow-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.workflow-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
}
.workflow-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.workflow-header__actions {
  display: flex;
  gap: 8px;
}
.workflow-body {
  flex: 1;
  min-height: 200px;
}
.workflow-name {
  font-weight: 600;
}
.workflow-desc {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.workflow-steps {
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.workflow-steps-editor {
  margin-top: 8px;
}
.workflow-steps-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 600;
}
.workflow-step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.workflow-step-no {
  width: 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.workflow-step-name {
  flex: 1.2;
}
.workflow-step-role {
  flex: 1;
}
.workflow-step-action {
  flex: 1.4;
}
</style>
