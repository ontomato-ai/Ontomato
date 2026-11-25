<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index";
import { randomId } from "@ontomato/contracts/random-id";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { panelRecordObjectRef, type PanelRowActionTone } from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelContextKey, projectionKey } from "../panel/context";
import { classifyDispatchResponseForAction } from "../panel/instance";
import { panelMemberKey, readerDataState, useMemberOutput } from "../panel/member";
import { missingOperationDescriptorResult } from "../panel/member-operations";
import { matchesExpectedCheckedKeys, matchesExpectedTarget } from "../panel/operation-binding";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { useDataStateLabels } from "./data-state-labels";
import {
  filterAllowedOperationInput,
  formatOperationLabel,
  isOperationReady,
  resolveOperationInputFields,
  resolveOperationTarget,
  useOperationRunner,
  type OperationOutcome,
  agentOperationSecretRefusal,
} from "./operation-dispatch";
import { hasAgentOperationSecretInput } from "./operation-input-schema";
import OperationButton from "./OperationButton.vue";
import OperationBatchReceipt from "./OperationBatchReceipt.vue";
import OperationInputDialog from "./OperationInputDialog.vue";
import OperationResult from "./OperationResult.vue";
import { displayFieldText, rawRecordField } from "./record-field";

interface HeaderOperationItem {
  readonly name: string;
  readonly descriptor: PanelOwnerOperationDescriptor;
  readonly tone: PanelRowActionTone;
  readonly danger: boolean;
  readonly customLabel?: string;
  readonly label: string;
  readonly disabled: boolean;
}

export type ObjectHeaderOperationSpec =
  | string
  | {
      readonly name: string;
      readonly tone?: PanelRowActionTone;
      readonly label?: string;
    };

/**
 * Detail header for one selected object or a standalone heading (such as create mode): title (`record.label` or
 * `title`), one-line subtitle (`subtitleField` or `subtitle`), status badge (`statusField` paired with `record.tones`,
 * or `status` + `statusTone`), and right-side action bar.
 *
 * When mounted as a projection member with declared `operations`, exposes up to `maxVisibleOperations` (default 2,
 * configurable without upper cap) operations inline via `OperationButton` in declared order (danger operations render
 * as plain danger buttons inline when within the visible limit) and moves remaining operations into the SDK dropdown
 * "More" menu using the shared operation execution path.
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
    /** Optional ordered list of projection operation local names (or `{ name, tone, label }` specs); defaults to all declared projection operations. */
    operations?: readonly ObjectHeaderOperationSpec[];
    /** Maximum number of operations exposed inline before overflowing to "More" (default 2; no upper limit). */
    maxVisibleOperations?: number;
    /** Optional fallback title shown quietly while the bound record is loading, forbidden, or missing (suppresses the inline DataState box). */
    fallbackTitle?: string;
  }>(),
  {
    maxVisibleOperations: 2,
    fallbackTitle: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted after a projection operation in the header or its "More" menu dispatches and the owner answers. */
  done: [operation: string, outcome: OperationOutcome];
}>();

defineSlots<{
  /** Optional leading icon or badge rendered before the object title and subtitle. */
  leading?(): unknown;
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
  if (props.record !== undefined || props.title !== undefined || props.fallbackTitle !== undefined || !hasBoundRecord.value) return null;
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
  return record.value?.label || props.fallbackTitle || "";
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
 * Operation tone follows an explicit per-item `tone` or the owner's destructive declaration (`inspectImpact`),
 * never name/handler regex guessing.
 */
function resolveOperationTone(
  descriptor: PanelOwnerOperationDescriptor,
  explicitTone?: PanelRowActionTone,
): PanelRowActionTone {
  if (explicitTone) return explicitTone;
  return descriptor.inspectImpact ? "danger" : "default";
}

const {
  running: moreRunning,
  failure: moreFailure,
  read: moreRead,
  receipt: moreReceipt,
  outcome: moreOutcome,
  named: moreNamed,
  inputDialogOpen: moreInputDialogOpen,
  pendingDescriptor: morePendingDescriptor,
  pendingInputFields: morePendingInputFields,
  said,
  trigger: triggerMoreOperation,
  confirmInput: confirmMoreInput,
  run: runMoreOperation,
  reset: resetMoreRunner,
} = useOperationRunner({
  panel: () => panel,
  slot: () => slot,
  member: () => member.value,
  t,
  isEntryAvailable: (operationName) => {
    const item = moreOperations.value.find((entry) => entry.name === operationName);
    if (!item) {
      return { ok: false, message: `Operation '${operationName}' is no longer shown in the header menu.` };
    }
    if (item.disabled) {
      return { ok: false, message: item.descriptor.unavailable?.reason ?? `Operation '${operationName}' is currently disabled.` };
    }
    return { ok: true };
  },
  onDone: (operationName, answered) => emit("done", operationName, answered),
});

const stateValues = computed(() => panel?.instance.state.values.value ?? {});

const admittedOperations = computed<readonly HeaderOperationItem[]>(() => {
  const currentMember = member.value;
  if (!currentMember || !slot) return [];
  const state = currentMember.operations.value;
  if (state.status !== "ready") return [];
  const specs: readonly { name: string; tone?: PanelRowActionTone; label?: string }[] = props.operations
    ? props.operations.map((entry) => (typeof entry === "string" ? { name: entry } : entry))
    : Object.keys(slot.projection.operations ?? {}).map((name) => ({ name }));
  const items: HeaderOperationItem[] = [];
  for (const spec of specs) {
    const descriptor = state.value[spec.name];
    if (!descriptor) continue;
    const targetInfo = resolveOperationTarget(panel, slot, currentMember, descriptor, stateValues.value);
    const label = spec.label?.trim() || formatOperationLabel(descriptor, targetInfo, t);
    const ready = isOperationReady(descriptor, targetInfo, false, panel?.instance.forms);
    const tone = resolveOperationTone(descriptor, spec.tone);
    items.push({
      name: spec.name,
      descriptor,
      tone,
      danger: tone === "danger" || Boolean(descriptor.inspectImpact),
      customLabel: spec.label,
      label,
      disabled: !ready,
    });
  }
  return items;
});

const inlineLimit = computed(() => Math.max(0, Math.floor(props.maxVisibleOperations)));

const inlineOperations = computed(() =>
  admittedOperations.value.slice(0, inlineLimit.value),
);

const moreOperations = computed(() => {
  const overflow = admittedOperations.value.slice(inlineLimit.value);
  const regularOverflow = overflow.filter((item) => !item.danger);
  const dangerOverflow = overflow.filter((item) => item.danger);
  return [...regularOverflow, ...dangerOverflow];
});

watch(
  () => record.value?.primaryKey ?? props.title ?? null,
  () => {
    resetMoreRunner();
  },
);

if (member.value) {
  useMemberOutput("label", () => resolvedTitle.value || null);
  useMemberOutput("status", () => recordData.value?.status ?? (record.value ? "ready" : null));
  useMemberOutput("errorMessage", () => (recordData.value?.status === "error" ? recordData.value.message : null));
}

function handleMoreCommand(command: string | number | Record<string, unknown>) {
  if (typeof command !== "string") return;
  const item = moreOperations.value.find((entry) => entry.name === command);
  if (!item || item.disabled || moreRunning.value) return;
  triggerMoreOperation(item.name, item.descriptor);
}

const headerOperationSpecs = computed<readonly string[]>(() => {
  if (!slot) return [];
  return props.operations
    ? props.operations.map((entry) => (typeof entry === "string" ? entry : entry.name))
    : Object.keys(slot.projection.operations ?? {});
});

// Operations rendered inline already register via their child `<OperationButton>`; register the remaining
// header operations (overflow "More" menu items and declared operations while loading/unadmitted) here.
const headerOwnedOperationNames = computed<readonly string[]>(() => {
  const inlineSet = new Set(inlineOperations.value.map((item) => item.name));
  return headerOperationSpecs.value.filter((name) => !inlineSet.has(name));
});

const headerEntryInstanceId = ref(randomId());
watch(
  () => JSON.stringify({
    recordKey: record.value?.primaryKey ?? null,
    inputs: member.value?.inputs.value ?? null,
    checked: panel?.instance.checkedKeys() ?? null,
  }),
  (next, prev) => {
    if (next !== prev) headerEntryInstanceId.value = randomId();
  },
);

let unregisterHeaderActions: (() => void)[] = [];
function clearHeaderActionHandlers() {
  for (const unregister of unregisterHeaderActions) unregister();
  unregisterHeaderActions = [];
}
watch(
  headerOwnedOperationNames,
  (names) => {
    clearHeaderActionHandlers();
    if (!panel || !slot) return;
    unregisterHeaderActions = names.map((operationName) =>
      panel.instance.registerActionHandler(
        panel.instance.operationIdOf(slot.slot, operationName),
        async ({ input, expectedTarget, expectedCheckedKeys, agentContext }) => {
          const currentMember = member.value;
          if (!currentMember) {
            return { ok: false, reason: "action_not_ready", message: `Operation '${operationName}' is not ready yet.` };
          }
          const item = moreOperations.value.find((entry) => entry.name === operationName);
          if (!item) {
            return missingOperationDescriptorResult(currentMember.operations.value, operationName);
          }
          const currentTargetInfo = resolveOperationTarget(panel, slot, currentMember, item.descriptor, stateValues.value);
          if (expectedCheckedKeys !== undefined && currentTargetInfo.checkedState !== null) {
            if (!matchesExpectedCheckedKeys(currentTargetInfo.checkedTargets, expectedCheckedKeys)) {
              return {
                ok: false,
                reason: "stale",
                message: "The checked batch selection changed since your last observation.",
              };
            }
          }
          if (expectedTarget !== undefined) {
            const declaredDraftSlot = panel.manifest.members[slot.slot]?.operationDrafts?.[operationName]?.slot;
            const currentTarget = declaredDraftSlot
              ? (panel.instance.forms.snapshot(declaredDraftSlot)?.target ?? null)
              : currentTargetInfo.target;
            if (!matchesExpectedTarget(currentTarget, expectedTarget)) {
              return {
                ok: false,
                reason: "stale",
                message: "The target object or draft changed since your last observation.",
              };
            }
          }
          if (item.disabled || moreRunning.value) {
            return {
              ok: false,
              reason: "action_unavailable",
              message: item.descriptor.unavailable?.reason ?? `Operation '${operationName}' is currently disabled.`,
            };
          }
          if (agentContext && hasAgentOperationSecretInput(item.descriptor, input)) return agentOperationSecretRefusal;
          const inputFields = resolveOperationInputFields(panel, slot, operationName, item.descriptor);
          const filteredInput = filterAllowedOperationInput(input, inputFields);
          const missing = inputFields
            .filter((field) => field.required && !(field.name in filteredInput))
            .map((field) => field.name);
          if (missing.length > 0) {
            return {
              ok: false,
              reason: "input_required",
              message: `Operation '${operationName}' requires input fields: ${missing.join(", ")}.`,
            };
          }
          const status = await runMoreOperation(operationName, item.descriptor, filteredInput, agentContext);
          const dispatchedResponse = moreReceipt.value ?? agentContext?.completed?.response;
          if (dispatchedResponse) {
            return classifyDispatchResponseForAction(dispatchedResponse);
          }
          if (moreFailure.value) {
            return { ok: false, reason: "failed", message: moreFailure.value.message };
          }
          if (status === "cancelled") {
            return { ok: false, reason: "cancelled", message: `Operation '${operationName}' was cancelled.` };
          }
          if (status === "skipped") {
            return { ok: false, reason: "action_unavailable", message: `Operation '${operationName}' is currently busy.` };
          }
          if (moreRead.value) {
            return { ok: true, outcome: moreRead.value };
          }
          return { ok: true, outcome: moreOutcome.value ?? undefined };
        },
        { entryInstanceId: () => headerEntryInstanceId.value },
      ),
    );
  },
  { immediate: true },
);
onBeforeUnmount(clearHeaderActionHandlers);
</script>

<template>
  <header class="sdk-object-header">
    <data-state v-if="pendingRecord" :result="pendingRecord" :labels="labels"></data-state>
    <template v-else>
      <div class="sdk-object-header-row">
        <div v-if="$slots.leading" class="sdk-object-header-leading">
          <slot name="leading"></slot>
        </div>
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
            :label="item.customLabel"
            :type="item.tone === 'danger' ? 'danger' : item.tone === 'primary' ? 'primary' : 'default'"
            :plain="item.tone === 'danger'"
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
                  :data-tone="item.tone !== 'default' ? item.tone : undefined"
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
          <OperationBatchReceipt v-else-if="moreOutcome.kind === 'batch'" :items="moreOutcome.items" :named="moreNamed" />
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
.sdk-object-header-leading {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
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
