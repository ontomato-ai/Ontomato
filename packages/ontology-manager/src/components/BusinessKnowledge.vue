<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { createAgentHostClient } from "@ontomato/agent-shell-ui";
import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import {
  ElButton,
  ElCheckbox,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSegmented,
  ElTag,
  vLoading,
} from "element-plus";
import { ArrowLeft, BookOpen, Check, Pencil, Plus, Search, Trash2 } from "lucide-vue-next";
import type { BusinessKnowledge } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { useManagerFeedback } from "../feedback";

/**
 * `pageDraft` is the agent draft the address named, if any: the originating run and the draft's path inside it. The page
 * reads it through that run's artifacts and fills it in; `draftApplied` tells the host the address no longer needs it.
 * `governance` asks the host to open a governance conversation with the agent the page's skill mapping names.
 */
const props = withDefaults(defineProps<{
  pageDraft?: { sessionId: string; runId: string; path: string } | null;
}>(), { pageDraft: null });
const emit = defineEmits<{ draftApplied: []; governance: [agentId: string] }>();

const context = useManagerContext();
const client = useManagerClient();

const { ot } = useOntologyText();
const { t } = useSharedText();
const { message, confirm } = useManagerFeedback();

type StatusFilter = "all" | "pending" | "approved";
type Segment = { text: string; hit: boolean };

const loading = ref(false);
const saving = ref(false);
const list = ref<BusinessKnowledge[]>([]);
const query = ref("");
const statusFilter = ref<StatusFilter>("all");
const checked = ref<string[]>([]);
const selectedID = ref<string | null>(null);
// Below the narrow breakpoint the list and the detail take turns; this marks that the detail was opened.
const narrowDetail = ref(false);
const editing = ref(false);
const draft = reactive<BusinessKnowledge>(emptyKnowledge());

// Offers this edition's three stored tag values (labels come from Manager messages) and also accepts custom tags.
const tagOptions = computed(() => [
  { value: context.knowledgeTagValues.general, label: ot("knowledgeTagGeneral") },
  { value: context.knowledgeTagValues.business, label: ot("knowledgeTagBusiness") },
  { value: context.knowledgeTagValues.tech, label: ot("knowledgeTagTech") },
]);

function emptyKnowledge(): BusinessKnowledge {
  return { knowledgeID: "", knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 1 };
}

/**
 * The draft an agent wrote for this page. The address carries the originating run and the draft's path; the draft is
 * read through that run's own artifacts, and filling it in is the whole of what this page does with an agent's work:
 * nothing is saved until the reader saves, and what was filled is held against the entry it was compared with, so the
 * fields the draft changed can be marked.
 */
const draftBase = ref<BusinessKnowledge | null>(null);
const draftFields = ref<ReadonlySet<keyof BusinessKnowledge>>(new Set());

// Space-separated terms, case-insensitive; an entry matches when every term occurs in its title, content or tags.
const terms = computed(() => query.value.trim().toLowerCase().split(/\s+/).filter(Boolean));
const termPattern = computed(() =>
  terms.value.length
    ? new RegExp(
        // Longer terms first, so a term that contains a shorter one is highlighted whole.
        `(${[...terms.value]
          .sort((a, b) => b.length - a.length)
          .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|")})`,
        "gi"
      )
    : null
);

const matched = computed(() => {
  if (!terms.value.length) return list.value;
  const hits = list.value.filter((item) => {
    const text = [item.knowledgeTitle, item.knowledgeText, ...item.knowledgeTags].join("\n").toLowerCase();
    return terms.value.every((term) => text.includes(term));
  });
  const titleHits = (item: BusinessKnowledge) =>
    terms.value.filter((term) => item.knowledgeTitle.toLowerCase().includes(term)).length;
  return hits.sort((a, b) => titleHits(b) - titleHits(a));
});

const counts = computed(() => {
  const pending = matched.value.filter((item) => item.status !== 1).length;
  return { all: matched.value.length, pending, approved: matched.value.length - pending };
});

const visible = computed(() =>
  statusFilter.value === "all"
    ? matched.value
    : matched.value.filter((item) => (item.status === 1) === (statusFilter.value === "approved"))
);

const statusTabs = computed<{ value: StatusFilter; label: string; count: number }[]>(() => [
  { value: "all", label: ot("knowledgeFilterAll"), count: counts.value.all },
  { value: "pending", label: ot("pendingReview"), count: counts.value.pending },
  { value: "approved", label: ot("knowledgeApproved"), count: counts.value.approved },
]);

// The detail follows the chosen entry while it is in the visible list; otherwise (nothing chosen, filtered out,
// deleted, or approved under the pending filter) it shows the first visible entry, so review moves on to the next one.
const selected = computed(
  () => visible.value.find((item) => item.knowledgeID === selectedID.value) ?? visible.value[0] ?? null
);

const allVisibleChecked = computed(
  () => visible.value.length > 0 && visible.value.every((item) => checked.value.includes(item.knowledgeID))
);
const someVisibleChecked = computed(() => !allVisibleChecked.value
  && visible.value.some((item) => checked.value.includes(item.knowledgeID)));
const checkedEntries = computed(() => list.value.filter((item) => checked.value.includes(item.knowledgeID)));
const checkedPending = computed(() => checkedEntries.value.filter((item) => item.status !== 1));

function segments(text: string): Segment[] {
  if (!termPattern.value) return [{ text, hit: false }];
  return text
    .split(termPattern.value)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: terms.value.includes(part.toLowerCase()) }));
}

// The list summary starts shortly before the first content hit so that the hit is inside the two visible lines.
function summary(text: string): Segment[] {
  const lower = text.toLowerCase();
  const first = Math.min(...terms.value.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  return Number.isFinite(first) && first > 24 ? segments(`…${text.slice(first - 12)}`) : segments(text);
}

async function load() {
  loading.value = true;
  try {
    list.value = await client.listKnowledge();
    checked.value = checked.value.filter((id) => list.value.some((item) => item.knowledgeID === id));
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeLoadFailed"));
  } finally {
    loading.value = false;
  }
}

function draftChanged() {
  const original = draft.knowledgeID
    ? list.value.find((item) => item.knowledgeID === draft.knowledgeID)
    : emptyKnowledge();
  return JSON.stringify(draft) !== JSON.stringify(original);
}

/** Leaving an edit with unsaved changes asks first; resolves false when the user keeps editing. */
async function leaveEdit() {
  if (!editing.value) return true;
  if (draftChanged()) {
    try {
      await confirm(ot("knowledgeDiscardConfirm"), ot("knowledgeDiscardTitle"));
    } catch {
      return false;
    }
  }
  editing.value = false;
  return true;
}

async function select(item: BusinessKnowledge) {
  if (!(await leaveEdit())) return;
  selectedID.value = item.knowledgeID;
  narrowDetail.value = true;
}

async function openCreate() {
  if (!(await leaveEdit())) return;
  Object.assign(draft, emptyKnowledge());
  editing.value = true;
  narrowDetail.value = true;
}

function openEdit(item: BusinessKnowledge) {
  Object.assign(draft, { ...item, knowledgeTags: [...item.knowledgeTags] });
  editing.value = true;
}

function toggleChecked(id: string, value: boolean) {
  checked.value = value ? [...checked.value, id] : checked.value.filter((item) => item !== id);
}

function toggleAllVisible(value: boolean) {
  const ids = visible.value.map((item) => item.knowledgeID);
  checked.value = value
    ? [...new Set([...checked.value, ...ids])]
    : checked.value.filter((id) => !ids.includes(id));
}

/** Whether the draft changed this field against the entry the form was filled from. */
const draftTouched = (field: keyof BusinessKnowledge) => draftFields.value.has(field);

/** The fields of `form` whose value differs from `base`; the form itself is the page's own save input. */
function changedFields(base: BusinessKnowledge, form: BusinessKnowledge): (keyof BusinessKnowledge)[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const fields: (keyof BusinessKnowledge)[] = ["knowledgeTitle", "knowledgeText", "knowledgeTags", "status"];
  return fields.filter((field) => !same(base[field], form[field]));
}

/**
 * Fills a draft into this page's form. An update reads the entry it names from the list and compares against it; a
 * create compares against the page's own new-entry defaults. A draft whose form is not this page's save input, or whose
 * operation or target is not one this page holds, is reported rather than guessed at.
 */
async function applyDraft(sessionId: string, runId: string, path: string) {
  const read = createAgentHostClient({ request: (path, init) => client.request(path, init, "") });
  const envelope = await read.readPageDraft(sessionId, runId, path);
  if (envelope.pageKey !== "business-knowledge")
    throw new Error(`a ${envelope.pageKey} draft is not a business knowledge draft`);
  if (envelope.operation !== "knowledge.create" && envelope.operation !== "knowledge.update")
    throw new Error(`business knowledge has no ${envelope.operation} form`);
  const form = formOf(envelope.form);
  const base = envelope.operation === "knowledge.create"
    ? emptyKnowledge()
    : list.value.find((item) => item.knowledgeID === envelope.target.id);
  if (!base) throw new Error(`knowledge ${envelope.target.id} is not in this domain`);
  if (envelope.operation === "knowledge.update" && form.knowledgeID !== envelope.target.id)
    throw new Error(`the draft changes ${envelope.target.id} but its form names ${form.knowledgeID}`);
  // A manual edit in progress is not overwritten silently: the existing question decides, and a refusal leaves it.
  if (!(await leaveEdit())) return false;
  draftBase.value = base;
  draftFields.value = new Set(changedFields(base, form));
  Object.assign(draft, form);
  editing.value = true;
  narrowDetail.value = true;
  return true;
}

/** The draft's `form` as this page's save input; a form of another shape is the draft's own error, not a partial fill. */
function formOf(value: Record<string, unknown>): BusinessKnowledge {
  const tags = value.knowledgeTags;
  if (typeof value.knowledgeID !== "string" || typeof value.knowledgeTitle !== "string" ||
    typeof value.knowledgeText !== "string" || typeof value.status !== "number" ||
    !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))
    throw new Error(ot("knowledgeDraftInvalid", { reason: "it has no knowledge form" }));
  return {
    knowledgeID: value.knowledgeID, knowledgeTitle: value.knowledgeTitle,
    knowledgeText: value.knowledgeText, knowledgeTags: tags as string[], status: value.status,
  };
}

/** The draft the address names: reading it fills the form, and a saved one leaves the address's parameters behind. */
async function readDraft() {
  const draft = props.pageDraft;
  if (!draft) return;
  try {
    if (await applyDraft(draft.sessionId, draft.runId, draft.path)) message.info(ot("knowledgeDraftApply"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The governance conversation: the page's skill mapping names the agent a governance run uses, and the agent platform
 * opens a new conversation with it. The id is read from the platform rather than written here, so a domain's own preset
 * definition is the one opened.
 */
async function openGovernance() {
  try {
    const list = assistantAgentListSchema.parse(await (await client.request(
      `/assistant/agents?${new URLSearchParams({ pageKey: "governance-report", permissionCode: "business-knowledge" })}`,
      {}, "")).json());
    if (!list.defaultAgentId) throw new Error(ot("knowledgeGovernanceUnavailable"));
    emit("governance", list.defaultAgentId);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeGovernanceUnavailable"));
  }
}

async function save() {
  if (!draft.knowledgeTitle.trim()) {
    message.warning(ot("knowledgeTitleRequired"));
    return;
  }
  saving.value = true;
  try {
    await client.saveKnowledge({ ...draft });
    message.success(ot("knowledgeSaved"));
    editing.value = false;
    // A new entry's ID is assigned by the data engine and not returned, so only an edit keeps its selection.
    selectedID.value = draft.knowledgeID || null;
    const applied = draftBase.value !== null;
    draftBase.value = null;
    draftFields.value = new Set();
      await load();
    if (applied) emit("draftApplied");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function approve(item: BusinessKnowledge) {
  try {
    await client.saveKnowledge({ ...item, status: 1 });
    message.success(ot("knowledgeApprovedDone"));
    await load();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeSaveFailed"));
  }
}

async function remove(item: BusinessKnowledge) {
  try {
    await confirm(ot("knowledgeDeleteConfirm", { name: item.knowledgeTitle }), ot("deleteConfirmTitle"));
    await client.deleteKnowledge(item.knowledgeID);
    message.success(ot("knowledgeDeleted"));
    await load();
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("knowledgeDeleteFailed"));
  }
}

async function approveChecked() {
  const results = await Promise.allSettled(
    checkedPending.value.map((item) => client.saveKnowledge({ ...item, status: 1 }))
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    message.warning(ot("knowledgeBatchApproveFailed", { failed, total: results.length }));
  } else {
    message.success(ot("knowledgeBatchApproved"));
  }
  await load();
}

async function removeChecked() {
  const targets = checkedEntries.value;
  try {
    await confirm(ot("knowledgeBatchDeleteConfirm", { n: targets.length }), ot("deleteConfirmTitle"));
  } catch {
    return;
  }
  const results = await Promise.allSettled(
    targets.map((item) => client.deleteKnowledge(item.knowledgeID))
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    message.warning(ot("knowledgeBatchDeleteFailed", { failed, total: results.length }));
  } else {
    message.success(ot("knowledgeBatchDeleted"));
  }
  await load();
}
onMounted(async () => {
  await load();
  await readDraft();
});
// Another draft at the same page (a link opened while it is shown) is filled the same way.
watch(() => props.pageDraft?.path, () => void readDraft());
</script>

<template>
  <section class="business-knowledge" :class="{ 'narrow-detail': narrowDetail }">
    <!-- The platform's one page header: the title, its line of description, and this page's own buttons. -->
    <PlatformPageHeader compact :title="t('nav.businessKnowledge')" :description="ot('knowledgeDesc')">
      <template #actions>
        <el-button @click="openGovernance">
          <BookOpen :size="16" />
          {{ ot("knowledgeGovernance") }}
        </el-button>
        <el-button type="primary" @click="openCreate">
          <Plus :size="16" />
          {{ ot("knowledgeAdd") }}
        </el-button>
      </template>
    </PlatformPageHeader>

    <!-- The page under the header takes the page gutter: the filters and the list with its detail start where the title
         does, and the two panes sit in one bordered block like a table. -->
    <div class="knowledge-page platform-page-gutter">
      <div class="knowledge-toolbar">
        <el-input
          v-model="query"
          :prefix-icon="Search"
          :placeholder="ot('knowledgeSearchPlaceholder')"
          clearable
          class="knowledge-search"
        />
        <el-segmented v-model="statusFilter" :options="statusTabs" class="knowledge-filters secondary-segmented" :aria-label="ot('status')">
          <template #default="{ item }">
            <span class="knowledge-filter-label"><span>{{ item.label }}</span> <span class="knowledge-filter-count">{{ item.count }}</span></span>
          </template>
        </el-segmented>
      </div>

      <div class="knowledge-body">
        <aside v-loading="loading" class="knowledge-list">
          <div class="knowledge-list-head">
            <div class="knowledge-selection-row">
              <el-checkbox
                :model-value="allVisibleChecked"
                :indeterminate="someVisibleChecked"
                :disabled="!visible.length"
                @update:model-value="toggleAllVisible(Boolean($event))"
              >
                {{ ot("knowledgeCheckAll") }}
              </el-checkbox>
              <span v-if="checked.length" class="knowledge-checked" role="status">{{ ot("knowledgeChecked", { n: checked.length }) }}</span>
            </div>
            <template v-if="checked.length">
              <div class="knowledge-batch-actions" role="group" :aria-label="ot('knowledgeChecked', { n: checked.length })">
              <el-button v-if="checkedPending.length" size="small" text @click="approveChecked">
                <Check :size="14" />
                {{ ot("knowledgeBatchApprove") }}
              </el-button>
              <el-button size="small" text type="danger" @click="removeChecked">
                <Trash2 :size="14" />
                {{ ot("knowledgeBatchDelete") }}
              </el-button>
              <el-button size="small" link @click="checked = []">{{ ot("knowledgeClearChecked") }}</el-button>
              </div>
            </template>
          </div>
          <div
            v-for="item in visible"
            :key="item.knowledgeID"
            :class="['knowledge-item', { active: !editing && selected?.knowledgeID === item.knowledgeID }]"
          >
            <el-checkbox
              :model-value="checked.includes(item.knowledgeID)"
              class="knowledge-item-check"
              @update:model-value="toggleChecked(item.knowledgeID, Boolean($event))"
            />
            <button type="button" class="knowledge-item-main" @click="select(item)">
              <span class="knowledge-item-title">
                <i :class="['knowledge-dot', { pending: item.status !== 1 }]" />
                <span>
                  <template v-for="(part, index) in segments(item.knowledgeTitle)" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
              </span>
              <span class="knowledge-item-summary">
                <template v-for="(part, index) in summary(item.knowledgeText)" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="item.knowledgeTags.length" class="knowledge-item-tags">
                <el-tag v-for="tag in item.knowledgeTags" :key="tag" size="small" type="info">{{ tag }}</el-tag>
              </span>
            </button>
          </div>
          <el-empty
            v-if="!loading && !visible.length"
            :description="ot(list.length ? 'knowledgeNoMatch' : 'knowledgeNoData')"
            :image-size="72"
          />
        </aside>

        <article class="knowledge-detail">
          <button type="button" class="knowledge-back" @click="narrowDetail = false">
            <ArrowLeft :size="16" />
            {{ ot("knowledgeBackToList") }}
          </button>

          <el-form v-if="editing" :model="draft" label-position="top" class="knowledge-form">
            <h2>{{ ot(draft.knowledgeID ? "knowledgeEdit" : "knowledgeAdd") }}</h2>
            <!-- The agent wrote this form; the fields it changed against the entry are marked until the reader saves. -->
            <p v-if="draftBase" class="knowledge-draft-note" role="status">{{ ot("knowledgeDraftApply") }}</p>
            <el-form-item :label="ot('knowledgeTitle')" required :class="{ 'draft-changed': draftTouched('knowledgeTitle') }">
              <el-input v-model="draft.knowledgeTitle" :placeholder="ot('knowledgeTitlePlaceholder')" />
            </el-form-item>
            <el-form-item :label="ot('knowledgeContent')" required :class="{ 'draft-changed': draftTouched('knowledgeText') }">
              <el-input
                v-model="draft.knowledgeText"
                type="textarea"
                :autosize="{ minRows: 8, maxRows: 24 }"
                :placeholder="ot('knowledgeContentPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="ot('knowledgeTags')" :class="{ 'draft-changed': draftTouched('knowledgeTags') }">
              <el-select
                v-model="draft.knowledgeTags"
                multiple
                filterable
                allow-create
                :placeholder="ot('knowledgeTagsPlaceholder')"
                class="knowledge-tag-select"
              >
                <el-option
                  v-for="option in tagOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item :label="ot('status')" :class="{ 'draft-changed': draftTouched('status') }">
              <el-radio-group v-model="draft.status">
                <el-radio :value="0">{{ ot("pendingReview") }}</el-radio>
                <el-radio :value="1">{{ ot("knowledgeApproved") }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <div class="knowledge-detail-actions">
              <el-button @click="leaveEdit">{{ ot("cancel") }}</el-button>
              <el-button type="primary" :loading="saving" @click="save">{{ ot("save") }}</el-button>
            </div>
          </el-form>

          <template v-else-if="selected">
            <header class="knowledge-detail-head">
              <h2>
                <template v-for="(part, index) in segments(selected.knowledgeTitle)" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </h2>
              <el-tag v-if="selected.status === 1" type="success">{{ ot("knowledgeApproved") }}</el-tag>
              <el-tag v-else type="warning">{{ ot("pendingReview") }}</el-tag>
            </header>
            <div v-if="selected.knowledgeTags.length" class="knowledge-detail-tags">
              <el-tag v-for="tag in selected.knowledgeTags" :key="tag" size="small" type="info">{{ tag }}</el-tag>
            </div>
            <div class="knowledge-detail-text">
              <template v-for="(part, index) in segments(selected.knowledgeText)" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </div>
            <div class="knowledge-detail-actions">
              <el-button v-if="selected.status !== 1" type="primary" @click="approve(selected)">
                <Check :size="16" />
                {{ ot("knowledgeApprove") }}
              </el-button>
              <el-button @click="openEdit(selected)">
                <Pencil :size="16" />
                {{ t("common.edit") }}
              </el-button>
              <el-button type="danger" plain @click="remove(selected)">
                <Trash2 :size="16" />
                {{ ot("delete") }}
              </el-button>
            </div>
          </template>

          <el-empty v-else :description="ot('knowledgeSelectHint')" :image-size="72" />
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * The page paints no background of its own: it sits on the application's area, the darkest band in dark mode
 * (DESIGN.md "Colour roles").
 */
.business-knowledge {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.knowledge-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding-bottom: var(--manager-module-gap);
}
.business-knowledge :deep(.el-button) {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}
.knowledge-toolbar {
  display: flex;
  flex-wrap: wrap;
  min-height: 40px;
  align-items: center;
  gap: var(--manager-content-gap);
  margin-block: var(--manager-content-gap);
}
.knowledge-search {
  flex: 0 1 360px;
  min-width: 0;
}
.knowledge-filters {
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
}
.knowledge-filter-label {
  display: inline-flex;
  align-items: center;
  gap: var(--manager-control-gap);
}
.knowledge-filter-count {
  color: inherit;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.knowledge-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
}
.knowledge-list {
  overflow-y: auto;
  border-right: 1px solid var(--el-border-color);
}
.knowledge-list-head {
  position: sticky;
  z-index: 1;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--manager-control-gap);
  padding: var(--manager-control-gap) var(--manager-content-gap);
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  font-size: var(--text-sm);
}
.knowledge-selection-row {
  display: flex;
  min-height: var(--control-height-sm);
  align-items: center;
  justify-content: space-between;
  gap: var(--manager-control-gap);
}
.knowledge-selection-row :deep(.el-checkbox) {
  height: var(--control-height-sm);
  margin: 0;
}
.knowledge-selection-row :deep(.el-checkbox__label) {
  font-size: var(--text-sm);
}
.knowledge-batch-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--manager-control-gap);
  margin-top: var(--manager-label-gap);
  padding-top: var(--manager-content-gap);
  border-top: 1px solid var(--el-border-color-lighter);
}
.knowledge-list-head :deep(.el-button + .el-button) {
  margin-left: 0;
}
.knowledge-checked {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.knowledge-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--manager-content-gap);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.knowledge-item:hover {
  background: var(--el-fill-color-lighter);
}
.knowledge-item.active {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.knowledge-item-check {
  height: 22px;
}
.knowledge-item-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--manager-label-gap);
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.knowledge-item-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: 22px;
}
.knowledge-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--el-color-success);
}
.knowledge-dot.pending {
  background: var(--el-color-warning);
}
.knowledge-item-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-line;
}
.knowledge-item-tags,
.knowledge-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.knowledge-detail {
  min-width: 0;
  overflow-y: auto;
  padding: var(--manager-module-padding);
}
.knowledge-detail h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.knowledge-detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
}
.knowledge-detail-tags {
  margin-top: var(--manager-content-gap);
}
.knowledge-detail-text {
  margin-top: var(--manager-content-gap);
  padding-top: var(--manager-content-gap);
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}
.knowledge-form {
  display: flex;
  flex-direction: column;
  gap: var(--manager-module-gap);
}
.knowledge-draft-note {
  margin: 0;
  color: var(--el-color-primary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.knowledge-form .draft-changed :deep(.el-form-item__label) {
  color: var(--el-color-primary);
  font-weight: var(--font-semibold);
}
.knowledge-form h2,
.knowledge-form :deep(.el-form-item),
.knowledge-form .knowledge-detail-actions {
  margin: 0;
}
.knowledge-detail-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--manager-module-gap);
}
.knowledge-detail-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.knowledge-tag-select {
  width: 100%;
}
.business-knowledge mark {
  border-radius: 2px;
  color: inherit;
  background: var(--el-color-warning-light-7);
}
.knowledge-back {
  display: none;
}
@container ontology-manager (max-width: 760px) {
  .knowledge-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .knowledge-list {
    border-right: 0;
  }
  .narrow-detail .knowledge-list,
  .business-knowledge:not(.narrow-detail) .knowledge-detail {
    display: none;
  }
  .knowledge-back {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
    padding: 0;
    border: 0;
    color: var(--brand-link);
    background: transparent;
    cursor: pointer;
    font-size: var(--text-sm);
  }
}
</style>
