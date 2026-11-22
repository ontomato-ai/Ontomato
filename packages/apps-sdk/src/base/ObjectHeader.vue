<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { panelRecordObjectRef } from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey, readerDataState } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { useDataStateLabels } from "./data-state-labels";
import {
  formatOperationLabel,
  isOperationReady,
  resolveOperationTarget,
  useOperationRunner,
  type OperationOutcome,
} from "./operation-dispatch";
import OperationButton from "./OperationButton.vue";
import OperationInputDialog from "./OperationInputDialog.vue";
import OperationResult from "./OperationResult.vue";
import { displayFieldText, rawRecordField } from "./record-field";

interface HeaderOperationItem {
  readonly name: string;
  readonly descriptor: PanelOwnerOperationDescriptor;
  readonly danger: boolean;
  readonly primary: boolean;
  readonly label: string;
  readonly disabled: boolean;
}

export type ObjectHeaderOperationSpec =
  | string
  | {
      readonly name: string;
      readonly danger?: boolean;
      readonly primary?: boolean;
    };

/**
 * Detail header for one selected object or a standalone heading (such as create mode): title (`record.label` or
 * `title`), one-line subtitle (`subtitleField` or `subtitle`), status badge (`statusField` paired with `record.tones`,
 * or `status` + `statusTone`), and right-side action bar.
 *
 * When mounted as a projection member with declared `operations`, exposes up to `maxVisibleOperations` (default 2,
 * configurable without upper cap) regular operations inline via `OperationButton`, moves remaining regular operations
 * into the SDK dropdown "More" menu, and places dangerous operations (declared via the owner's `inspectImpact` or
 * explicitly marked via `dangerOperations` / `{ danger: true }`) last in the "More" menu using the shared operation
 * execution path.
 */
const props = withDefaults(
  defineProps<{
    /** Optional bound record passed directly when not reading from a projection's `record` datum. */
    record?: PlatformObjectRecord | null;
    /** Standalone title text (e.g. create-mode heading); overrides `record.label` when provided. */
    title?: string;
    /** Standalone one-line identifier or subtitle; overrides `subtitleField` when provided. */
    subtitle?: string;
    /** Field name on the bound `record` to show as the one-line subtitle beneath or beside the title. */
    subtitleField?: string;
    /** Field name on the bound `record` to show as the status badge (using `record.tones[statusField]`). */
    statusField?: string;
    /** Standalone status badge text when not reading from a bound record. */
    status?: string;
    /** Visual tone for the standalone status badge; ignored when reading tone from `record.tones`. */
    statusTone?: "info" | "success" | "warning" | "danger";
    /** Optional ordered list of projection operation local names (or `{ name, danger, primary }` specs); defaults to all declared projection operations. */
    operations?: readonly ObjectHeaderOperationSpec[];
    /** Projection operation local names explicitly treated as destructive (always placed last in the "More" menu). */
    dangerOperations?: readonly string[];
    /** Projection operation local name emphasized as the primary inline button when exposed inline. */
    primaryOperation?: string;
    /** Maximum number of regular operations exposed inline before overflowing to "More" (default 2; no upper limit). */
    maxVisibleOperations?: number;
  }>(),
  {
    maxVisibleOperations: 2,
  },
);

const emit = defineEmits<{
  /** Emitted after a projection operation in the header or its "More" menu dispatches and the owner answers. */
  done: [operation: string, outcome: OperationOutcome];
}>();

defineSlots<{
  /** Additional custom actions rendered beside or instead of projection operations. */
  actions?(): unknown;
}>();

const { t, locale } = useI18n();
const panel = inject(panelContextKey, null);
const slot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = computed(() => memberGetter?.() ?? null);
const labels = useDataStateLabels();

const hasBoundRecord = computed(() => {
  const current = member.value;
  return Boolean(current && current.projection.data && Object.hasOwn(current.projection.data, "record"));
});

const recordData = member.value && hasBoundRecord.value
  ? readerDataState(member.value.data.use("record"))
  : computed(() => null);

const record = computed<PlatformObjectRecord | null>(() => {
  if (props.record !== undefined) return props.record;
  const current = recordData.value;
  return current?.status === "ready" ? (current.value as unknown as PlatformObjectRecord) : null;
});

const pendingRecord = computed<DataStateResult | null>(() => {
  if (props.record !== undefined || props.title !== undefined || !hasBoundRecord.value) return null;
  const current = recordData.value;
  if (!current || current.status === "ready") return null;
  return current as DataStateResult;
});

watch(
  record,
  (found) => {
    if (!found || !panel || !slot || !hasBoundRecord.value) return;
    const objectType = projectionElement(slot.projection).id;
    const ref = panelRecordObjectRef(found, objectType);
    panel.instance.nameObjects(ref.className, [found]);
  },
  { immediate: true },
);

const resolvedTitle = computed(() => {
  if (props.title !== undefined) return props.title;
  return record.value?.label ?? "";
});

const resolvedSubtitle = computed(() => {
  if (props.subtitle !== undefined) return props.subtitle;
  const current = record.value;
  if (!current) return "";
  if (props.subtitleField) return displayFieldText(rawRecordField(current, props.subtitleField), locale.value, t);
  return current.subtitle ?? "";
});

const resolvedStatus = computed(() => {
  if (props.status !== undefined) return props.status;
  const current = record.value;
  if (!current || !props.statusField) return "";
  return displayFieldText(rawRecordField(current, props.statusField), locale.value, t);
});

const resolvedStatusTone = computed(() => {
  if (props.statusField && record.value?.tones?.[props.statusField]) {
    return record.value.tones[props.statusField];
  }
  return props.statusTone ?? "";
});

const moreAriaLabel = computed(() => {
  const name = resolvedTitle.value.trim();
  return name
    ? t("platform.objectHeaderMoreActionsFor", { name })
    : t("platform.objectHeaderMoreActions");
});

/**
 * Dangerous operations follow the owner's declaration (`inspectImpact`) or explicit caller designation
 * (`dangerOperations` / `{ danger: true }`), never name/handler regex guessing.
 */
function isDangerOperation(name: string, descriptor: PanelOwnerOperationDescriptor, explicitDanger?: boolean): boolean {
  if (explicitDanger) return true;
  if (props.dangerOperations?.includes(name)) return true;
  return Boolean(descriptor.inspectImpact);
}

const {
  running: moreRunning,
  failure: moreFailure,
  read: moreRead,
  receipt: moreReceipt,
  outcome: moreOutcome,
  batchItems: moreBatchItems,
  batchDone: moreBatchDone,
  inputDialogOpen: moreInputDialogOpen,
  pendingDescriptor: morePendingDescriptor,
  pendingInputFields: morePendingInputFields,
  said,
  nameOf,
  trigger: triggerMoreOperation,
  confirmInput: confirmMoreInput,
  reset: resetMoreRunner,
} = useOperationRunner({
  panel: () => panel,
  slot: () => slot,
  member: () => member.value,
  t,
  onDone: (operationName, answered) => emit("done", operationName, answered),
});

const stateValues = computed(() => panel?.instance.state.values.value ?? {});

const admittedOperations = computed<readonly HeaderOperationItem[]>(() => {
  const currentMember = member.value;
  if (!currentMember || !slot) return [];
  const state = currentMember.operations.value;
  if (state.status !== "ready") return [];
  const specs: readonly { name: string; danger?: boolean; primary?: boolean }[] = props.operations
    ? props.operations.map((entry) => (typeof entry === "string" ? { name: entry } : entry))
    : Object.keys(slot.projection.operations ?? {}).map((name) => ({ name }));
  const items: HeaderOperationItem[] = [];
  for (const spec of specs) {
    const descriptor = state.value[spec.name];
    if (!descriptor) continue;
    const targetInfo = resolveOperationTarget(panel, slot, currentMember, descriptor, stateValues.value);
    const label = formatOperationLabel(descriptor, targetInfo, t);
    const ready = isOperationReady(descriptor, targetInfo, Boolean(currentMember.rowOperation), false);
    items.push({
      name: spec.name,
      descriptor,
      danger: isDangerOperation(spec.name, descriptor, spec.danger),
      primary: Boolean(spec.primary) || spec.name === props.primaryOperation,
      label,
      disabled: !ready,
    });
  }
  return items;
});

const inlineLimit = computed(() => Math.max(0, Math.floor(props.maxVisibleOperations)));

const inlineOperations = computed(() =>
  admittedOperations.value.filter((item) => !item.danger).slice(0, inlineLimit.value),
);

const moreOperations = computed(() => {
  const normalOverflow = admittedOperations.value.filter((item) => !item.danger).slice(inlineLimit.value);
  const dangerItems = admittedOperations.value.filter((item) => item.danger);
  return [...normalOverflow, ...dangerItems];
});

watch(
  () => record.value?.primaryKey ?? props.title ?? null,
  () => {
    resetMoreRunner();
  },
);

function handleMoreCommand(command: string | number | Record<string, unknown>) {
  if (typeof command !== "string") return;
  const item = moreOperations.value.find((entry) => entry.name === command);
  if (!item || item.disabled || moreRunning.value) return;
  triggerMoreOperation(item.name, item.descriptor);
}
</script>

<template>
  <header class="sdk-object-header">
    <data-state v-if="pendingRecord" :result="pendingRecord" :labels="labels"></data-state>
    <template v-else>
      <div class="sdk-object-header-row">
        <div class="sdk-object-header-identity">
          <div class="sdk-object-header-title-line">
            <h2 v-if="resolvedTitle" class="sdk-object-header-title">{{ resolvedTitle }}</h2>
            <span
              v-if="resolvedStatus"
              class="sdk-object-header-status"
              :data-tone="resolvedStatusTone || undefined"
            >
              {{ resolvedStatus }}
            </span>
          </div>
          <p v-if="resolvedSubtitle" class="sdk-object-header-subtitle">{{ resolvedSubtitle }}</p>
        </div>
        <div v-if="$slots.actions || inlineOperations.length > 0 || moreOperations.length > 0" class="sdk-object-header-actions">
          <slot name="actions"></slot>
          <OperationButton
            v-for="item in inlineOperations"
            :key="item.name"
            :operation="item.name"
            :type="item.primary ? 'primary' : 'default'"
            @done="(outcome) => emit('done', item.name, outcome)"
          />
          <el-dropdown
            v-if="moreOperations.length"
            trigger="click"
            placement="bottom-end"
            class="sdk-object-header-more"
            :disabled="moreRunning"
            @command="handleMoreCommand"
          >
            <button
              type="button"
              class="sdk-object-header-more-btn"
              :aria-label="moreAriaLabel"
              :title="moreAriaLabel"
              :disabled="moreRunning"
            >
              <span aria-hidden="true">···</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu class="sdk-object-header-more-menu">
                <el-dropdown-item
                  v-for="(item, index) in moreOperations"
                  :key="item.name"
                  :command="item.name"
                  :divided="item.danger && index > 0 && !moreOperations[index - 1]?.danger"
                  :disabled="item.disabled || moreRunning"
                  :class="['sdk-object-header-more-item', { 'is-danger': item.danger }]"
                  :data-operation="item.name"
                  :data-danger="item.danger ? 'true' : undefined"
                  :title="item.descriptor.unavailable?.reason"
                >
                  <span class="sdk-object-header-more-item-body">
                    <span class="sdk-object-header-more-label">{{ item.label }}</span>
                    <span v-if="item.descriptor.unavailable" class="sdk-object-header-more-reason">
                      {{ item.descriptor.unavailable.reason }}
                    </span>
                  </span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <operation-input-dialog
        v-if="morePendingInputFields.length > 0"
        v-model="moreInputDialogOpen"
        :title="morePendingDescriptor?.label"
        :fields="morePendingInputFields"
        :busy="moreRunning"
        @confirm="confirmMoreInput"
      ></operation-input-dialog>
      <div v-if="moreFailure || moreRead || moreReceipt" class="sdk-object-header-feedback">
        <p v-if="moreFailure" class="sdk-object-header-alert" role="alert">{{ moreFailure.message }}</p>
        <OperationResult v-if="moreRead" :result="moreRead" />
        <template v-if="moreReceipt">
          <p v-if="moreReceipt.kind === 'not-dispatched'" class="sdk-object-header-alert" role="alert">{{ moreReceipt.message }}</p>
          <p v-else-if="moreOutcome === null" class="sdk-object-header-alert" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
          <div v-else-if="moreOutcome.kind === 'batch'" class="sdk-object-header-batch" role="status">
            <p>{{ t("platform.operationBatchDone", { done: moreBatchDone, total: moreBatchItems.length }) }}</p>
            <ul>
              <li
                v-for="item in moreBatchItems"
                :key="item.target.objectType + ':' + item.target.primaryKey"
                :data-outcome="item.outcome.kind"
              >{{ nameOf(item.target) }}: {{ said(item.outcome) }}</li>
            </ul>
          </div>
          <p v-else class="sdk-object-header-alert" role="alert" :data-outcome="moreOutcome.kind">{{ said(moreOutcome) }}</p>
        </template>
      </div>
    </template>
  </header>
</template>

<style scoped>
.sdk-object-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.sdk-object-header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm) var(--spacing-md);
  min-width: 0;
}
.sdk-object-header-identity {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.sdk-object-header-title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}
.sdk-object-header-title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
  overflow-wrap: anywhere;
}
.sdk-object-header-subtitle {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-object-header-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 var(--spacing-xs);
  border-radius: var(--radius-xs);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  line-height: var(--leading-sm);
}
.sdk-object-header-status[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info-text);
}
.sdk-object-header-status[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}
.sdk-object-header-status[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
}
.sdk-object-header-status[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}
.sdk-object-header-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--component-gap);
  min-width: 0;
}
.sdk-object-header-more-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-height);
  height: var(--control-height);
  padding: 0 var(--spacing-xs);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.sdk-object-header-more-btn:hover:not(:disabled) {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-object-header-more-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.sdk-object-header-more-btn:disabled {
  cursor: not-allowed;
  color: var(--el-disabled-text-color);
}
.sdk-object-header-feedback {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-object-header-alert {
  margin: 0;
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.sdk-object-header-batch ul {
  margin: var(--spacing-xs) 0 0;
  padding-inline-start: var(--spacing-lg);
}
.sdk-object-header-batch li[data-outcome="success"] {
  color: var(--el-text-color-secondary);
}
.sdk-object-header-batch li:not([data-outcome="success"]) {
  color: var(--el-color-danger-text);
}
</style>

<style>
.sdk-object-header-more-menu .sdk-object-header-more-item-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.sdk-object-header-more-menu .el-dropdown-menu__item.sdk-object-header-more-item.is-danger {
  color: var(--el-color-danger-text);
}
.sdk-object-header-more-menu .el-dropdown-menu__item.sdk-object-header-more-item.is-danger:not(.is-disabled):hover,
.sdk-object-header-more-menu .el-dropdown-menu__item.sdk-object-header-more-item.is-danger:not(.is-disabled):focus {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}
.sdk-object-header-more-menu .sdk-object-header-more-reason {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
</style>
