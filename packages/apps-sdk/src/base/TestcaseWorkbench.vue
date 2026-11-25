<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElInput } from "element-plus/es/components/input/index";
import { confirmDanger, confirmUnsavedSwitch } from "@ontomato/platform-shell";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import type { FormFieldRejection } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import {
  pruneInactivePanelFormVariants,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
} from "@ontomato/contracts/panel-projection";
import { randomId } from "@ontomato/contracts/random-id";
import { panelSecretValuePresent, splitPanelSecrets } from "@ontomato/contracts/panel-secrets";
import { slotInputState, usePanelContext, useProjectionForm, useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import type { FormSubmitOverride, InvalidFormText, PanelFormDraft } from "../panel/forms";
import { jsonValuesEqual, valueAt, withValueAt } from "../panel/form-values";
import {
  classifyDispatchResponseForAction,
  PanelConfirmationDeferred,
  PanelOperationDeferred,
  type PanelAgentActionContext,
} from "../panel/instance";
import {
  computeDraftBaselineHash,
  objectDraftKey,
  stripSecretDraftValues,
  typeDraftKey,
  useLocalDraftStore,
} from "../panel/local-drafts";
import { useMember, useMemberOutput } from "../panel/member";
import {
  editedInput,
  formSave,
  formTargetKey,
  memberFormSource,
  MemberDataUnavailable,
  type FormSaveResult,
  type FormSource,
} from "../panel/member-forms";
import { missingOperationDescriptorResult } from "../panel/member-operations";
import {
  matchesExpectedTarget,
  PanelSubmissionStaleError,
  type SubmissionCheckPhase,
  type SubmissionEvaluator,
} from "../panel/operation-binding";
import { PlatformObjectRefusal, selectedKey } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import type { PanelFieldValue } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import { formSecretPaths } from "./form-secret-fields";
import type { ObjectFormUnsavedSwitchMode } from "./object-form-types";
import {
  clampPaneWidth,
  extractDefaultJudgment,
  extractTestcaseFieldMeta,
  extractTestcases,
  generateNextCaseId,
  hasValidTestcases,
  parseTestcasesJson,
  serializeTestcasesJson,
  testcaseSummary,
  toCaseSetFormValues,
  type TestcaseEntry,
  type TestcaseFieldKey,
} from "./testcase-workbench-model";

/**
 * Dedicated three-pane test case set workbench component bound to the standard projection form protocol
 * (`data.form` + `operations.save`). Combines a resizable case list (left), structured single-case editor (center),
 * live bidirectionally synchronized collapsible JSON editor (right), and optional bottom status/save bar, while
 * sharing the platform's local draft persistence (`persistDraft`) and three-state unsaved switch confirmation
 * (`unsavedSwitchMode`).
 */
const props = withDefaults(defineProps<{
  /** Persist unsaved non-secret edits in the platform local draft store across reloads. Defaults to `false`. */
  persistDraft?: boolean;
  /** Prompt mode when switching away from unsaved edits (`"discard-or-cancel"` or `"save-discard-cancel"`). */
  unsavedSwitchMode?: ObjectFormUnsavedSwitchMode;
  /** Whether to show the bottom status and Save/Revert footer bar. Defaults to `true`. */
  showFooterBar?: boolean;
  /** Optional empty-state text shown when no test case set is selected. */
  emptyText?: string;
}>(), {
  persistDraft: undefined,
  unsavedSwitchMode: undefined,
  showFooterBar: undefined,
  emptyText: undefined,
});

const emit = defineEmits<{
  /** Emitted after the owner saves the test case set. */
  saved: [object: { className: string; primaryKey: string | null }];
  /** Emitted after unsaved edits are discarded or reverted. */
  discarded: [];
}>();

const { t, te } = useI18n();
const tr = (key: string, fallback: string) => (te(key) ? t(key) : fallback);
const slot = useProjectionSlot();
const panel = usePanelContext();
const localDraftStore = useLocalDraftStore();
const objectType = projectionElement(slot.projection).id;
const member = useMember();
const forms: FormSource = memberFormSource(member, panel.instance);

const projectionConfig = computed<Record<string, unknown>>(() => (
  (slot.projection.config as Record<string, unknown> | undefined) ?? {}
));

const effectivePersistDraft = computed<boolean>(() => {
  if (props.persistDraft !== undefined) return props.persistDraft;
  return projectionConfig.value.persistDraft === true;
});

const effectiveUnsavedSwitchMode = computed<ObjectFormUnsavedSwitchMode>(() => {
  if (props.unsavedSwitchMode !== undefined) return props.unsavedSwitchMode;
  return projectionConfig.value.unsavedSwitchMode === "save-discard-cancel"
    ? "save-discard-cancel"
    : "discard-or-cancel";
});

const effectiveShowFooterBar = computed<boolean>(() => {
  if (props.showFooterBar !== undefined) return props.showFooterBar;
  if (typeof projectionConfig.value.showFooterBar === "boolean") return projectionConfig.value.showFooterBar;
  return true;
});

const effectiveEmptyText = computed<string | undefined>(() => {
  if (props.emptyText !== undefined) return props.emptyText;
  return typeof projectionConfig.value.emptyText === "string" ? projectionConfig.value.emptyText : undefined;
});

/** Stable form identifier scoping local drafts so multiple forms on the same object do not collide. */
const draftFormId = computed(() => slot.projection.id || slot.slot);

function localDraftKeyFor(forTarget: PanelFormTarget | null): string | null {
  if (!forTarget) return null;
  const formId = draftFormId.value;
  return forTarget.kind === "object"
    ? objectDraftKey(forTarget.objectType, forTarget.primaryKey, formId)
    : typeDraftKey(objectType, formId);
}

const editInput = editedInput(member.projection);
const creates = Object.values(member.projection.data).some((data) => data.read === "createForm")
  || (member.projection.data.form !== undefined && "type" in member.projection.data.form.source);
const state = computed(() => (editInput === undefined ? null : slotInputState(panel.manifest, slot.slot, editInput)));
const requestedKey = computed(() => (
  state.value !== null
    ? selectedKey(panel.instance.state.values.value[state.value])
    : editInput === undefined
      ? null
      : selectedKey(slot.inputs[editInput] as PanelFieldValue | undefined)
));
const requestedTarget = computed<PanelFormTarget | null>(() => {
  if (requestedKey.value) return { kind: "object", objectType, primaryKey: requestedKey.value };
  return creates ? { kind: "draft" } : null;
});
const target = shallowRef<PanelFormTarget | null>(requestedTarget.value);
const key = computed(() => (target.value?.kind === "object" ? target.value.primaryKey : null));
const effectiveTarget = computed<
  | { readonly kind: "object"; readonly objectType: string; readonly primaryKey: string }
  | { readonly kind: "draft"; readonly objectType: string }
  | null
>(() => {
  const current = target.value;
  if (!current) return null;
  return current.kind === "object" ? current : { kind: "draft", objectType };
});
const targetKey = formTargetKey;
const formInstanceId = ref(randomId());

const inputStateKeys = computed(() => {
  const names = new Set<string>();
  if (state.value !== null) names.add(state.value);
  return [...names];
});
let acceptedState = panel.instance.state.values.value;

function draftIdentity() {
  return JSON.stringify({ target: target.value });
}

/* ------------------------------------------------------------------ */
/*  Form & Workbench State                                             */
/* ------------------------------------------------------------------ */

const description = shallowRef<PanelFormDescription | null>(null);
const ownerOpened = shallowRef<PanelFormDescription | null>(null);
const values = shallowRef<PanelFormValues>({});
const caseSetName = ref("");
const cases = ref<TestcaseEntry[]>([]);
const selectedCaseIndex = ref(-1);

const jsonText = ref("[]");
const jsonError = ref("");
const isEditingJson = ref(false);

const changed = shallowRef<ReadonlySet<string>>(new Set());
const submitted = shallowRef<ReadonlySet<string>>(new Set());
const errors = shallowRef<Readonly<Record<string, string>>>({});
const refusal = shallowRef<Error | null>(null);
const loading = ref(true);
const saving = ref(false);
const failure = shallowRef<{ reason: Error; retry: () => void } | null>(null);

const restoredDraftState = shallowRef<{ readonly stale: boolean; readonly updatedAt: number } | null>(null);
let draftBaselineHash: string | null = null;

/* ------------------------------------------------------------------ */
/*  Three-Pane Resize & Collapse State                                 */
/* ------------------------------------------------------------------ */

const layoutRef = ref<HTMLElement | null>(null);
const leftPanelWidth = ref(260);
const rightPanelWidth = ref(380);
const jsonCollapsed = ref(false);
const activeResize = ref<"left" | "right" | null>(null);

let stopResizeHandler: (() => void) | null = null;

function stopResize() {
  stopResizeHandler?.();
}

function startResize(which: "left" | "right", event: MouseEvent) {
  event.preventDefault();
  stopResize();
  activeResize.value = which;
  const startX = event.clientX;
  const startLeft = leftPanelWidth.value;
  const startRight = rightPanelWidth.value;

  const onMove = (moveEvent: MouseEvent) => {
    const containerWidth = layoutRef.value?.clientWidth || 1200;
    if (which === "left") {
      const reserved = jsonCollapsed.value ? 260 : rightPanelWidth.value + 220;
      const maxLeft = Math.min(560, Math.max(180, containerWidth - reserved));
      leftPanelWidth.value = clampPaneWidth(startLeft + (moveEvent.clientX - startX), 180, maxLeft);
      return;
    }
    const maxRight = Math.min(760, Math.max(220, containerWidth - leftPanelWidth.value - 220));
    rightPanelWidth.value = clampPaneWidth(startRight - (moveEvent.clientX - startX), 220, maxRight);
  };

  const onUp = () => {
    activeResize.value = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    stopResizeHandler = null;
  };

  stopResizeHandler = onUp;
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ------------------------------------------------------------------ */
/*  Derived Computed Properties                                        */
/* ------------------------------------------------------------------ */

const fields = computed<readonly PanelFormField[]>(() => description.value?.fields ?? []);
const defaultJudgment = computed(() => extractDefaultJudgment(fields.value));
const fieldMeta = computed(() => extractTestcaseFieldMeta(fields.value));
const selectedCase = computed<TestcaseEntry | null>(() => {
  if (selectedCaseIndex.value < 0 || selectedCaseIndex.value >= cases.value.length) return null;
  return cases.value[selectedCaseIndex.value] ?? null;
});

const admittedSave = computed(() =>
  target.value ? formSave(member.operations.value, target.value, member.projection.operations) : null,
);
const saveUnavailable = computed(() =>
  member.operations.value.status === "ready" && admittedSave.value === null,
);

const canonicalValues = computed<PanelFormValues>(() =>
  toCaseSetFormValues(caseSetName.value, cases.value, values.value),
);

const baselineValues = computed<PanelFormValues | null>(() => {
  if (!ownerOpened.value) return null;
  const raw = ownerOpened.value.values;
  const name = typeof raw.name === "string" ? raw.name : "";
  const baseCases = extractTestcases(raw, defaultJudgment.value);
  return toCaseSetFormValues(name, baseCases, raw);
});

const dirty = computed<boolean>(() => {
  if (!baselineValues.value) return false;
  if (jsonError.value.length > 0) return true;
  return !jsonValuesEqual(canonicalValues.value, baselineValues.value);
});

const dirtyFields = computed<ReadonlySet<string>>(() => {
  if (!baselineValues.value) return new Set();
  const modified = new Set<string>(changed.value);
  if (!jsonValuesEqual(canonicalValues.value.name, baselineValues.value.name)) {
    modified.add("/name");
  }
  if (jsonError.value.length > 0 || !jsonValuesEqual(canonicalValues.value.cases, baselineValues.value.cases)) {
    modified.add("/cases");
  }
  return modified;
});

const hasValidCases = computed(() => hasValidTestcases(cases.value));

const canSubmit = computed(() => (
  !failure.value
  && !loading.value
  && description.value !== null
  && dirty.value
  && !saving.value
  && !saveUnavailable.value
  && jsonError.value.length === 0
  && hasValidCases.value
));

const formObjectLabel = computed<string | null>(() => {
  if (key.value) {
    const known = panel.instance.objectName(objectType, key.value);
    if (known) return known;
  }
  const trimmed = caseSetName.value.trim();
  return trimmed || key.value || null;
});

function fieldErrorFor(caseIndex: number, fieldKey: TestcaseFieldKey): string | undefined {
  return errors.value[`/cases/${caseIndex}/${fieldKey}`];
}

function caseHasError(caseIndex: number): boolean {
  const prefix = `/cases/${caseIndex}`;
  return Object.keys(errors.value).some((path) => path === prefix || path.startsWith(`${prefix}/`));
}

/* ------------------------------------------------------------------ */
/*  Local Draft Persistence                                            */
/* ------------------------------------------------------------------ */

function collectSecretPaths(currentValues: PanelFormValues): string[] {
  const paths = new Set<string>(formSecretPaths(fields.value, currentValues));
  if (ownerOpened.value) {
    for (const path of formSecretPaths(ownerOpened.value.fields, currentValues)) {
      paths.add(path);
    }
  }
  return [...paths];
}

function clearLocalDraft(forTarget: PanelFormTarget | null = target.value) {
  if (!localDraftStore) return;
  const draftKey = localDraftKeyFor(forTarget);
  if (draftKey) localDraftStore.remove(draftKey);
}

function syncLocalDraft() {
  if (!effectivePersistDraft.value || !localDraftStore || loading.value || !target.value || !ownerOpened.value || !baselineValues.value) {
    return;
  }
  const draftKey = localDraftKeyFor(target.value);
  if (!draftKey) return;
  if (!dirty.value) {
    localDraftStore.remove(draftKey);
    restoredDraftState.value = null;
    draftBaselineHash = computeDraftBaselineHash(ownerOpened.value.values);
    return;
  }
  if (jsonError.value.length > 0) {
    // Wait until JSON parses cleanly before overwriting the last valid structured local draft.
    return;
  }
  const currentValues = canonicalValues.value;
  const secretPaths = collectSecretPaths(currentValues);
  const sanitizedDraft = stripSecretDraftValues(currentValues, secretPaths);
  const sanitizedBaseline = stripSecretDraftValues(baselineValues.value, secretPaths);
  if (jsonValuesEqual(sanitizedDraft, sanitizedBaseline)) {
    localDraftStore.remove(draftKey);
    return;
  }
  localDraftStore.write(draftKey, {
    values: sanitizedDraft,
    baselineHash: draftBaselineHash ?? computeDraftBaselineHash(ownerOpened.value.values),
    updatedAt: Date.now(),
  });
}

function applyValuesState(nextValues: PanelFormValues, options?: { syncJson?: boolean }) {
  const nextName = typeof nextValues.name === "string" ? nextValues.name : "";
  const nextCases = extractTestcases(nextValues, defaultJudgment.value);
  caseSetName.value = nextName;
  cases.value = nextCases;
  values.value = toCaseSetFormValues(nextName, nextCases, nextValues);
  if (nextCases.length === 0) {
    selectedCaseIndex.value = -1;
  } else if (selectedCaseIndex.value < 0 || selectedCaseIndex.value >= nextCases.length) {
    selectedCaseIndex.value = 0;
  }
  if (options?.syncJson !== false) {
    jsonText.value = serializeTestcasesJson(nextCases);
    jsonError.value = "";
  }
}

function tryRestoreLocalDraft(forTarget: PanelFormTarget, baseline: PanelFormDescription) {
  if (!effectivePersistDraft.value || !localDraftStore || !baselineValues.value) return;
  const draftKey = localDraftKeyFor(forTarget);
  if (!draftKey) return;
  const stored = localDraftStore.read(draftKey);
  if (!stored) return;
  const currentBaselineHash = computeDraftBaselineHash(baseline.values);
  const stale = stored.baselineHash !== currentBaselineHash;
  const secretPaths = collectSecretPaths(baseline.values);
  const sanitizedDraft = stripSecretDraftValues(stored.values, secretPaths);
  const merged: PanelFormValues = { ...baseline.values, ...sanitizedDraft };
  const mergedName = typeof merged.name === "string" ? merged.name : "";
  const mergedCases = extractTestcases(merged, defaultJudgment.value);
  const normalizedMerged = toCaseSetFormValues(mergedName, mergedCases, merged);
  const changedFromBaseline = !jsonValuesEqual(normalizedMerged, baselineValues.value);
  if (!changedFromBaseline && !stale) {
    localDraftStore.remove(draftKey);
    return;
  }
  applyValuesState(normalizedMerged, { syncJson: true });
  const restoredSubmitted = new Set<string>();
  if (!jsonValuesEqual(normalizedMerged.name, baselineValues.value.name)) restoredSubmitted.add("/name");
  if (!jsonValuesEqual(normalizedMerged.cases, baselineValues.value.cases)) restoredSubmitted.add("/cases");
  submitted.value = restoredSubmitted;
  draftBaselineHash = stored.baselineHash;
  restoredDraftState.value = {
    stale,
    updatedAt: stored.updatedAt,
  };
}

function discardRestoredDraft() {
  clearLocalDraft(target.value);
  restoredDraftState.value = null;
  discard();
}

/* ------------------------------------------------------------------ */
/*  Loading & Adopting Owner Baseline                                  */
/* ------------------------------------------------------------------ */

const fieldMessages = (list: readonly { field: string; message: string }[]) =>
  Object.fromEntries(list.map(({ field, message }) => [field, message]));

let latestRead = 0;
let pendingRefresh = false;

function adopt(baseline: PanelFormDescription, shown: PanelFormDescription = baseline) {
  ownerOpened.value = baseline;
  description.value = shown;
  changed.value = new Set();
  submitted.value = new Set();
  refusal.value = null;
  errors.value = fieldMessages(shown.errors);
  failure.value = null;
  loading.value = false;
  restoredDraftState.value = null;
  draftBaselineHash = computeDraftBaselineHash(baseline.values);
  selectedCaseIndex.value = -1;
  applyValuesState(shown.values, { syncJson: true });
}

function restoreRollback(draft: PanelFormDraft) {
  adopt(draft.ownerOpened, draft.ownerShown);
  applyValuesState(draft.values, { syncJson: true });
  changed.value = draft.changed;
  submitted.value = draft.submitted;
  errors.value = draft.errors;
  refusal.value = draft.refusal;
  const invalidJson = draft.invalid["/cases"];
  if (invalidJson) {
    jsonText.value = invalidJson.source;
    jsonError.value = invalidJson.message;
  }
}

function load(next: PanelFormTarget | null) {
  const reading = ++latestRead;
  failure.value = null;
  const rollback = panel.instance.forms.takeRollback(draftIdentity());
  if (rollback) {
    restoreRollback(rollback);
    return;
  }
  if (next === null) {
    description.value = ownerOpened.value = null;
    values.value = {};
    caseSetName.value = "";
    cases.value = [];
    selectedCaseIndex.value = -1;
    jsonText.value = "[]";
    jsonError.value = "";
    restoredDraftState.value = null;
    draftBaselineHash = null;
    loading.value = false;
    return;
  }
  description.value = ownerOpened.value = null;
  values.value = {};
  cases.value = [];
  selectedCaseIndex.value = -1;
  jsonText.value = "[]";
  jsonError.value = "";
  restoredDraftState.value = null;
  loading.value = true;
  void forms.describe({ target: next, changedField: null }).then(
    (answer) => {
      if (reading !== latestRead) return;
      adopt(answer);
      tryRestoreLocalDraft(next, answer);
    },
    (reason: unknown) => {
      if (reading !== latestRead) return;
      failure.value = {
        reason: reason instanceof Error ? reason : new Error(String(reason)),
        retry: () => load(next),
      };
      loading.value = false;
    },
  );
}

function refreshWhenClean() {
  if (!pendingRefresh || dirty.value || saving.value) return;
  pendingRefresh = false;
  const current = target.value;
  if (!current) return;
  const reading = ++latestRead;
  void forms.describe({ target: current, changedField: null }).then(
    (answer) => {
      if (reading !== latestRead) return;
      if (dirty.value || saving.value) {
        pendingRefresh = true;
        return;
      }
      adopt(answer);
    },
    (reason: unknown) => {
      if (reading !== latestRead) return;
      if (dirty.value || saving.value) {
        pendingRefresh = true;
        return;
      }
      failure.value = {
        reason: reason instanceof Error ? reason : new Error(String(reason)),
        retry: () => load(current),
      };
    },
  );
}

async function refreshDraft(): Promise<void> {
  const current = target.value;
  if (!current || !description.value) return;
  const reading = ++latestRead;
  const answer = await forms.describe({
    target: current,
    values: canonicalValues.value,
    changedField: null,
  });
  if (reading !== latestRead) return;
  description.value = answer;
  errors.value = fieldMessages(answer.errors);
}

/* ------------------------------------------------------------------ */
/*  Interactive Workbench Mutations (Form <-> JSON Bidirectional Sync) */
/* ------------------------------------------------------------------ */

function commitCasesMutation(nextCases: TestcaseEntry[], options?: { syncJson?: boolean }) {
  cases.value = nextCases;
  values.value = toCaseSetFormValues(caseSetName.value, nextCases, values.value);
  submitted.value = new Set([...submitted.value, "/cases"]);
  refusal.value = null;
  if (options?.syncJson !== false && !isEditingJson.value) {
    jsonText.value = serializeTestcasesJson(nextCases);
    jsonError.value = "";
  }
  syncLocalDraft();
}

function selectCase(index: number) {
  if (index < 0 || index >= cases.value.length) return;
  selectedCaseIndex.value = index;
}

function addCase() {
  const nextId = generateNextCaseId(cases.value);
  const newItem: TestcaseEntry = {
    caseId: nextId,
    question: "",
    expectedAnswer: "",
    expectedLogic: "",
    judgment: defaultJudgment.value,
  };
  const nextCases = [...cases.value, newItem];
  selectedCaseIndex.value = nextCases.length - 1;
  isEditingJson.value = false;
  commitCasesMutation(nextCases, { syncJson: true });
}

function removeCase(index: number) {
  if (index < 0 || index >= cases.value.length) return;
  const nextCases = cases.value.filter((_, i) => i !== index);
  if (nextCases.length === 0) {
    selectedCaseIndex.value = -1;
  } else if (selectedCaseIndex.value >= nextCases.length) {
    selectedCaseIndex.value = nextCases.length - 1;
  } else if (selectedCaseIndex.value > index) {
    selectedCaseIndex.value -= 1;
  }
  isEditingJson.value = false;
  commitCasesMutation(nextCases, { syncJson: true });
}

function updateSelectedCaseField(fieldKey: TestcaseFieldKey, nextValue: string) {
  const idx = selectedCaseIndex.value;
  if (idx < 0 || idx >= cases.value.length) return;
  const current = cases.value[idx]!;
  if (current[fieldKey] === nextValue) return;
  const nextCases = cases.value.map((item, i) => (
    i === idx ? { ...item, [fieldKey]: nextValue } : item
  ));
  isEditingJson.value = false;
  // Clear field error on the edited field once modified.
  const errorPath = `/cases/${idx}/${fieldKey}`;
  if (errorPath in errors.value) {
    const nextErrors = { ...errors.value };
    delete nextErrors[errorPath];
    errors.value = nextErrors;
  }
  commitCasesMutation(nextCases, { syncJson: true });
}

function handleJsonFocus() {
  isEditingJson.value = true;
}

function handleJsonBlur() {
  isEditingJson.value = false;
  if (!jsonError.value) {
    jsonText.value = serializeTestcasesJson(cases.value);
  }
}

function handleJsonInput(event: Event) {
  const nextText = (event.target as HTMLTextAreaElement).value;
  jsonText.value = nextText;
  const parsed = parseTestcasesJson(nextText, defaultJudgment.value);
  if (!parsed.ok) {
    jsonError.value = parsed.error;
    return;
  }
  jsonError.value = "";
  const nextCases = parsed.cases;
  if (nextCases.length === 0) {
    selectedCaseIndex.value = -1;
  } else if (selectedCaseIndex.value < 0 || selectedCaseIndex.value >= nextCases.length) {
    selectedCaseIndex.value = 0;
  }
  commitCasesMutation(nextCases, { syncJson: false });
}

function setFieldByPointer(path: string, value: RuntimeJsonValue) {
  const nextValues = withValueAt(canonicalValues.value, path, value) as PanelFormValues;
  const described = path.startsWith("/cases") ? "/cases" : path;
  submitted.value = new Set([...submitted.value, described]);
  applyValuesState(nextValues, { syncJson: true });
  syncLocalDraft();
}

/* ------------------------------------------------------------------ */
/*  Save, Discard & Target Switch Protection                           */
/* ------------------------------------------------------------------ */

function showRefusal(reason: unknown) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  refusal.value = error;
  if (reason instanceof PlatformObjectRefusal) {
    errors.value = { ...reason.fields };
  }
}

function discard() {
  clearLocalDraft(target.value);
  restoredDraftState.value = null;
  if (ownerOpened.value) {
    adopt(ownerOpened.value);
  }
  emit("discarded");
}

async function confirmDiscard(): Promise<boolean> {
  const confirmed = await confirmDanger(
    tr("platform.formDiscardConfirm", "Discard the changes you have not saved?"),
    tr("platform.discard", "Discard"),
    {
      confirmButtonText: tr("platform.discard", "Discard"),
      cancelButtonText: tr("platform.keepEditing", "Keep editing"),
    },
  );
  if (confirmed) discard();
  return confirmed;
}

function saveInput(payloadValues: PanelFormValues) {
  const revision = ownerOpened.value?.revision;
  const submittedList = submitted.value.size > 0
    ? [...submitted.value]
    : [...dirtyFields.value];
  return {
    values: payloadValues,
    submittedFields: submittedList,
    ...(revision === undefined ? {} : { revision }),
  };
}

let mounted = false;
let unmounted = false;
let confirmingSwitch = false;

function formContextChanged() {
  return requestedTarget.value?.kind !== target.value?.kind
    || targetKey(requestedTarget.value) !== targetKey(target.value);
}

async function write(
  override?: FormSubmitOverride,
  agentContext?: PanelAgentActionContext,
  options?: { allowPendingSwitch?: boolean },
): Promise<unknown> {
  const into = target.value;
  if (!into) throw new Error("No test case set is selected.");
  if (failure.value) throw failure.value.reason;
  if (saving.value) throw new Error("The test case set is currently saving.");
  if (loading.value) throw new Error(tr("common.loading", "Loading"));
  if (jsonError.value) throw new Error(tr("platform.testcaseJsonInvalid", "Invalid JSON"));
  if (!hasValidCases.value) {
    throw new Error(tr("platform.testcaseNeedValidCases", "Keep at least one case with a non-empty question"));
  }

  const capturedTargetKey = targetKey(into);
  const capturedOpened = ownerOpened.value;
  const payloadValues = pruneInactivePanelFormVariants(fields.value, canonicalValues.value);

  const evaluateSaveSubmission: SubmissionEvaluator = (phase: SubmissionCheckPhase) => {
    if (unmounted || !mounted || panel.instance.isDisposed()) {
      return { ok: false, message: "The workbench was closed or unmounted." };
    }
    if (!options?.allowPendingSwitch && formContextChanged()) {
      return { ok: false, message: "The selected test case set changed." };
    }
    if (options?.allowPendingSwitch && targetKey(target.value) !== capturedTargetKey) {
      return { ok: false, message: "The selected test case set changed." };
    }
    if (!target.value || !ownerOpened.value) {
      return { ok: false, message: "No active test case set target." };
    }
    if (phase === "confirm" && saving.value) {
      return { ok: false, message: "The test case set is currently saving." };
    }
    if (jsonError.value) {
      return { ok: false, message: tr("platform.testcaseJsonInvalid", "Invalid JSON") };
    }
    if (!hasValidCases.value) {
      return { ok: false, message: tr("platform.testcaseNeedValidCases", "Keep at least one case with a non-empty question") };
    }
    if (!override && !admittedSave.value) {
      return { ok: false, message: "The save operation is no longer available." };
    }
    const liveOperationId = override?.operationId ?? panel.instance.operationIdOf(slot.slot, admittedSave.value!.name);
    const liveDescriptor = override?.descriptor ?? admittedSave.value!.descriptor;
    const liveCallTarget = liveDescriptor.target.source === "none" ? null : target.value;
    return {
      ok: true,
      instanceId: panel.instance.instanceId,
      operationId: liveOperationId,
      target: { formTarget: effectiveTarget.value, callTarget: liveCallTarget },
      payload: {
        formInstanceId: formInstanceId.value,
        values: payloadValues,
        revision: ownerOpened.value.revision ?? null,
        dirty: dirty.value,
      },
    };
  };

  saving.value = true;
  refusal.value = null;
  errors.value = {};
  try {
    const saved: FormSaveResult = await forms.save(
      into,
      saveInput(payloadValues),
      override,
      {
        secretFields: collectSecretPaths(payloadValues),
        changedFields: [...dirtyFields.value],
        baselineValues: ownerOpened.value?.values,
        ...(agentContext ?? override?.agentContext ? { agentContext: agentContext ?? override?.agentContext } : {}),
        evaluateSubmission: evaluateSaveSubmission,
      },
    );
    clearLocalDraft(into);
    const stillSame = !unmounted && targetKey(target.value) === capturedTargetKey && ownerOpened.value === capturedOpened;
    if (stillSame && description.value) {
      const nextBaseline: PanelFormDescription = {
        ...description.value,
        values: splitPanelSecrets(payloadValues, collectSecretPaths(payloadValues)).redacted,
        errors: [],
      };
      const previousSelected = selectedCaseIndex.value;
      adopt(nextBaseline);
      if (previousSelected >= 0 && previousSelected < cases.value.length) {
        selectedCaseIndex.value = previousSelected;
      }
    }
    emit("saved", { className: objectType, primaryKey: saved.primaryKey });
    return saved;
  } catch (reason) {
    if (reason instanceof PanelOperationDeferred || reason instanceof PanelConfirmationDeferred || reason instanceof PanelSubmissionStaleError) {
      throw reason;
    }
    if (!unmounted && targetKey(target.value) === capturedTargetKey && ownerOpened.value === capturedOpened) {
      showRefusal(reason);
    }
    throw reason;
  } finally {
    saving.value = false;
  }
}

async function saveFromWorkbench() {
  try {
    await panel.instance.forms.submit(slot.slot);
  } catch (reason) {
    if (reason instanceof PanelConfirmationDeferred) return;
    showRefusal(reason);
  }
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (canSubmit.value) void saveFromWorkbench();
  }
}

watch(requestedTarget, async () => {
  if (confirmingSwitch) return;
  if (!formContextChanged()) {
    acceptedState = panel.instance.state.values.value;
    return;
  }
  const probing = panel.instance.forms.probing;
  if (probing && dirty.value) return;
  const shouldGuard = !probing && dirty.value && !saving.value;
  let savedBeforeSwitch = false;
  if (shouldGuard) {
    confirmingSwitch = true;
    let leave = false;
    try {
      if (effectiveUnsavedSwitchMode.value === "save-discard-cancel") {
        const decision = await confirmUnsavedSwitch(
          tr("platform.formLeaveUnsavedSwitch", "This form has unsaved changes. Save before switching, or discard them?"),
          tr("platform.unsavedChanges", "Unsaved changes"),
          {
            saveButtonText: tr("platform.formSaveAndSwitch", "Save and switch"),
            discardButtonText: tr("platform.formDiscardChanges", "Discard changes"),
          },
        );
        if (unmounted || !formContextChanged()) return;
        if (decision === "discard") {
          leave = true;
        } else if (decision === "save") {
          try {
            await write(undefined, undefined, { allowPendingSwitch: true });
            leave = true;
            savedBeforeSwitch = true;
          } catch (reason) {
            if (!(reason instanceof PanelConfirmationDeferred)) {
              showRefusal(reason);
            }
            leave = false;
          }
        } else {
          leave = false;
        }
      } else {
        leave = panel.confirmLeaveUnsaved
          ? await panel.confirmLeaveUnsaved()
          : await confirmDanger(
              tr("platform.formLeaveUnsaved", "This form has changes you have not saved. Discard them and open the other item?"),
              tr("platform.unsavedChanges", "Unsaved changes"),
              {
                confirmButtonText: tr("platform.discard", "Discard"),
                cancelButtonText: tr("platform.keepEditing", "Keep editing"),
              },
            );
      }
    } finally {
      confirmingSwitch = false;
    }
    if (unmounted || !formContextChanged()) return;
    if (!leave) {
      const current = panel.instance.state.values.value;
      panel.instance.state.setState(Object.fromEntries(inputStateKeys.value.flatMap((name) => (
        jsonValuesEqual(current[name], acceptedState[name]) ? [] : [[name, acceptedState[name]!]]
      ))));
      return;
    }
  }
  pendingRefresh = false;
  if (shouldGuard && !savedBeforeSwitch) discard();
  acceptedState = panel.instance.state.values.value;
  target.value = requestedTarget.value;
  formInstanceId.value = randomId();
  load(target.value);
});

watch(effectivePersistDraft, (enabled) => {
  if (enabled) syncLocalDraft();
});

useProjectionObjectRefresh((id) => id === key.value, () => {
  pendingRefresh = true;
  refreshWhenClean();
});
watch([dirty, saving], refreshWhenClean);

/* ------------------------------------------------------------------ */
/*  SDK Form Protocol & Action Handler Registration                    */
/* ------------------------------------------------------------------ */

useMemberOutput("label", () => (description.value ? formObjectLabel.value : null));
useMemberOutput("dirty", () => dirty.value);
useMemberOutput("draft", () => (description.value ? canonicalValues.value : null));

useProjectionForm({
  handle: {
    fields,
    values: canonicalValues,
    errors,
    changed,
    busy: saving,
    dirty,
    dirtyFields,
    submitting: saving,
    canSubmit,
    set: setFieldByPointer,
    refreshDraft,
    submit: () => panel.instance.forms.submit(slot.slot),
    reset: async (options) => {
      if (options?.confirm) return await confirmDiscard();
      discard();
      return true;
    },
  },
  async fill(rawValues, options) {
    if (options?.expectedFormInstanceId !== undefined && options.expectedFormInstanceId !== formInstanceId.value) {
      return { ok: false, reason: "stale", message: "The form instance changed since the last observation." };
    }
    if (options?.expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, options.expectedTarget)) {
      return { ok: false, reason: "stale", message: "The selected test case set changed." };
    }
    if (!mounted || unmounted || !target.value || !ownerOpened.value || loading.value || saving.value || failure.value) {
      return { ok: false, reason: "form_not_ready", message: "The test case workbench is not ready." };
    }
    const filledFields: string[] = [];
    const rejectedFields: FormFieldRejection[] = [];
    let nextValues = canonicalValues.value;
    for (const [rawKey, val] of Object.entries(rawValues)) {
      const pointer = rawKey.startsWith("/") ? rawKey : `/${rawKey}`;
      if (pointer === "/name" || pointer === "/cases" || pointer.startsWith("/cases/")) {
        nextValues = withValueAt(nextValues, pointer, val) as PanelFormValues;
        filledFields.push(pointer);
      } else {
        rejectedFields.push({
          path: pointer,
          reason: "unknown_field",
          message: `Field ${pointer} is not editable in TestcaseWorkbench.`,
        });
      }
    }
    if (filledFields.length === 0) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        rejectedFields,
        message: "None of the requested fields could be edited.",
      };
    }
    submitted.value = new Set([...submitted.value, ...filledFields.map((p) => (p.startsWith("/cases") ? "/cases" : p))]);
    changed.value = new Set([...changed.value, ...filledFields]);
    applyValuesState(nextValues, { syncJson: true });
    syncLocalDraft();
    return {
      ok: true,
      filledFields,
      ...(rejectedFields.length ? { rejectedFields } : {}),
    };
  },
  submit: (override) => write(override),
  dirty: () => dirty.value,
  editingTarget: () => target.value,
  discard,
  draft: {
    identity: draftIdentity,
    inputStateKeys: () => inputStateKeys.value,
    capture: () => ({
      ownerOpened: ownerOpened.value!,
      ownerShown: description.value!,
      values: canonicalValues.value,
      changed: changed.value,
      submitted: submitted.value,
      invalid: (jsonError.value
        ? { "/cases": { source: jsonText.value, message: jsonError.value } satisfies InvalidFormText }
        : {}) as Readonly<Record<string, InvalidFormText>>,
      errors: errors.value,
      refusal: refusal.value,
      editedPaths: dirtyFields.value,
      userEditedPaths: dirtyFields.value,
      agentFilledPaths: changed.value,
    }),
    restore: restoreRollback,
  },
  snapshot() {
    if (!ownerOpened.value) return null;
    const currentTarget = target.value;
    const modified = [...dirtyFields.value];
    const currentVals = canonicalValues.value;
    const paths = collectSecretPaths(currentVals);
    return {
      formInstanceId: formInstanceId.value,
      ...(currentTarget
        ? {
            target: currentTarget.kind === "object"
              ? { kind: "object" as const, objectType: currentTarget.objectType, primaryKey: currentTarget.primaryKey }
              : { kind: "draft" as const, objectType },
          }
        : {}),
      dirty: dirty.value,
      ...(modified.length ? { dirtyFields: modified } : {}),
      values: splitPanelSecrets(currentVals, paths).redacted,
      ...(paths.length
        ? { secretFields: Object.fromEntries(paths.map((path) => [path, panelSecretValuePresent(valueAt(currentVals, path))])) }
        : {}),
    };
  },
});

const unregisterDiscard = panel.instance.registerActionHandler(
  panel.instance.operationIdOf(slot.slot, "discard"),
  async ({ expectedTarget }) => {
    if (expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, expectedTarget)) {
      return { ok: false as const, reason: "stale" as const, message: "The selected test case set changed." };
    }
    if (!dirty.value) {
      return { ok: false as const, reason: "action_unavailable" as const, message: "No unsaved changes to discard." };
    }
    discard();
    return { ok: true as const, outcome: { discarded: true } };
  },
  { entryInstanceId: () => formInstanceId.value },
);

const unregisterReset = panel.instance.registerActionHandler(
  panel.instance.operationIdOf(slot.slot, "reset"),
  async ({ expectedTarget }) => {
    if (expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, expectedTarget)) {
      return { ok: false as const, reason: "stale" as const, message: "The selected test case set changed." };
    }
    if (!dirty.value) {
      return { ok: false as const, reason: "action_unavailable" as const, message: "No unsaved changes to reset." };
    }
    discard();
    return { ok: true as const, outcome: { discarded: true } };
  },
  { entryInstanceId: () => formInstanceId.value },
);

const saveOperationName = computed<string | null>(() => {
  if (admittedSave.value) return admittedSave.value.name;
  const platformSave = Object.entries(member.projection.operations ?? {}).find(
    ([name, binding]) => binding.operation.kind === "PlatformOperation"
      && (binding.operation.id.endsWith(".save") || name === "save"),
  );
  return platformSave?.[0] ?? null;
});

let unregisterSave: (() => void) | null = null;
watch(saveOperationName, (name) => {
  unregisterSave?.();
  unregisterSave = null;
  if (!name) return;
  unregisterSave = panel.instance.registerActionHandler(
    panel.instance.operationIdOf(slot.slot, name),
    async ({ expectedTarget, agentContext }) => {
      if (expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, expectedTarget)) {
        return { ok: false, reason: "stale", message: "The selected test case set changed." };
      }
      if (!mounted || unmounted || panel.instance.isDisposed() || !target.value || !ownerOpened.value || loading.value) {
        return { ok: false, reason: "action_not_ready", message: "The workbench is not ready to save." };
      }
      if (!admittedSave.value) {
        return missingOperationDescriptorResult(member.operations.value, name);
      }
      if (jsonError.value) {
        return { ok: false, reason: "validation_failed", message: tr("platform.testcaseJsonInvalid", "Invalid JSON") };
      }
      if (!hasValidCases.value) {
        return {
          ok: false,
          reason: "validation_failed",
          message: tr("platform.testcaseNeedValidCases", "Keep at least one case with a non-empty question"),
        };
      }
      try {
        const outcome = await write(undefined, agentContext);
        if (agentContext?.completed) {
          const classified = classifyDispatchResponseForAction(agentContext.completed.response);
          if (!classified.ok) return classified;
        }
        return { ok: true, outcome };
      } catch (reason) {
        if (reason instanceof PanelConfirmationDeferred || reason instanceof PanelSubmissionStaleError) throw reason;
        if (agentContext?.completed) {
          return classifyDispatchResponseForAction(agentContext.completed.response);
        }
        throw reason;
      }
    },
    { entryInstanceId: () => formInstanceId.value },
  );
}, { immediate: true });

onMounted(() => {
  mounted = true;
  load(target.value);
});

onBeforeUnmount(() => {
  unmounted = true;
  latestRead += 1;
  stopResize();
  unregisterDiscard?.();
  unregisterReset?.();
  unregisterSave?.();
});

const shown = computed<DataStateResult<PanelFormDescription>>(() => {
  if (state.value !== null && panel.instance.addressPending?.value) {
    return { status: "loading" };
  }
  if (failure.value) {
    const { reason, retry } = failure.value;
    return reason instanceof MemberDataUnavailable && reason.state.status !== "error"
      ? reason.state
      : { status: "error", message: reason.message, retry };
  }
  if (loading.value) return { status: "loading" };
  return description.value ? { status: "ready", value: description.value } : { status: "awaiting" };
});

const baseLabels = useDataStateLabels();
const dataStateLabels = computed(() => (
  effectiveEmptyText.value
    ? { ...baseLabels.value, awaiting: effectiveEmptyText.value }
    : baseLabels.value
));
</script>

<template>
  <div class="sdk-testcase-workbench" @keydown="handleKeydown">
    <data-state :result="shown" :labels="dataStateLabels">
      <div class="tc-shell">
        <div
          v-if="restoredDraftState"
          class="tc-draft-banner"
          :class="{ 'is-stale': restoredDraftState.stale }"
          :data-draft-banner="restoredDraftState.stale ? 'stale' : 'restored'"
          role="status"
        >
          <span class="tc-draft-banner-text">
            {{
              restoredDraftState.stale
                ? tr("platform.formDraftRestoredStale", "Restored your unsaved draft, but this item has been updated since then. Review carefully before saving.")
                : tr("platform.formDraftRestored", "Restored your unsaved draft from this browser.")
            }}
          </span>
          <el-button
            size="small"
            text
            :type="restoredDraftState.stale ? 'warning' : 'primary'"
            data-draft-discard
            @click="discardRestoredDraft"
          >
            {{ tr("platform.formDraftDiscard", "Discard draft") }}
          </el-button>
        </div>

        <div
          ref="layoutRef"
          class="tc-three-pane"
          :class="{ 'is-dragging': activeResize !== null }"
          data-testcase-panes
        >
          <!-- Left pane: test case list -->
          <aside class="tc-pane-left" :style="{ width: `${leftPanelWidth}px` }" data-testcase-list-pane>
            <div class="tc-pane-header">
              <span class="tc-pane-title">{{ formObjectLabel || tr("platform.testcaseBasicInfo", "Cases") }}</span>
              <span class="tc-pane-count" data-testcase-count>{{ cases.length }}</span>
            </div>

            <div class="tc-case-list" role="listbox">
              <div
                v-for="(item, index) in cases"
                :key="`${index}-${item.caseId}`"
                class="tc-case-item"
                :class="{
                  'is-active': selectedCaseIndex === index,
                  'has-error': caseHasError(index),
                }"
                role="option"
                :aria-selected="selectedCaseIndex === index"
                data-testcase-item
                :data-case-index="index"
                @click="selectCase(index)"
              >
                <div class="tc-case-item-main">
                  <span class="tc-case-item-question">
                    {{ testcaseSummary(item, tr("platform.testcaseEmptySelection", "Untitled case")) }}
                  </span>
                  <span class="tc-case-item-id">{{ item.caseId || `#${index + 1}` }}</span>
                </div>
                <el-button
                  class="tc-case-item-delete"
                  type="danger"
                  text
                  size="small"
                  :disabled="saving || fieldMeta.caseId.readOnly"
                  data-testcase-delete
                  @click.stop="removeCase(index)"
                >
                  {{ tr("platform.testcaseDeleteCase", "Delete case") }}
                </el-button>
              </div>

              <p v-if="cases.length === 0" class="tc-list-empty">
                {{ tr("platform.testcaseEmptySelection", "Select or add a case to start editing") }}
              </p>
            </div>

            <div class="tc-pane-footer">
              <button
                type="button"
                class="tc-add-btn"
                :disabled="saving || fieldMeta.caseId.readOnly"
                data-testcase-add
                @click="addCase"
              >
                + {{ tr("platform.testcaseAddCase", "Add case") }}
              </button>
            </div>
          </aside>

          <div
            class="tc-resizer"
            role="separator"
            aria-orientation="vertical"
            data-resizer="left"
            @mousedown="startResize('left', $event)"
          ></div>

          <!-- Center pane: structured form for the selected case -->
          <section class="tc-pane-center" data-testcase-editor-pane>
            <div v-if="selectedCase" class="tc-form-card">
              <div class="tc-form-section">
                <h3 class="tc-section-title">{{ tr("platform.testcaseBasicInfo", "Basic info") }}</h3>

                <div class="tc-field">
                  <label class="tc-field-label">
                    <span class="tc-label-main">{{ fieldMeta.caseId.label }}</span>
                    <code class="tc-label-key">caseId</code>
                  </label>
                  <el-input
                    :model-value="selectedCase.caseId"
                    class="tc-input-short"
                    :placeholder="fieldMeta.caseId.placeholder || 'case-001'"
                    :disabled="saving || fieldMeta.caseId.readOnly"
                    data-testcase-field="caseId"
                    @update:model-value="updateSelectedCaseField('caseId', String($event))"
                  />
                  <p v-if="fieldErrorFor(selectedCaseIndex, 'caseId')" class="tc-field-error" role="alert">
                    {{ fieldErrorFor(selectedCaseIndex, "caseId") }}
                  </p>
                </div>

                <div class="tc-field">
                  <label class="tc-field-label">
                    <span class="tc-label-main">{{ fieldMeta.question.label }}</span>
                    <code class="tc-label-key">question</code>
                  </label>
                  <el-input
                    :model-value="selectedCase.question"
                    type="textarea"
                    :rows="3"
                    :placeholder="fieldMeta.question.placeholder"
                    :disabled="saving || fieldMeta.question.readOnly"
                    data-testcase-field="question"
                    @update:model-value="updateSelectedCaseField('question', String($event))"
                  />
                  <p v-if="fieldErrorFor(selectedCaseIndex, 'question')" class="tc-field-error" role="alert">
                    {{ fieldErrorFor(selectedCaseIndex, "question") }}
                  </p>
                </div>
              </div>

              <hr class="tc-section-divider" />

              <div class="tc-form-section">
                <h3 class="tc-section-title">{{ tr("platform.testcaseExpectedResult", "Expected result") }}</h3>

                <div class="tc-field">
                  <label class="tc-field-label">
                    <span class="tc-label-main">{{ fieldMeta.expectedAnswer.label }}</span>
                    <code class="tc-label-key">expectedAnswer</code>
                  </label>
                  <el-input
                    :model-value="selectedCase.expectedAnswer"
                    type="textarea"
                    :rows="2"
                    :placeholder="fieldMeta.expectedAnswer.placeholder"
                    :disabled="saving || fieldMeta.expectedAnswer.readOnly"
                    data-testcase-field="expectedAnswer"
                    @update:model-value="updateSelectedCaseField('expectedAnswer', String($event))"
                  />
                </div>

                <div class="tc-field">
                  <label class="tc-field-label">
                    <span class="tc-label-main">{{ fieldMeta.judgment.label }}</span>
                    <code class="tc-label-key">judgment</code>
                  </label>
                  <el-input
                    :model-value="selectedCase.judgment"
                    type="textarea"
                    :rows="3"
                    :placeholder="fieldMeta.judgment.placeholder || defaultJudgment"
                    :disabled="saving || fieldMeta.judgment.readOnly"
                    data-testcase-field="judgment"
                    @update:model-value="updateSelectedCaseField('judgment', String($event))"
                  />
                </div>

                <div class="tc-field">
                  <label class="tc-field-label">
                    <span class="tc-label-main">{{ fieldMeta.expectedLogic.label }}</span>
                    <code class="tc-label-key">expectedLogic</code>
                  </label>
                  <el-input
                    :model-value="selectedCase.expectedLogic"
                    type="textarea"
                    :rows="6"
                    class="tc-field-mono"
                    :placeholder="fieldMeta.expectedLogic.placeholder"
                    :disabled="saving || fieldMeta.expectedLogic.readOnly"
                    data-testcase-field="expectedLogic"
                    @update:model-value="updateSelectedCaseField('expectedLogic', String($event))"
                  />
                </div>
              </div>
            </div>

            <div v-else class="tc-empty-selection" data-testcase-empty-selection>
              <p class="tc-empty-selection-text">
                {{ tr("platform.testcaseEmptySelection", "Select or add a case to start editing") }}
              </p>
              <el-button
                size="small"
                :disabled="saving || fieldMeta.caseId.readOnly"
                @click="addCase"
              >
                + {{ tr("platform.testcaseAddCase", "Add case") }}
              </el-button>
            </div>
          </section>

          <div
            v-if="!jsonCollapsed"
            class="tc-resizer"
            role="separator"
            aria-orientation="vertical"
            data-resizer="right"
            @mousedown="startResize('right', $event)"
          ></div>

          <!-- Right pane: live bidirectional JSON editor -->
          <aside
            v-if="!jsonCollapsed"
            class="tc-pane-right"
            :style="{ width: `${rightPanelWidth}px` }"
            data-testcase-json-pane
          >
            <div class="tc-pane-header tc-json-header">
              <div class="tc-json-header-title">
                <span class="tc-pane-title">{{ tr("platform.testcaseJsonPanel", "JSON") }}</span>
                <span class="tc-pane-count">{{ cases.length }}</span>
                <span
                  v-if="jsonError"
                  class="tc-json-invalid-badge"
                  data-json-invalid-badge
                  role="status"
                >
                  {{ tr("platform.testcaseJsonInvalid", "Invalid JSON") }}
                </span>
              </div>
              <el-button
                text
                size="small"
                data-json-collapse
                @click="jsonCollapsed = true"
              >
                {{ tr("platform.testcaseCollapseJson", "Collapse JSON") }}
              </el-button>
            </div>

            <div class="tc-json-body">
              <textarea
                class="tc-json-textarea"
                :class="{ 'is-invalid': Boolean(jsonError) }"
                :value="jsonText"
                :disabled="saving || fieldMeta.caseId.readOnly"
                spellcheck="false"
                placeholder='[{"caseId":"case-001","question":"..."}]'
                data-testcase-json-input
                @focus="handleJsonFocus"
                @blur="handleJsonBlur"
                @input="handleJsonInput"
              ></textarea>
              <div v-if="jsonError" class="tc-json-error" role="alert" data-json-error>
                {{ jsonError }}
              </div>
            </div>
          </aside>

          <button
            v-else
            type="button"
            class="tc-json-expand-btn"
            :title="tr('platform.testcaseExpandJson', 'Expand JSON')"
            data-json-expand
            @click="jsonCollapsed = false"
          >
            <span class="tc-json-expand-icon">{ }</span>
            <span>{{ tr("platform.testcaseExpandJson", "Expand JSON") }}</span>
          </button>
        </div>

        <!-- Bottom status & save bar -->
        <footer v-if="effectiveShowFooterBar" class="tc-footer" data-testcase-footer>
          <div class="tc-footer-left">
            <span v-if="dirty" class="tc-status-unsaved" data-testcase-status="unsaved">
              ● {{ tr("platform.testcaseUnsavedStatus", "Unsaved changes") }}
            </span>
            <span v-else class="tc-status-saved" data-testcase-status="saved">
              {{ tr("platform.testcaseSavedStatus", "Saved") }}
            </span>
            <span v-if="!hasValidCases" class="tc-footer-validation" role="status" data-testcase-validation>
              {{ tr("platform.testcaseNeedValidCases", "Keep at least one case with a non-empty question") }}
            </span>
            <span v-if="refusal" class="tc-footer-refusal" role="alert" data-testcase-refusal>
              {{ refusal.message }}
            </span>
          </div>

          <div class="tc-footer-right">
            <el-button
              :disabled="!dirty || saving"
              data-testcase-revert
              @click="discard"
            >
              {{ tr("platform.testcaseRevert", "Revert") }}
            </el-button>
            <el-button
              type="primary"
              :loading="saving"
              :disabled="!canSubmit"
              data-testcase-save
              @click="saveFromWorkbench"
            >
              {{ tr("platform.save", "Save") }}
            </el-button>
          </div>
        </footer>
      </div>
    </data-state>
  </div>
</template>

<style scoped>
.sdk-testcase-workbench {
  container: sdk-testcase-workbench / inline-size;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--el-bg-color);
}

.tc-shell {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tc-draft-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: 1px solid var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}

.tc-draft-banner.is-stale {
  border-bottom-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2, var(--el-text-color-primary));
}

.tc-draft-banner-text {
  flex: 1 1 auto;
  min-width: 0;
}

.tc-three-pane {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tc-three-pane.is-dragging,
.tc-three-pane.is-dragging * {
  cursor: col-resize !important;
  user-select: none;
}

.tc-pane-left {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-width: 180px;
  max-width: 560px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.tc-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  flex-shrink: 0;
}

.tc-pane-title {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tc-pane-count {
  font-size: var(--text-xs);
  color: var(--el-text-color-placeholder);
  font-variant-numeric: tabular-nums;
}

.tc-case-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: var(--spacing-xs);
}

.tc-case-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  margin-bottom: 2px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast);
}

.tc-case-item:hover {
  background: var(--ui-fill-tertiary, var(--el-fill-color-light));
}

.tc-case-item.is-active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}

.tc-case-item.has-error {
  border-color: var(--el-color-danger-light-5);
}

.tc-case-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.tc-case-item-question {
  font-size: var(--text-sm);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tc-case-item-id {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--el-text-color-secondary);
}

.tc-case-item-delete {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.tc-case-item:hover .tc-case-item-delete,
.tc-case-item.is-active .tc-case-item-delete,
.tc-case-item-delete:focus-visible {
  opacity: 1;
}

.tc-list-empty {
  margin: var(--spacing-lg) var(--spacing-sm);
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}

.tc-pane-footer {
  flex-shrink: 0;
  padding: var(--spacing-xs);
  border-top: 1px solid var(--ui-divider, var(--el-border-color-lighter));
}

.tc-add-btn {
  width: 100%;
  padding: 6px var(--spacing-sm);
  border: 1px dashed var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--ui-fill-tertiary, var(--el-fill-color-light));
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast), background-color var(--transition-fast);
}

.tc-add-btn:hover:not(:disabled) {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.tc-add-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.tc-resizer {
  position: relative;
  flex: 0 0 8px;
  cursor: col-resize;
  background: transparent;
}

.tc-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--ui-divider, var(--el-border-color));
  transition: background-color var(--transition-fast), width var(--transition-fast);
}

.tc-resizer:hover::after,
.tc-three-pane.is-dragging .tc-resizer::after {
  left: 2px;
  width: 3px;
  background: var(--el-color-primary-light-5);
}

.tc-pane-center {
  flex: 1 1 auto;
  display: flex;
  justify-content: center;
  min-width: 220px;
  overflow-y: auto;
  padding: var(--spacing-xl) var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}

.tc-form-card {
  width: min(760px, 100%);
}

.tc-form-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.tc-section-title {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
  text-transform: none;
}

.tc-section-divider {
  border: none;
  border-top: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  margin: var(--spacing-lg) 0;
}

.tc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tc-field-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.tc-label-main {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--el-text-color-primary);
}

.tc-label-key {
  padding: 1px 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--ui-fill-tertiary, var(--el-fill-color-light));
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.tc-input-short {
  max-width: 200px;
}

.tc-field-mono :deep(.el-textarea__inner) {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.tc-field-error {
  margin: 0;
  color: var(--el-color-danger-text, var(--el-color-danger));
  font-size: var(--text-xs);
}

.tc-empty-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  height: 100%;
  color: var(--el-text-color-secondary);
}

.tc-empty-selection-text {
  margin: 0;
  font-size: var(--text-sm);
}

.tc-pane-right {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-width: 220px;
  max-width: 760px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.tc-json-header {
  gap: var(--spacing-xs);
}

.tc-json-header-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}

.tc-json-invalid-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: var(--radius-full, 999px);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text, var(--el-color-danger));
  font-size: 11px;
  font-weight: var(--font-semibold);
}

.tc-json-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.tc-json-textarea {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  padding: var(--spacing-md);
  border: none;
  outline: none;
  resize: none;
  box-sizing: border-box;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.tc-json-textarea:focus {
  box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
}

.tc-json-textarea.is-invalid {
  box-shadow: inset 0 0 0 1px var(--el-color-danger-light-5);
}

.tc-json-error {
  flex-shrink: 0;
  padding: var(--spacing-xs) var(--spacing-md);
  border-top: 1px solid var(--el-color-danger-light-7);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text, var(--el-color-danger));
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  word-break: break-word;
}

.tc-json-expand-btn {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ui-divider, var(--el-border-color));
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  box-shadow: var(--el-box-shadow-light);
}

.tc-json-expand-btn:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
}

.tc-json-expand-icon {
  font-family: var(--font-mono);
  color: var(--el-color-primary);
}

.tc-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-xs) var(--spacing-md);
  border-top: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  background: var(--el-bg-color);
}

.tc-footer-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  min-width: 0;
  font-size: var(--text-xs);
}

.tc-status-unsaved {
  color: var(--el-color-warning);
  font-weight: var(--font-medium);
}

.tc-status-saved {
  color: var(--el-text-color-secondary);
}

.tc-footer-validation {
  color: var(--el-color-warning-dark-2, var(--el-color-warning));
}

.tc-footer-refusal {
  color: var(--el-color-danger-text, var(--el-color-danger));
}

.tc-footer-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex-shrink: 0;
}

@container sdk-testcase-workbench (max-width: 720px) {
  .tc-three-pane {
    flex-direction: column;
    overflow-y: auto;
  }

  .tc-pane-left,
  .tc-pane-right {
    width: 100% !important;
    max-width: none;
    min-width: 0;
  }

  .tc-resizer {
    display: none;
  }
}
</style>
