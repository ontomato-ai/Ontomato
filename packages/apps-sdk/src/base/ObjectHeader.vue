<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, useSlots, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { panelRecordObjectRef } from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelContextKey, projectionKey, slotInputState } from "../panel/context";
import type { PanelWriteResult } from "../panel/instance";
import { panelMemberKey, readerDataState } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { readOperationInput } from "../panel/read-operation-input";
import { stateObject, stateObjects } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import OperationButton from "./OperationButton.vue";
import OperationResult from "./OperationResult.vue";
import { displayFieldText, rawRecordField } from "./record-field";

type OperationOutcome = NonNullable<Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"]>;
type SingleOperationOutcome = Exclude<OperationOutcome, { kind: "batch" }>;

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
 * When mounted as a projection member with declared `operations`, enforces the platform action layout automatically:
 * at most two regular operations appear inline via `OperationButton`, any remaining regular operations move into the
 * "More" menu, and delete/danger operations always sit last in the "More" menu using the platform's shared dispatch
 * and confirmation flow.
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
    /** Maximum number of regular operations exposed inline before overflowing to "More" (clamped to at most 2). */
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
const slots = useSlots();
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

function isDangerOperation(name: string, descriptor: PanelOwnerOperationDescriptor, explicitDanger?: boolean): boolean {
  if (explicitDanger) return true;
  if (props.dangerOperations?.includes(name)) return true;
  if (/^(?:delete|remove)(?:$|[-_]|[A-Z])/.test(name) || /^(?:delete|remove)$/i.test(name)) return true;
  return /(?:^|[./-])(?:delete|remove)(?:$|[./-]|[A-Z])/.test(descriptor.handlerRef)
    || /(?:^|\.)(?:delete|remove)$/i.test(descriptor.handlerRef);
}

const stateValues = computed(() => panel?.instance.state.values.value ?? {});

function targetInfoFor(descriptor: PanelOwnerOperationDescriptor) {
  if (!panel || !slot) {
    return { batch: false, checkedState: null as string | null, checkedObjects: [] as ReturnType<typeof stateObjects>, target: null as PanelOperationCall["target"] };
  }
  const rowOperation = member.value?.rowOperation ?? null;
  const targetState = descriptor.target.source === "input" ? slotInputState(panel.manifest, slot.slot, descriptor.target.input) : null;
  const batch = !rowOperation && targetState !== null && panel.manifest.state[targetState]?.type.kind === "list";
  const checkedState = batch ? targetState : null;
  const checkedObjects = checkedState === null ? [] : stateObjects(stateValues.value[checkedState]);
  const selected = rowOperation || targetState === null || batch ? null : stateObject(stateValues.value[targetState]);
  const target: PanelOperationCall["target"] = selected
    ? { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey }
    : null;
  return { batch, checkedState, checkedObjects, target };
}

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
    const { batch, checkedState, checkedObjects, target } = targetInfoFor(descriptor);
    const label = batch
      ? t("platform.operationChecked", { label: descriptor.label, count: checkedObjects.length })
      : descriptor.label;
    const ready = !descriptor.unavailable && (
      Boolean(currentMember.rowOperation)
      || (checkedState !== null ? checkedObjects.length > 0 : descriptor.target.source !== "input" || target !== null)
    );
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

const inlineLimit = computed(() => Math.max(0, Math.min(2, Math.floor(props.maxVisibleOperations))));

const inlineOperations = computed(() =>
  admittedOperations.value.filter((item) => !item.danger).slice(0, inlineLimit.value));

const moreOperations = computed(() => {
  const normalOverflow = admittedOperations.value.filter((item) => !item.danger).slice(inlineLimit.value);
  const dangerItems = admittedOperations.value.filter((item) => item.danger);
  return [...normalOverflow, ...dangerItems];
});

const hasActions = computed(() =>
  Boolean(slots.actions) || inlineOperations.value.length > 0 || moreOperations.value.length > 0);

const moreOpen = ref(false);
const moreRootRef = ref<HTMLElement | null>(null);
const runningMore = ref<string | null>(null);
const moreFailure = shallowRef<Error | null>(null);
const moreRead = shallowRef<PanelReadOperationResult | null>(null);
const moreReceipt = shallowRef<PanelHumanOperationDispatchResponse | null>(null);
const moreNamed = shallowRef<PanelWriteResult["named"]>([]);

function handleDocumentClick(event: MouseEvent) {
  if (!moreOpen.value || !moreRootRef.value) return;
  if (event.target instanceof Node && !moreRootRef.value.contains(event.target)) {
    moreOpen.value = false;
  }
}

watch(moreOpen, (open) => {
  if (typeof document === "undefined") return;
  if (open) document.addEventListener("click", handleDocumentClick);
  else document.removeEventListener("click", handleDocumentClick);
});

onBeforeUnmount(() => {
  if (typeof document !== "undefined") document.removeEventListener("click", handleDocumentClick);
});

watch(
  () => record.value?.primaryKey ?? props.title ?? null,
  () => {
    moreOpen.value = false;
    moreFailure.value = null;
    moreRead.value = null;
    moreReceipt.value = null;
  },
);

const said = (outcome: SingleOperationOutcome) =>
  outcome.kind === "success" ? outcome.message ?? t("platform.operationDone")
    : outcome.kind === "unknown" ? t("platform.operationUnknown", { message: outcome.message })
      : outcome.message;

const moreOutcome = computed(() => (moreReceipt.value?.kind === "dispatched" ? moreReceipt.value.outcome : null));
const moreBatchItems = computed(() => (moreOutcome.value?.kind === "batch" ? moreOutcome.value.items : []));
const moreBatchDone = computed(() => moreBatchItems.value.filter((item) => item.outcome.kind === "success").length);
const nameOf = (target: PanelObjectIdentity) =>
  moreNamed.value.find(({ target: known }) =>
    known.objectType === target.objectType && known.primaryKey === target.primaryKey)?.label ?? target.primaryKey;

async function runMoreOperation(item: HeaderOperationItem) {
  if (!panel || !slot || item.disabled || runningMore.value !== null) return;
  moreOpen.value = false;
  runningMore.value = item.name;
  moreFailure.value = null;
  moreRead.value = null;
  moreReceipt.value = null;
  const { descriptor } = item;
  const operationId = panel.instance.operationIdOf(slot.slot, item.name);
  const rowOperation = member.value?.rowOperation ?? null;
  const { checkedState, checkedObjects, target } = targetInfoFor(descriptor);

  try {
    if (descriptor.effect === "read") {
      if (rowOperation) throw new Error(`Row operation '${item.name}' must be a write operation`);
      const { target: owned } = descriptor;
      const hasDeclaredInputs = panel.manifest.members[slot.slot]?.readOperationInputs?.[item.name] !== undefined;
      const input = owned.source === "draft" || hasDeclaredInputs
        ? readOperationInput(
            panel.instance,
            slot.slot,
            item.name,
            owned.source === "draft" ? panel.instance.forms.handle(owned.slot)!.values.value : {},
          )
        : {};
      moreRead.value = await panel.instance.readOperation(operationId, { target, input });
      return;
    }
    const answer = rowOperation
      ? await rowOperation.run(item.name)
      : await (() => {
          const checkedTargets = checkedObjects.map(({ className, primaryKey }) => ({
            kind: "object" as const,
            objectType: className,
            primaryKey,
          }));
          const [first, ...rest] = checkedTargets.map((object) => ({ target: object, input: {} }));
          return panel.instance.writeOperation(
            operationId,
            first ? { calls: [first, ...rest] } : { call: { target, input: {} } },
          );
        })();
    if (answer.decision === "cancel") return;
    moreNamed.value = answer.named;
    if (checkedState !== null && answer.response.kind === "dispatched" && answer.response.outcome?.kind === "batch") {
      const changed = new Set(
        answer.response.outcome.items
          .filter(({ outcome }) => outcome.kind === "success")
          .map(({ target: done }) => JSON.stringify([done.objectType, done.primaryKey])),
      );
      panel.instance.state.set(
        checkedState,
        checkedObjects.filter(({ className, primaryKey }) => !changed.has(JSON.stringify([className, primaryKey]))),
      );
    }
    const answered = answer.response.kind === "dispatched" ? answer.response.outcome : undefined;
    if (answered?.kind === "success") panel.notify({ kind: "success", text: said(answered) });
    else moreReceipt.value = answer.response;
    if (answered) emit("done", item.name, answered);
  } catch (reason) {
    moreFailure.value = reason instanceof Error ? reason : new Error(String(reason));
  } finally {
    runningMore.value = null;
  }
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
        <div v-if="hasActions" class="sdk-object-header-actions">
          <slot name="actions"></slot>
          <OperationButton
            v-for="item in inlineOperations"
            :key="item.name"
            :operation="item.name"
            :type="item.primary ? 'primary' : 'default'"
            @done="(outcome) => emit('done', item.name, outcome)"
          />
          <div
            v-if="moreOperations.length"
            ref="moreRootRef"
            class="sdk-object-header-more"
            @keydown.escape="moreOpen = false"
          >
            <button
              type="button"
              class="sdk-object-header-more-btn"
              :aria-label="t('common.more')"
              :title="t('common.more')"
              aria-haspopup="menu"
              :aria-expanded="moreOpen"
              :disabled="runningMore !== null"
              @click.stop="moreOpen = !moreOpen"
            >
              <span aria-hidden="true">···</span>
            </button>
            <div v-if="moreOpen" class="sdk-object-header-more-menu" role="menu">
              <template v-for="(item, index) in moreOperations" :key="item.name">
                <div
                  v-if="item.danger && index > 0 && !moreOperations[index - 1]?.danger"
                  class="sdk-object-header-more-divider"
                  role="separator"
                ></div>
                <button
                  type="button"
                  role="menuitem"
                  class="sdk-object-header-more-item"
                  :class="{ 'is-danger': item.danger }"
                  :data-operation="item.name"
                  :data-danger="item.danger ? 'true' : undefined"
                  :disabled="item.disabled || runningMore !== null"
                  :title="item.descriptor.unavailable?.reason"
                  @click="runMoreOperation(item)"
                >
                  <span class="sdk-object-header-more-label">{{ item.label }}</span>
                  <span v-if="item.descriptor.unavailable" class="sdk-object-header-more-reason">
                    {{ item.descriptor.unavailable.reason }}
                  </span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
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
.sdk-object-header-more {
  position: relative;
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
.sdk-object-header-more-menu {
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: calc(100% + var(--spacing-xs));
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: var(--spacing-xs);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.sdk-object-header-more-divider {
  height: 1px;
  margin: var(--spacing-xs) 0;
  background: var(--ui-divider);
}
.sdk-object-header-more-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  text-align: start;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.sdk-object-header-more-item:hover:not(:disabled),
.sdk-object-header-more-item:focus-visible {
  background: var(--ui-fill-tertiary);
  outline: none;
}
.sdk-object-header-more-item.is-danger {
  color: var(--el-color-danger-text);
}
.sdk-object-header-more-item.is-danger:hover:not(:disabled) {
  background: var(--el-color-danger-light-9);
}
.sdk-object-header-more-item:disabled {
  cursor: not-allowed;
  color: var(--el-disabled-text-color);
}
.sdk-object-header-more-reason {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
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
