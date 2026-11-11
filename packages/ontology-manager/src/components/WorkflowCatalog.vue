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
import type {
  CapabilityGrantRecord,
  SmartAsset,
  SubjectRecord,
  WorkflowRecord,
  WorkflowStepRecord,
} from "../api";
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
  loadCapabilityGrants,
  loadSmartAssets,
  loadSubjects,
} = useManagerClient();

const scopeKinds = ["all", "self_organization", "self_subtree", "self_descendants", "initiated_by_self", "assigned_to_self"] as const;
const contractFields = ["className", "idField", "stepField", "statusField", "orgField", "initiatorField", "assigneeField", "workflowRefField"] as const;
const workflows = ref<WorkflowRecord[]>([]);
const actions = ref<SmartAsset[]>([]);
/**
 * What this domain's roles are actually allowed to run.
 *
 * The executor only ever asks "may this subject run this action", so these rows are otherwise
 * write-only: without them an operator cannot tell what activating a revision approved. They are
 * read separately from the processes so a failure here degrades this panel instead of the page.
 */
const grants = ref<CapabilityGrantRecord[]>([]);
const grantsUnavailable = ref(false);
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
  await refreshGrants();
}

/**
 * The grants are an audit view, not the page's subject: a failure is reported in the panel and the
 * processes stay usable, rather than the whole page reading as empty.
 */
async function refreshGrants() {
  try {
    grants.value = await loadCapabilityGrants();
    grantsUnavailable.value = false;
  } catch {
    grants.value = [];
    grantsUnavailable.value = true;
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
  Object.assign(form, { id: undefined, name: "", description: "", runClassName: null, runContract: null, steps: [blankStep(1)] });
  editing.value = true;
}

/** The process whose authority is being read in the dialog. */
const grantsFor = ref<WorkflowRecord | null>(null);

async function openGrants(workflow: WorkflowRecord) {
  grantsFor.value = workflow;
  // Opening the panel is the moment an operator wants a current answer, so reread rather than
  // showing what the list happened to load minutes ago.
  await refreshGrants();
}

function openEdit(workflow: WorkflowRecord) {
  Object.assign(form, {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? "",
    runClassName: workflow.runClassName,
    runContract: workflow.runContract ? { ...workflow.runContract, statusOpen: [...(workflow.runContract.statusOpen ?? [])] } : null,
    steps: (workflow.steps ?? []).map((step) => ({ ...step })),
  });
  editing.value = true;
}

function blankStep(no: number): WorkflowStepRecord {
  return { stepNo: no, name: "", roleCode: "", actionId: "", actionType: "approve", scope: "all" };
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
    await saveWorkflow({ ...form, name, steps, runClassName: form.runContract?.className ?? form.runClassName });
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

/**
 * The grants one process wrote, split by whether the revision is still the one in force.
 *
 * A row left behind by an earlier revision is not authority: the executor accepts only the revision
 * currently in force, so showing both together would claim authority the platform would refuse.
 * Reporting them apart is what tells an operator "the row is still stored, but it grants nothing".
 */
function workflowGrants(workflow: WorkflowRecord) {
  const rows = grants.value.filter((grant) => !!grant.workflowId && grant.workflowId === workflow.id);
  const version = workflow.version == null ? "" : String(workflow.version);
  return {
    inForce: rows.filter((grant) => grant.activatedByWorkflowVersion === version),
    superseded: rows.filter((grant) => grant.activatedByWorkflowVersion !== version),
  };
}

/** Rows granted by hand rather than by a process; they stand on their own. */
const directGrants = computed(() => grants.value.filter((grant) => !grant.workflowId));

/** The open dialog's split, recomputed from the latest read rather than captured on open. */
const grantPanel = computed(() =>
  grantsFor.value ? workflowGrants(grantsFor.value) : { inForce: [], superseded: [] }
);

/** Capability ids resolve to the business name of the action, so the panel reads in business words. */
function capabilityName(grant: CapabilityGrantRecord) {
  const id = grant.capabilityId ?? "";
  const named = actions.value.find((action) => action.id === id)?.name;
  return named || id || "-";
}

/** One line per role, listing the capabilities that role may run. */
function grantsByRole(rows: CapabilityGrantRecord[]) {
  const grouped = new Map<string, string[]>();
  for (const grant of rows) {
    const role = grant.roleCode || grant.roleId || "-";
    const capabilities = grouped.get(role) ?? [];
    const name = [capabilityName(grant), grant.stepNo, ot(`scope_${grant.scope.kind}`), grant.scope.field].filter(Boolean).join(" · ");
    if (!capabilities.includes(name)) capabilities.push(name);
    grouped.set(role, capabilities);
  }
  return [...grouped.entries()].map(([role, capabilities]) => ({ role, capabilities }));
}

/** The column summary: how wide this revision's authority is, or that it conveys none. */
function grantSummary(workflow: WorkflowRecord) {
  const { inForce } = workflowGrants(workflow);
  if (inForce.length === 0) return ot("workflowNoGrants");
  const roles = new Set(inForce.map((grant) => grant.roleCode || grant.roleId));
  return ot("workflowGrantsSummary", { roles: roles.size, capabilities: inForce.length });
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
        <el-table-column :label="ot('workflowColumnGrants')" min-width="180">
          <template #default="{ row }">
            <!--
              The count is the only summary safe to read at a glance: an empty authority is a state an
              operator must be able to see without opening anything, because an activated process that
              grants nothing looks identical to one that works.
            -->
            <el-button link type="primary" @click="openGrants(row)">
              <span class="workflow-grants" :class="{ 'workflow-grants--empty': workflowGrants(row).inForce.length === 0 }">
                {{ grantSummary(row) }}
              </span>
            </el-button>
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
        <el-button v-if="!form.runContract" @click="form.runContract = { className: form.runClassName ?? '', statusOpen: [] }">{{ ot("workflowContractAdd") }}</el-button>
        <template v-else>
          <h4>{{ ot("workflowContract") }}</h4>
          <el-form-item v-for="field in contractFields" :key="field" :label="ot(`contract_${field}`)">
            <el-input v-model="form.runContract[field]" />
          </el-form-item>
          <el-form-item :label="ot('contract_statusOpen')">
            <el-select v-model="form.runContract.statusOpen" multiple filterable allow-create default-first-option />
          </el-form-item>
          <el-button link @click="form.runContract = null">{{ ot("workflowContractRemove") }}</el-button>
        </template>

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
            <div class="workflow-step-fields">
              <el-form-item :label="ot('workflowStepName')">
                <el-input v-model="step.name" />
              </el-form-item>
              <el-form-item :label="ot('workflowStepRole')">
                <el-input v-model="step.roleCode" />
              </el-form-item>
              <el-form-item :label="ot('workflowStepAction')">
                <el-select v-model="step.actionId" filterable clearable :placeholder="ot('workflowStepAction')">
                  <el-option v-for="action in publishedActions" :key="action.id" :label="action.name" :value="action.id" />
                </el-select>
              </el-form-item>
              <el-form-item :label="ot('workflowScope')">
                <el-select v-model="step.scope">
                  <el-option v-for="kind in scopeKinds" :key="kind" :value="kind" :label="ot(`scope_${kind}`)" />
                </el-select>
              </el-form-item>
            </div>
            <el-button link type="danger" :aria-label="ot('workflowDelete')" @click="removeStep(index)">
              <Trash2 :size="14" />
            </el-button>
          </div>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="editing = false">{{ ot("workflowCancel") }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ ot("workflowSave") }}</el-button>
      </template>
    </el-dialog>

    <!--
      The authority panel. It separates three things the stored rows alone conflate: what the revision
      in force grants, rows an earlier revision left behind, and grants no process wrote at all. Only
      the first is authority, and an operator reading this panel has to be able to tell them apart —
      otherwise a stale row reads as permission.
    -->
    <el-dialog
      :model-value="grantsFor !== null"
      :lock-scroll="false"
      :title="ot('workflowGrantsTitle')"
      width="min(720px, 94cqw)"
      @update:model-value="(open: boolean) => { if (!open) grantsFor = null; }"
    >
      <p class="workflow-grants-desc">{{ ot("workflowGrantsDesc") }}</p>

      <el-empty v-if="grantsUnavailable" :description="ot('workflowGrantsUnavailable')" :image-size="60" />
      <el-empty
        v-else-if="grantPanel.inForce.length === 0 && grantPanel.superseded.length === 0"
        :description="ot('workflowGrantsEmpty')"
        :image-size="60"
      />
      <template v-else>
        <div v-if="grantPanel.inForce.length > 0" class="workflow-grants-group">
          <h4>{{ ot("workflowGrantsInForce", { version: grantsFor?.version ?? 0 }) }}</h4>
          <el-table :data="grantsByRole(grantPanel.inForce)" row-key="role" size="small">
            <el-table-column :label="ot('workflowStepRole')" width="200">
              <template #default="{ row }"><span class="workflow-grant-role">{{ row.role }}</span></template>
            </el-table-column>
            <el-table-column :label="ot('workflowStepAction')">
              <template #default="{ row }">
                <el-tag v-for="name in row.capabilities" :key="name" class="workflow-grant-tag" effect="plain">
                  {{ name }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="grantPanel.superseded.length > 0" class="workflow-grants-group">
          <h4>{{ ot("workflowGrantsSuperseded") }}</h4>
          <p class="workflow-grants-hint">{{ ot("workflowGrantsSupersededHint") }}</p>
          <el-table :data="grantsByRole(grantPanel.superseded)" row-key="role" size="small">
            <el-table-column :label="ot('workflowStepRole')" width="200">
              <template #default="{ row }"><span class="workflow-grant-role">{{ row.role }}</span></template>
            </el-table-column>
            <el-table-column :label="ot('workflowStepAction')">
              <template #default="{ row }">
                <el-tag v-for="name in row.capabilities" :key="name" class="workflow-grant-tag" type="info" effect="plain">
                  {{ name }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="directGrants.length > 0" class="workflow-grants-group">
          <h4>{{ ot("workflowGrantsDirect") }}</h4>
          <p class="workflow-grants-hint">{{ ot("workflowGrantsDirectHint") }}</p>
          <el-table :data="grantsByRole(directGrants)" row-key="role" size="small">
            <el-table-column :label="ot('workflowStepRole')" width="200">
              <template #default="{ row }"><span class="workflow-grant-role">{{ row.role }}</span></template>
            </el-table-column>
            <el-table-column :label="ot('workflowStepAction')">
              <template #default="{ row }">
                <el-tag v-for="name in row.capabilities" :key="name" class="workflow-grant-tag" type="success" effect="plain">
                  {{ name }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>

      <template #footer>
        <el-button @click="refreshGrants">{{ ot("workflowGrantsRefresh") }}</el-button>
        <el-button type="primary" @click="grantsFor = null">{{ ot("workflowCancel") }}</el-button>
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
.workflow-grants {
  font-size: 13px;
}
/* An activated process that conveys nothing is the state that reads as working until someone checks. */
.workflow-grants--empty {
  color: var(--el-color-warning);
}
.workflow-grants-desc {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.workflow-grants-group {
  margin-bottom: 16px;
}
.workflow-grants-group h4 {
  margin: 0 0 4px;
  font-size: 14px;
}
.workflow-grants-hint {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.workflow-grant-role {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 13px;
}
.workflow-grant-tag {
  margin: 0 4px 4px 0;
}
.workflow-steps-editor {
  container: workflow-steps / inline-size;
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding-block: 12px;
  border-block-start: 1px solid var(--el-border-color-lighter);
}
.workflow-step-no {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.workflow-step-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.workflow-step-fields > .el-form-item {
  min-width: 0;
  margin: 0;
}
@container workflow-steps (min-width: 48rem) {
  .workflow-step-fields { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@container workflow-steps (max-width: 30rem) {
  .workflow-step-fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
