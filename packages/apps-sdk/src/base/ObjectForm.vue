<script setup lang="ts">
import { panelSecretValuePresent, splitPanelSecrets } from "@ontomato/contracts/panel-secrets";
import { projectionElement } from "../panel/projection-element";
import { Comment, computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowReactive, shallowRef, useSlots, watch, type VNode } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElForm } from "element-plus/es/components/form/index";
import { confirmDanger } from "@ontomato/platform-shell";
import type { FormFieldRejection, PageActionConfirmedDispatchResult } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { randomId } from "@ontomato/contracts/random-id";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import {
  declaredCustomerFormSaveName,
  panelFormObjectActiveFields,
  pruneInactivePanelFormVariants,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
} from "@ontomato/contracts/panel-projection";
import { slotInputState, usePanelContext, useProjectionForm, useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import type { FormSubmitOverride, InvalidFormText, PanelFormDraft } from "../panel/forms";
import type { PanelFieldValue } from "../panel/state";
import { PlatformObjectRefusal, selectedKey } from "../panel/platform-objects";
import { jsonValuesEqual, movedPath, valueAt, withValueAt, withoutValueAt } from "../panel/form-values";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMember, useMemberOutput } from "../panel/member";
import { missingOperationDescriptorResult } from "../panel/member-operations";
import {
  classifyDispatchResponseForAction,
  classifyDispatchResponseForConfirmation,
  PanelConfirmationDeferred,
  PanelOperationDeferred,
  type PanelAgentActionContext,
} from "../panel/instance";
import {
  createDeferredConfirmation,
  matchesExpectedTarget,
  PanelSubmissionStaleError,
  verifySubmissionUnchanged,
  type SubmissionCheckPhase,
  type SubmissionEvaluator,
} from "../panel/operation-binding";
import {
  applyActionSaveReadOnly,
  editedInput,
  emptyActionSaveWiring,
  formSave,
  formTargetKey,
  isCustomerActionForm,
  memberFormSource,
  MemberDataUnavailable,
  resolveActionSaveWiring,
  resolveFormSaveAnswer,
  type FormSource,
  type FormSaveResult,
} from "../panel/member-forms";
import { formControlsKey } from "./form-controls";
import { formSecretPaths } from "./form-secret-fields";
import FormAdvancedSection from "./FormAdvancedSection.vue";
import FormFieldPlace from "./FormFieldPlace.vue";
import {
  activeFieldAt,
  changedFieldPaths,
  fieldShowing,
  preserveInactiveVariantValues,
  resolveActiveField,
  validateFormFieldValue,
} from "./form-placement";
import { resolveLocalizedText } from "./localized-text";
import {
  formFieldsContextKey,
  type ObjectFormGroup,
  type ObjectFormPresentation,
  type ObjectFormResolvedGroup,
  type ObjectFormSlotScope,
} from "./object-form-types";
import { useDataStateLabels } from "./data-state-labels";

/**
 * One object's form, exactly as its owner describes it: the owner's fields at their JSON Pointer paths, its values in
 * the owner's own shape (nested objects, arrays, `false` and `null` as they are), its read-only rules and its defaults
 * for a new object. When a field the owner marks `refreshOnChange` changes, the owner is asked again and its answer
 * replaces the fields and the values.
 *
 * The form edits the object the panel's state holds for it — the input its `form` datum reads its object from — or, when
 * that state is empty and the projection reads its owner's `createForm`, a new one — whether this reader may create is
 * the owner's to judge when it is saved; the panel then holds the object the owner created. The save is the one operation of its
 * projection the owner describes as a form's save, whatever the projection calls it. A header "new" is an event that empties that state.
 * A field another projection draws (a reference chosen from its own catalogue, a data scope on a graph) is edited there,
 * through this form's field port, and is this form's value and dirty state all the same.
 *
 * An assistant edits this form live through `fill_form` (which calls its editing entry directly, marks the changed
 * fields, and leaves them unsaved) and submits it through `page_action` using the same save entry as the reader.
 *
 * A page that opens the form under a parent (an attribute created in its class, a relationship from its two ends) fixes
 * the fields that parent decides, through `fixedFields`: the form shows each with the page's value, read-only, and
 * includes it in platform form saves. Customer Actions take their values through parameter wiring. One fixed from a
 * state that holds nothing (no parent chosen) is the owner's to edit as usual.
 */
/**
 * What the form tells the page's code, which decides what the page shows next (a form's own buttons do not): the owner
 * saved it — the object it saved, or the one it created — or the reader discarded what it held.
 */
const props = withDefaults(defineProps<{
  /**
   * The fields the page fixes, by the owner's JSON Pointer path: each value comes from a field of the panel's state
   * (`{state}`, the value it holds, or with `path` the part of it that JSON Pointer names, such as an object
   * reference's `/primaryKey`) or is written here (`{literal}`). The form shows them read-only and includes them in
   * platform form saves. Customer Actions take their values through parameter wiring. While the state holds nothing,
   * the field is not fixed.
   */
  fixedFields?: Record<string, { state: string; path?: string } | { literal: RuntimeJsonValue }>;
  /**
   * How top-level fields are arranged: `stacked` (default) draws each field's label above its control; `rows` draws
   * each top-level field as a settings row with its name and help on the left, its control and messages in the middle,
   * and Reset to default on the right when the owner declares a `defaultValue`.
   */
  layout?: "stacked" | "rows";
  /**
   * Where Save, Discard and the unsaved marker live: `footer` (default) keeps them at the foot of the form;
   * `create-only` shows Cancel/Create in create mode and lets the panel wire edit Save/Discard into its own
   * `<page-header>` via `usePanelFormDraft`; `none` hides the form's action bar in both modes.
   */
  actions?: "footer" | "create-only" | "none";
  /**
   * Multi-container field presentation sharing one form state, dirty tracking, validation, and draft:
   * `"default"` renders a flat list (or owner `sections` with a sidebar TOC, or `"cards"` when `groups` is configured);
   * `"cards"` renders each group as a distinct card (optionally in two columns);
   * `"tabs"` renders each group in a tab pane with dirty and error indicators;
   * `"steps"` renders each group as a sequential step with Previous / Next navigation.
   */
  presentation?: ObjectFormPresentation;
  /**
   * Declarative field groups assigning top-level owner field JSON Pointers (`fields`) or owner section keys (`sections`)
   * into cards, tabs, or wizard steps while sharing one form draft.
   */
  groups?: readonly ObjectFormGroup[];
  /** Column count when `presentation` is `"cards"` (`1` or `2`; defaults to `2` when any group uses `column: "side"`). */
  cardColumns?: 1 | 2;
  /** Optional controlled active group key in `"tabs"` or `"steps"` presentation (`v-model:activeGroup`). */
  activeGroup?: string;
  /** Whether readers can jump directly to any step in `"steps"` presentation by clicking its header. Defaults to `true`. */
  allowStepJump?: boolean;
  /**
   * What to do with non-hidden owner fields not listed in `groups`: `"append"` (default) adds a trailing group so no
   * owner field is lost; `"omit"` leaves them out of declarative groups.
   */
  unassignedFields?: "append" | "omit";
}>(), {
  fixedFields: () => ({}),
  layout: "stacked",
  actions: "footer",
  presentation: "default",
  groups: undefined,
  cardColumns: undefined,
  activeGroup: undefined,
  allowStepJump: true,
  unassignedFields: "append",
});
const emit = defineEmits<{
  /** The owner saved the form: the object it saved, or the one it created (primaryKey is null when not reported). */
  saved: [object: { className: string; primaryKey: string | null }];
  /** The reader discarded the changes the form held. */
  discarded: [];
  /** The reader cancelled creating a new object. */
  cancel: [];
  /** Emitted when the active tab or step changes in `"tabs"` or `"steps"` presentation. */
  "update:activeGroup": [groupKey: string];
}>();
interface FormFieldSlotScope {
  readonly field: PanelFormField;
  readonly path: string;
  readonly arrayPath?: string;
  readonly itemPath?: string;
  readonly index?: number;
  readonly value: RuntimeJsonValue | undefined;
  readonly error: string | undefined;
  readonly changed: boolean;
  readonly disabled: boolean;
  readonly set: (value: RuntimeJsonValue) => void;
  readonly remove: () => void;
}

defineSlots<{
  /**
   * Optional custom layout distributing this form's fields into panel-authored cards, tabs, or steps using
   * `<object-form-fields>` while keeping one shared form state, dirty state, validation, and draft.
   */
  default?(scope: ObjectFormSlotScope): unknown;
  /** Extra content rendered after all owner fields and before the action bar. */
  "after-fields"?(): unknown;
  /** Custom renderer for a specific field by dot-path (`#field-skills`, `#field-modelSelection.modelId`, `#field-items.*.skillId`) or JSON Pointer. */
  [key: `field-${string}`]: ((props: FormFieldSlotScope) => unknown) | undefined;
  /** Catch-all custom field renderer; returning empty content falls back to the default control. */
  field?(props: FormFieldSlotScope): unknown;
  /** Catch-all custom renderer for array item fields; returning empty content falls back to `#field` or the default control. */
  "row-field"?(props: FormFieldSlotScope): unknown;
  /** Optional dynamic header/footer slots for declarative groups (`#group-<key>-header`, `#group-<key>-footer`). */
  [name: `group-${string}-header`]: ((props: { group: ObjectFormResolvedGroup }) => unknown) | undefined;
  [name: `group-${string}-footer`]: ((props: { group: ObjectFormResolvedGroup }) => unknown) | undefined;
  /** Custom action bar controls replacing the default Save/Discard/Create/Cancel buttons. */
  actions?(props: {
    saving: boolean;
    asking: boolean;
    dirty: boolean;
    canSettle: boolean;
    isCreate: boolean;
    changedCount: number;
    save: () => Promise<void>;
    discard: () => Promise<boolean>;
    cancel: () => Promise<void>;
  }): unknown;
}>();
const { t, te, locale } = useI18n();
const slots = useSlots();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = projectionElement(slot.projection).id;
const member = useMember();
// The member's form is read by the instance (through this release's resource module in a frame) and saved through its
// owner's operation, received by the platform's coordinator.
const forms: FormSource = memberFormSource(member, panel.instance);

const editInput = editedInput(member.projection);
/** Whether the projection reads the owner's create form, which a create draft is read in. */
const creates = Object.values(member.projection.data).some((data) => data.read === "createForm");
/** The panel state the edited object is held in; a form that only creates or binds no state holds none. */
const state = computed(() => (editInput === undefined ? null : slotInputState(panel.manifest, slot.slot, editInput)));
const requestedKey = computed(() => (
  state.value !== null
    ? selectedKey(panel.instance.state.values.value[state.value])
    : editInput === undefined
      ? null
      : selectedKey(slot.inputs[editInput] as PanelFieldValue | undefined)
));
/**
 * What the form shows: the chosen object, or, with nothing chosen, a new one when the projection reads its owner's create
 * form — an owner declares one only when it creates. This is known from the projection at once, never from an answer
 * still on its way; whether this reader may create is the owner's to judge when the new object is saved.
 */
const requestedTarget = computed<PanelFormTarget | null>(() => {
  if (requestedKey.value) return { kind: "object", objectType, primaryKey: requestedKey.value };
  return creates ? { kind: "draft" } : null;
});
const target = shallowRef(requestedTarget.value);
const key = computed(() => target.value?.kind === "object" ? target.value.primaryKey : null);
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
/** Unique mounted instance ID for this form; rotates on remount, target switch, fixed-field change, or member input change. */
const formInstanceId = ref(randomId());

/** Puts the panel's state where the form shows `next`: an existing object held, or the state emptied for a new one. */
function moveTo(next: PanelFormTarget) {
  if (state.value === null) return;
  panel.instance.state.set(state.value, next.kind === "object" ? { className: objectType, primaryKey: next.primaryKey } : null);
}

/** The owner's description now: its fields, which follow the values the form holds. */
const description = shallowRef<PanelFormDescription | null>(null);
/** The owner's own answers behind `description` and `opened`, which the fixed fields are laid over as they change. */
const ownerShown = shallowRef<PanelFormDescription | null>(null);
const ownerOpened = shallowRef<PanelFormDescription | null>(null);
/** The owner's reading when the form opened: what discard returns to and the revision a save is sent with. */
const opened = shallowRef<PanelFormDescription | null>(null);
const values = shallowRef<PanelFormValues>({});
const changed = shallowRef<ReadonlySet<string>>(new Set());
const errors = shallowRef<Readonly<Record<string, string>>>({});
/** Fields holding text that is not a value of the owner's (JSON that does not parse), by absolute path. */
const invalid = shallowRef<Readonly<Record<string, InvalidFormText>>>({});
const loading = ref(true);
const saving = ref(false);
const failure = shallowRef<{ reason: Error; retry: () => void } | null>(null);
/** The owner's refusal of the last save, shown with the form the reader still holds; its fields' messages on the fields. */
const refusal = shallowRef<Error | null>(null);

for (const [path, from] of Object.entries(props.fixedFields)) {
  if ("state" in from && !(from.state in panel.manifest.state))
    throw new Error(`The fixed field ${path} names the state '${from.state}', which the panel does not declare`);
}
/** The fixed fields' values now, by path: those fixed from a state that holds nothing are not among them. */
const requestedFixedValues = computed<Readonly<Record<string, RuntimeJsonValue>>>(() => Object.fromEntries(Object.entries(props.fixedFields).flatMap(
  ([path, from]): [string, RuntimeJsonValue][] => {
    if ("literal" in from) return [[path, from.literal]];
    const held = (panel.instance.state.values.value[from.state] ?? null) as RuntimeJsonValue;
    if (held === null) return [];
    if (from.path === undefined) return [[path, held]];
    const part = valueAt(held as PanelFormValues, from.path);
    if (part === undefined) throw new Error(`The fixed field ${path} reads ${from.path} of the state '${from.state}', which holds none`);
    return [[path, part]];
  })));
const fixedValues = shallowRef(requestedFixedValues.value);
const inputStateKeys = computed(() => [
  ...(state.value === null ? [] : [state.value]),
  ...Object.values(props.fixedFields).flatMap((from) => "state" in from ? [from.state] : []),
]);
let acceptedState = panel.instance.state.values.value;
// A presentation probe must compare the requested inputs even while the form keeps displaying its accepted draft.
const draftIdentity = () => JSON.stringify([panel.instance.memberPathOf(slot.slot), requestedTarget.value, requestedFixedValues.value]);
/** Localized explanation shown on fields that the form's bound customer save Action does not accept. */
const actionFieldReadOnlyReason = computed(() => (
  te("platform.formFieldNotSavedByAction")
    ? t("platform.formFieldNotSavedByAction")
    : "Not modified by the current save action"
));
const isCustomerForm = isCustomerActionForm(member.projection, objectType);
const admittedSave = computed(() => {
  const currentTarget = target.value;
  return currentTarget ? formSave(member.operations.value, currentTarget, member.projection.operations) : null;
});
const saveUnavailable = computed(() => admittedSave.value === null);

/**
 * Field-level read-only overlay derived from the form's admitted save operation:
 * - Without an admitted save (`admittedSave === null`), every non-hidden field becomes read-only (attaching the
 *   Action reason only for customer Action forms, never misleadingly for platform `form.save` forms).
 * - With an admitted customer Action save, only unwired fields become read-only with the Action reason.
 * - With an admitted platform `form.save`, only `fixedFields` and owner-declared read-only rules apply.
 */
const actionSaveReadOnlyOverlay = computed<{ wiredPaths: ReadonlySet<string>; readOnlyReason?: string } | null>(() => {
  const save = admittedSave.value;
  if (!save) {
    return {
      wiredPaths: emptyActionSaveWiring().wiredPaths,
      ...(isCustomerForm ? { readOnlyReason: actionFieldReadOnlyReason.value } : {}),
    };
  }
  const wiring = resolveActionSaveWiring(save.descriptor, member.projection.operations?.[save.name]);
  return wiring ? { wiredPaths: wiring.wiredPaths, readOnlyReason: actionFieldReadOnlyReason.value } : null;
});

/** Whether a path is a fixed field or inside one. */
const isFixed = (path: string) => Object.keys(fixedValues.value).some((fixed) => path === fixed || path.startsWith(`${fixed}/`));
/** Values with the fixed fields as the page fixes them. */
function fixValues(next: PanelFormValues): PanelFormValues {
  return Object.entries(fixedValues.value).reduce((all, [path, value]) => withValueAt(all, path, value) as PanelFormValues, next);
}
/** An owner's description with fixed fields and save-permission / Action-wiring read-only overlays applied. */
function fixDescription(next: PanelFormDescription): PanelFormDescription {
  const withFixed = next.fields.map((field) => (field.path in fixedValues.value ? { ...field, readOnly: true } : field));
  const overlay = actionSaveReadOnlyOverlay.value;
  const effectiveFields = overlay === null
    ? withFixed
    : applyActionSaveReadOnly(withFixed, overlay.wiredPaths, overlay.readOnlyReason);
  return {
    ...next,
    fields: effectiveFields,
    values: fixValues(next.values),
  };
}

const fields = computed(() => description.value?.fields ?? []);
/**
 * The fields this form draws, in its owner's order: all but a hidden one, which no control draws. One a projection of the
 * panel is declared for is drawn by that projection in the field's place; a reference no projection draws says it
 * cannot be edited here — never left out without a word.
 */
const drawn = computed(() => fields.value.filter((field) => field.control.kind !== "hidden"));
/** Of those, the owner's advanced ones, drawn after the others in one section. */
const advanced = computed(() => drawn.value.filter((field) => field.advanced === true));
const plain = computed(() => drawn.value.filter((field) => field.advanced !== true));
/**
 * The owner's sections with the fields that name them, in its order (原页面对照《智能体设置》): fields that name no
 * section come first, untitled. A field naming a section its owner does not declare is the owner's mistake, said here.
 * Null for a form without sections, drawn as one list.
 */
const sectionGroups = computed(() => {
  const declared = description.value?.sections ?? [];
  if (!declared.length) return null;
  const keys = new Set(declared.map(({ key }) => key));
  const stray = drawn.value.find((field) => field.section !== undefined && !keys.has(field.section));
  if (stray) throw new Error(`The form's field ${stray.path} names a section '${stray.section}' its owner does not declare`);
  const group = (fields: readonly PanelFormField[]) => ({
    plain: fields.filter((field) => field.advanced !== true),
    advanced: fields.filter((field) => field.advanced === true),
    changed: fields.some((field) => changed.value.has(field.path)),
  });
  const loose = drawn.value.filter((field) => field.section === undefined);
  return [
    ...(loose.length ? [{ key: "", title: null, hint: null, ...group(loose) }] : []),
    ...declared.map((section) => ({ ...section, hint: section.hint ?? null, ...group(drawn.value.filter((field) => field.section === section.key)) })),
  ];
});
function goToSection(key: string) {
  formElement.value!.querySelector<HTMLElement>(`[data-form-section="${CSS.escape(key)}"]`)!.scrollIntoView({ behavior: "smooth", block: "start" });
}
/** Local edit values with inactive object-variant keys pruned, matching what a save sends to the owner. */
const prunedValues = computed(() => pruneInactivePanelFormVariants(fields.value, values.value));
/** Opened baseline values pruned by the same variant rules so dirty/change checks ignore inactive variant leftovers. */
const prunedOpenedValues = computed(() => (
  opened.value ? pruneInactivePanelFormVariants(opened.value.fields, opened.value.values) : null
));
/** Unparseable local text limited to currently active fields, so an inactive variant never blocks saving the active one. */
const activeInvalid = computed<Readonly<Record<string, string>>>(() => {
  if (!Object.keys(invalid.value).length) return {};
  return Object.fromEntries(
    Object.entries(invalid.value).flatMap(([path, { message }]) =>
      activeFieldAt(fields.value, values.value, path) === undefined ? [] : [[path, message]]),
  );
});
/** Top-level fields whose effective (pruned) values differ from the opened baseline. */
const effectiveChangedPaths = computed<ReadonlySet<string>>(() => (
  prunedOpenedValues.value
    ? changedFieldPaths(fields.value, prunedOpenedValues.value, prunedValues.value)
    : new Set()
));
/** Changed effective values, or unparseable text in an active field: either is unsaved. */
const dirty = computed(() => prunedOpenedValues.value !== null
  && (!jsonValuesEqual(prunedValues.value, prunedOpenedValues.value) || Object.keys(activeInvalid.value).length > 0));
/**
 * The described fields this edit submits, by path: those the reader set (whatever value they end on) and those a received
 * draft wrote. The owner keeps a field not named here as it is, so a field nobody touched is never added. Whether a
 * value ended where it began does not matter: a field set back to the value shown is still submitted, and can be saved.
 */
const submitted = shallowRef<ReadonlySet<string>>(new Set());
/** Exact field JSON Pointers edited by the reader (including nested paths set or removed), kept off the `form.save` wire. */
const editedPaths = shallowRef<ReadonlySet<string>>(new Set());
/** Field JSON Pointers explicitly edited by the human user (separate from fields filled by the agent in this session). */
const userEditedPaths = shallowRef<ReadonlySet<string>>(new Set());
/** Field JSON Pointers filled by the agent; subsequent agent fills can refine these without triggering `blocked_unsaved`. */
const agentFilledPaths = shallowRef<ReadonlySet<string>>(new Set());
/** Monotonic edit counter incremented on every value edit, invalid text change, baseline adoption, or fixed-field change. */
let editGeneration = 0;

function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
/** Whether the form has something to save or discard: changed values or fields set on purpose. */
const canSettle = computed(() => dirty.value || submitted.value.size > 0);
/** Whether the form is creating a new object (`createForm`, no existing object selected). */
const isCreate = computed(() => target.value?.kind === "draft");
/** Whether every non-hidden field in the owner's form description is read-only. */
const allReadOnly = computed(() => drawn.value.length > 0 && drawn.value.every((field) => field.readOnly));
/**
 * Distinct top-level field paths modified in this draft (union of draft-marked `changed`, effective pruned diffs,
 * and active unparseable `invalid` fields, falling back to explicitly `submitted` fields).
 */
const dirtyFields = computed<ReadonlySet<string>>(() => {
  const paths = new Set<string>([...changed.value, ...effectiveChangedPaths.value]);
  for (const path of Object.keys(activeInvalid.value)) {
    const described = fields.value.find((item) => path === item.path || path.startsWith(`${item.path}/`));
    paths.add(described ? described.path : path);
  }
  if (paths.size === 0) {
    for (const path of submitted.value) paths.add(path);
  }
  return paths;
});
/** Count of distinct top-level fields modified in this draft, guaranteed >= 1 whenever `canSettle` is true. */
const changedCount = computed(() => (dirtyFields.value.size > 0 ? dirtyFields.value.size : (canSettle.value ? 1 : 0)));
/** Whether the form is ready and currently able to submit unsaved edits. */
const canSubmit = computed(() =>
  !failure.value && !loading.value && description.value !== null && canSettle.value && !saving.value && !asking.value && !saveUnavailable.value,
);

/** Whether this form component has mounted and performed its initial load. */
let mounted = false;

/** The owner's field errors, by the field each names. */
const fieldMessages = (list: readonly { field: string; message: string }[]) =>
  Object.fromEntries(list.map(({ field, message }) => [field, message]));

function adopt(
  baseline: PanelFormDescription,
  shown: PanelFormDescription = baseline,
  marked: ReadonlySet<string> = new Set(),
  written: ReadonlySet<string> = new Set(),
) {
  submitted.value = written;
  editedPaths.value = new Set();
  userEditedPaths.value = new Set();
  agentFilledPaths.value = new Set();
  editGeneration += 1;
  ownerOpened.value = baseline;
  ownerShown.value = shown;
  opened.value = fixDescription(baseline);
  description.value = fixDescription(shown);
  values.value = description.value.values;
  changed.value = marked;
  refusal.value = null;
  // The owner's verdict on the values it returned: a field it does not accept says why, on that field.
  errors.value = fieldMessages(shown.errors);
  invalid.value = {};
  failure.value = null;
  loading.value = false;
}

/**
 * The latest read of the form — its first, one for another target, or a refresh of the same object. Only the latest
 * read's answer is applied: an earlier one that comes back after it (the first read, answered after a refresh that
 * came in while it was on its way) would put back what a reader has typed since.
 */
let latestRead = 0;

function restoreDraft(draft: PanelFormDraft) {
  adopt(draft.ownerOpened, draft.ownerShown, draft.changed, draft.submitted);
  values.value = draft.values;
  invalid.value = draft.invalid;
  errors.value = draft.errors;
  refusal.value = draft.refusal;
  editedPaths.value = draft.editedPaths;
  userEditedPaths.value = draft.userEditedPaths;
  agentFilledPaths.value = draft.agentFilledPaths;
}

async function describeBaseline(next: PanelFormTarget, reading: number) {
  let current = await forms.describe({ target: next, changedField: null });
  if (reading !== latestRead) return current;

  const fixed = fixValues(current.values);
  const refresh = Object.entries(fixedValues.value).filter(([path, value]) =>
    !jsonValuesEqual(value, valueAt(current.values, path)) && activeFieldAt(current.fields, fixed, path)?.refreshOnChange,
  );
  for (const [path] of refresh) {
    current = await forms.describe({ target: next, values: fixValues(current.values), changedField: path });
    if (reading !== latestRead) break;
  }
  return current;
}

function load(next: PanelFormTarget | null) {
  const reading = ++latestRead;
  failure.value = null;
  latestAsk += 1;
  askNext = null;
  asking.value = false;
  flushOwnerAskWaiters();
  const rollback = panel.instance.forms.takeRollback(draftIdentity());
  if (rollback) {
    restoreDraft(rollback);
    return;
  }
  if (next === null) {
    description.value = opened.value = ownerShown.value = ownerOpened.value = null;
    values.value = {};
    loading.value = false;
    return;
  }
  description.value = opened.value = ownerShown.value = ownerOpened.value = null;
  values.value = {};
  loading.value = true;
  void describeBaseline(next, reading).then(
    (answer) => { if (reading === latestRead) adopt(answer); },
    (reason: unknown) => { if (reading === latestRead) fail(reason, () => load(next)); },
  );
}

function fail(reason: unknown, retry: () => void) {
  failure.value = { reason: reason instanceof Error ? reason : new Error(String(reason)), retry };
  loading.value = false;
}

let unmounted = false;
onMounted(() => {
  mounted = true;
  load(target.value);
});
onBeforeUnmount(() => {
  unmounted = true;
  latestRead += 1;
  askNext = null;
  unregisterDiscard?.();
  unregisterReset?.();
  unregisterSave?.();
});

function activeUserEditedPaths(): string[] {
  const invalidPaths = Object.keys(activeInvalid.value);
  return [...userEditedPaths.value].filter((userPath) =>
    invalidPaths.some((invalidPath) => pathsOverlap(invalidPath, userPath))
    || (prunedOpenedValues.value !== null
      && !jsonValuesEqual(valueAt(prunedValues.value, userPath), valueAt(prunedOpenedValues.value, userPath))),
  );
}

async function handleDiscardAction(
  operationName: "discard" | "reset",
  request: {
    readonly expectedTarget?: import("@ontomato/contracts/agent-presentation").ExpectedPageTarget;
    readonly agentContext?: PanelAgentActionContext;
  },
) {
  if (request.expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, request.expectedTarget)) {
    return { ok: false as const, reason: "stale" as const, message: "The form switched to a different target object or draft." };
  }
  if (!mounted || unmounted || panel.instance.isDisposed() || !opened.value || loading.value || saving.value || asking.value) {
    return { ok: false as const, reason: "action_not_ready" as const, message: `The form is not ready to ${operationName}.` };
  }
  if (!canSettle.value) {
    return { ok: false as const, reason: "action_unavailable" as const, message: `The form has no unsaved changes to ${operationName}.` };
  }
  if (!request.agentContext) {
    discard();
    return { ok: true as const, outcome: { discarded: true } };
  }
  if (!panel.instance.requestLocalConfirmation) {
    return {
      ok: false as const,
      reason: "action_unavailable" as const,
      message: "Conversation confirmation is unavailable for discarding unsaved edits.",
    };
  }
  const evaluateDiscardSubmission: SubmissionEvaluator = (phase) => {
    if (unmounted || !mounted || panel.instance.isDisposed()) {
      return { ok: false, message: "The form was closed or unmounted." };
    }
    if (formContextChanged()) {
      return { ok: false, message: "The form target or fixed values changed." };
    }
    if (!target.value || !opened.value || loading.value || asking.value || failure.value) {
      return { ok: false, message: "The form is no longer ready." };
    }
    if (phase === "confirm" && saving.value) {
      return { ok: false, message: "The form is currently saving." };
    }
    if (!canSettle.value) {
      return { ok: false, message: "The form no longer has unsaved changes." };
    }
    return {
      ok: true,
      instanceId: panel.instance.instanceId,
      operationId: panel.instance.operationIdOf(slot.slot, operationName),
      target: effectiveTarget.value,
      payload: {
        formInstanceId: formInstanceId.value,
        values: prunedValues.value,
        baseline: ownerOpened.value?.values ?? null,
        changed: [...changed.value].sort(),
        edited: [...editedPaths.value].sort(),
        activeInvalid: activeInvalid.value,
        editGeneration,
      },
    };
  };
  const frozen = evaluateDiscardSubmission("prepare");
  if (!frozen.ok) {
    return { ok: false as const, reason: "stale" as const, message: frozen.message };
  }
  const currentTarget = target.value!;
  const targetLabel = currentTarget.kind === "object"
    ? panel.instance.objectName(currentTarget.objectType, currentTarget.primaryKey) ?? currentTarget.primaryKey
    : objectType;
  const hasHumanUnsavedEdits = activeUserEditedPaths().length > 0;
  const created = await panel.instance.requestLocalConfirmation({
    agentRun: request.agentContext.agentRun,
    operationLabel: t("platform.discard"),
    targetLabel,
    impactSummary: t("platform.formDiscardConfirm"),
    ...(hasHumanUnsavedEdits ? { requireConfirmation: true } : {}),
  });
  const preCheck = verifySubmissionUnchanged(frozen, evaluateDiscardSubmission, "auto-dispatch");
  if (!preCheck.ok) {
    if (created.questionId) {
      await panel.instance.cancelLocalConfirmation?.(created.questionId, {
        code: "FORM_CONFIRMATION_STALE",
        message: preCheck.message,
      }).catch(() => undefined);
    }
    return { ok: false as const, reason: "stale" as const, message: preCheck.message };
  }
  if (created.autoMode === true) {
    discard();
    return { ok: true as const, outcome: { discarded: true } };
  }
  const questionId = created.questionId;
  if (questionId === null) throw new Error("Discard confirmation did not return a question ID.");
  const confirmation = createDeferredConfirmation({
    intentId: created.intentId,
    questionId,
    operationId: frozen.operationId,
    label: created.label,
    staleCode: "FORM_CONFIRMATION_STALE",
    isStillValid: () => verifySubmissionUnchanged(frozen, evaluateDiscardSubmission, "confirm"),
    cancel: async (reason) => {
      await panel.instance.cancelLocalConfirmation?.(questionId, reason).catch(() => undefined);
    },
    async dispatchVerified(): Promise<PageActionConfirmedDispatchResult> {
      if (panel.instance.claimLocalConfirmation) {
        const claimed = await panel.instance.claimLocalConfirmation(questionId);
        if (!claimed.ok) {
          return {
            ok: false,
            intentId: created.intentId,
            reason: "stale",
            message: claimed.message ?? "This discard confirmation was already answered or cancelled.",
          };
        }
        const postClaimCheck = verifySubmissionUnchanged(frozen, evaluateDiscardSubmission, "confirm");
        if (!postClaimCheck.ok) {
          return {
            ok: false,
            intentId: created.intentId,
            reason: "stale",
            message: postClaimCheck.message,
          };
        }
      }
      discard();
      return {
        ok: true,
        intentId: created.intentId,
        outcome: { discarded: true },
        summary: t("platform.discard"),
      };
    },
  });
  return { ok: true as const, confirmation };
}

const unregisterDiscard = panel.instance.registerActionHandler(
  panel.instance.operationIdOf(slot.slot, "discard"),
  (request) => handleDiscardAction("discard", request),
  { entryInstanceId: () => formInstanceId.value },
);
const unregisterReset = panel.instance.registerActionHandler(
  panel.instance.operationIdOf(slot.slot, "reset"),
  (request) => handleDiscardAction("reset", request),
  { entryInstanceId: () => formInstanceId.value },
);
const saveOperationName = computed<string | null>(() => {
  if (admittedSave.value) return admittedSave.value.name;
  if (isCustomerForm) {
    return declaredCustomerFormSaveName(member.projection.operations, isCreate.value) ?? null;
  }
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
        return { ok: false, reason: "stale", message: "The form switched to a different target object or draft." };
      }
      if (!mounted || unmounted || panel.instance.isDisposed() || !target.value || !opened.value || loading.value || asking.value) {
        return { ok: false, reason: "action_not_ready", message: "The form is not ready to save." };
      }
      if (failure.value) {
        return { ok: false, reason: "failed", message: failure.value.reason.message };
      }
      if (saving.value) {
        return { ok: false, reason: "action_unavailable", message: "The form is currently saving." };
      }
      if (!admittedSave.value) {
        return missingOperationDescriptorResult(member.operations.value, name);
      }
      if (!isCreate.value && !canSettle.value) {
        return { ok: false, reason: "action_unavailable", message: "The form has no unsaved changes to save." };
      }
      if (Object.keys(activeInvalid.value).length > 0) {
        return { ok: false, reason: "validation_failed", message: t("platform.formFixInvalid") };
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
let pendingRefresh = false;
let confirmingSwitch = false;
const memberInputKey = computed(() => JSON.stringify(member.inputs.value));
let acceptedMemberInputKey = memberInputKey.value;
function formContextChanged() {
  return requestedTarget.value?.kind !== target.value?.kind
    || targetKey(requestedTarget.value) !== targetKey(target.value)
    || !jsonValuesEqual(requestedFixedValues.value, fixedValues.value);
}
/**
 * The target and the fixed values together identify what the reader is editing. Keep the accepted inputs until any
 * pending confirmation settles, including when one panel state change derives another.
 */
watch([requestedTarget, requestedFixedValues, memberInputKey], async () => {
  if (confirmingSwitch) return;
  if (!formContextChanged()) {
    acceptedState = panel.instance.state.values.value;
    if (memberInputKey.value !== acceptedMemberInputKey) {
      acceptedMemberInputKey = memberInputKey.value;
      formInstanceId.value = randomId();
      editGeneration += 1;
    }
    return;
  }
  const probing = panel.instance.forms.probing;
  if (probing && dirty.value) return;
  const shouldDiscard = !probing && canSettle.value && !saving.value;
  if (shouldDiscard) {
    confirmingSwitch = true;
    let leave: boolean;
    try {
      leave = panel.confirmLeaveUnsaved
        ? await panel.confirmLeaveUnsaved()
        : await confirmDanger(t("platform.formLeaveUnsaved"), t("platform.unsavedChanges"), {
            confirmButtonText: t("platform.discard"),
            cancelButtonText: t("platform.keepEditing"),
          });
    } finally {
      confirmingSwitch = false;
    }
    if (unmounted || !formContextChanged()) return;
    if (!leave) {
      const current = panel.instance.state.values.value;
      panel.instance.state.setState(Object.fromEntries(inputStateKeys.value.flatMap((name) =>
        jsonValuesEqual(current[name], acceptedState[name]) ? [] : [[name, acceptedState[name]!]],
      )));
      return;
    }
  }
  pendingRefresh = false;
  if (shouldDiscard) discard(false);
  acceptedState = panel.instance.state.values.value;
  acceptedMemberInputKey = memberInputKey.value;
  target.value = requestedTarget.value;
  fixedValues.value = requestedFixedValues.value;
  formInstanceId.value = randomId();
  editGeneration += 1;
  load(target.value);
});
function refreshWhenClean() {
  if (!pendingRefresh || canSettle.value || saving.value) return;
  pendingRefresh = false;
  reread();
}

/**
 * Reads the object the form shows again, in place: the fields, the focus and the caret stay where they are while the
 * read is on its way, and its answer replaces the values only if the form is still clean when it comes back. A reader
 * who changed anything meanwhile keeps their edit; the read waits, pending, until the form is saved or discarded.
 */
function reread() {
  const current = target.value;
  if (current === null || !description.value) return load(current);
  const reading = ++latestRead;
  failure.value = null;
  void describeBaseline(current, reading).then(
    (answer) => {
      if (reading !== latestRead) return;
      if (canSettle.value || saving.value) {
        pendingRefresh = true;
        return;
      }
      adopt(answer);
    },
    (reason: unknown) => {
      if (reading !== latestRead) return;
      if (canSettle.value || saving.value) {
        pendingRefresh = true;
        return;
      }
      fail(reason, reread);
    },
  );
}
onBeforeUnmount(panel.instance.onOperationCompleted(async ({ operation }) => {
  const into = target.value;
  if (!into || !canSettle.value || saving.value) return;
  const save = admittedSave.value;
  if (!save || panel.instance.operationIdOf(slot.slot, save.name) !== operation.operationId) return;
  if (into.kind === "object" && (!operation.target || targetKey(into) !== targetKey({ kind: "object", ...operation.target }))) return;
  if (into.kind === "draft" && operation.target) return;
  const created = operation.created;
  await settleSave(into, prunedValues.value)({
    primaryKey: into.kind === "object"
      ? into.primaryKey
      : created?.objectType === objectType ? created.primaryKey : null,
    message: operation.message,
  });
}));

useProjectionObjectRefresh((id) => id === key.value, () => {
  pendingRefresh = true;
  refreshWhenClean();
});
watch([canSettle, saving], refreshWhenClean);

watch(actionSaveReadOnlyOverlay, () => {
  if (!ownerOpened.value || !ownerShown.value) return;
  opened.value = fixDescription(ownerOpened.value);
  description.value = fixDescription(ownerShown.value);
});

/** One field changed: the form holds the value; a field the owner's form depends on has the owner asked again. */
function set(path: string, value: RuntimeJsonValue) {
  edit(path, withValueAt(values.value, path, value), "user");
}
function remove(path: string) {
  edit(path, withoutValueAt(values.value, path), "user");
}

/** The reader's edit of one field, as the values it leaves: submitted, and the owner asked again where it says so. */
function edit(path: string, next: PanelFormValues, source: "user" | "agent" = "user") {
  if (isFixed(path)) throw new Error(`The page fixes the field ${path}; it is not edited in the form`);
  // The described field the edit is in: a row's or an object's field submits the array or object it belongs to.
  const described = fields.value.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (described) submitted.value = new Set([...submitted.value, described.path]);
  editedPaths.value = new Set([...editedPaths.value, path]);
  if (source === "user") {
    userEditedPaths.value = new Set([...userEditedPaths.value, path]);
    agentFilledPaths.value = new Set([...agentFilledPaths.value].filter((existing) => !pathsOverlap(existing, path)));
  } else {
    agentFilledPaths.value = new Set([...agentFilledPaths.value, path]);
    userEditedPaths.value = new Set([...userEditedPaths.value].filter((existing) => !pathsOverlap(existing, path)));
  }
  editGeneration += 1;
  values.value = next;
  editedAt.set(path, ++edits);
  const field = activeFieldAt(fields.value, next, path);
  if (field?.refreshOnChange) askOwner(path);
}

/** How many edits the reader has made, and when each path was last edited, counted in them. */
let edits = 0;
const editedAt = new Map<string, number>();
/** A question to the owner on its way, and the field changed since that the next question is about. */
const asking = ref(false);
let latestAsk = 0;
let askNext: string | null = null;
let askSettledResolvers: (() => void)[] = [];
function waitForOwnerAsk(): Promise<void> {
  if (!asking.value && askNext === null) return Promise.resolve();
  return new Promise((resolve) => {
    askSettledResolvers.push(resolve);
  });
}
function flushOwnerAskWaiters() {
  if (asking.value || askNext !== null || !askSettledResolvers.length) return;
  const waiters = askSettledResolvers;
  askSettledResolvers = [];
  for (const resolve of waiters) resolve();
}
/**
 * Asks the owner for its form again for the values as they are now, `changedField` the field that set it off. One
 * question at a time: edits made while one is on its way wait for its answer and set off one more, for the values then.
 * An answer is for the values it was asked with, so what the reader edited after asking stays as they left it.
 */
function askOwner(changedField: string) {
  if (asking.value) {
    askNext = changedField;
    return;
  }
  asking.value = true;
  const ask = ++latestAsk;
  failure.value = null;
  const asked = target.value!;
  const askedAt = edits;
  const reading = latestRead;
  // The owner changes the fields for these edits; the opened reading, its revision and the discard baseline stay.
  void forms.describe({
    target: asked,
    values: pruneInactivePanelFormVariants(fields.value, values.value),
    changedField,
  }).then((answer) => {
    if (reading !== latestRead) return;
    const localDraft = values.value;
    ownerShown.value = answer;
    description.value = fixDescription(answer);
    const replayed = [...editedAt].filter(([, at]) => at > askedAt).reduce((all, [edited]) => {
      const kept = valueAt(localDraft, edited);
      return kept === undefined ? withoutValueAt(all, edited) : withValueAt(all, edited, kept);
    }, description.value.values);
    values.value = preserveInactiveVariantValues(description.value.fields, localDraft, replayed);
    errors.value = fieldMessages(answer.errors);
  }, (reason) => {
    if (reading === latestRead) fail(reason, () => askOwner(changedField));
  }).finally(() => {
    if (ask !== latestAsk) return;
    asking.value = false;
    const again = askNext;
    askNext = null;
    if (again !== null) askOwner(again);
    else flushOwnerAskWaiters();
  });
}

/**
 * Rearranges the rows of an array field, `order[next] = previous`: the values, and the messages and marks inside each
 * row, which follow the row to its new index (one inside a removed row goes with it).
 */
function reorder(path: string, order: readonly number[]) {
  const rows = valueAt(values.value, path) as RuntimeJsonValue[];
  const moved = <T,>(byPath: Readonly<Record<string, T>>) => Object.fromEntries(Object.entries(byPath).flatMap(([at, message]) => {
    const next = movedPath(at, path, order);
    return next === null ? [] : [[next, message]];
  }));
  errors.value = moved(errors.value);
  invalid.value = moved(invalid.value);
  changed.value = new Set([...changed.value].flatMap((at) => movedPath(at, path, order) ?? []));
  set(path, order.map((index) => rows[index]!));
}

function markInvalid(path: string, text: InvalidFormText | null) {
  editGeneration += 1;
  if (text === null) {
    invalid.value = Object.fromEntries(
      Object.entries(invalid.value).filter(([at]) => at !== path && !at.startsWith(`${path}/`)),
    );
    return;
  }
  userEditedPaths.value = new Set([...userEditedPaths.value, path]);
  invalid.value = { ...invalid.value, [path]: text };
}

/**
 * A read-only reason the owner gives more than one field (a function an action uses: every field) is the form's to say,
 * once above its fields; a field says only a reason of its own.
 */
const sharedReadOnlyReasons = computed<ReadonlySet<string>>(() => {
  const counts = new Map<string, number>();
  const visit = (list: readonly PanelFormField[], node: RuntimeJsonValue | undefined) => {
    const objectNode = node !== null && typeof node === "object" && !Array.isArray(node) ? node as PanelFormValues : undefined;
    for (const field of list) {
      if (field.readOnly && field.readOnlyReason) counts.set(field.readOnlyReason, (counts.get(field.readOnlyReason) ?? 0) + 1);
      const current = objectNode ? valueAt(objectNode, field.path) : undefined;
      if (field.control.kind === "object") visit(panelFormObjectActiveFields(field.control, current), current);
      if (field.control.kind === "object-array") visit(field.control.itemFields, Array.isArray(current) ? current[0] : undefined);
    }
  };
  visit(fields.value, values.value);
  return new Set([...counts].filter(([, count]) => count > 1).map(([reason]) => reason));
});

const allErrors = computed<Readonly<Record<string, string>>>(() => ({ ...errors.value, ...activeInvalid.value }));

function errorCountForPaths(paths: ReadonlySet<string>): number {
  let count = 0;
  for (const errorPath of Object.keys(allErrors.value)) {
    for (const fieldPath of paths) {
      if (errorPath === fieldPath || errorPath.startsWith(`${fieldPath}/`)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

const effectivePresentation = computed<ObjectFormPresentation>(() => {
  if (props.presentation !== "default") return props.presentation;
  return props.groups && props.groups.length > 0 ? "cards" : "default";
});

const resolvedGroups = computed<readonly ObjectFormResolvedGroup[]>(() => {
  const build = (
    key: string,
    title: string | null,
    hint: string | null,
    column: "main" | "side" | "full",
    groupFields: readonly PanelFormField[],
  ): ObjectFormResolvedGroup => {
    const pathSet = new Set(groupFields.map((field) => field.path));
    return {
      key,
      title,
      description: hint,
      column,
      fields: groupFields,
      plain: groupFields.filter((field) => field.advanced !== true),
      advanced: groupFields.filter((field) => field.advanced === true),
      changed: groupFields.some((field) => changed.value.has(field.path)),
      dirty: groupFields.some((field) => dirtyFields.value.has(field.path)),
      errorCount: errorCountForPaths(pathSet),
    };
  };

  if (props.groups && props.groups.length > 0) {
    const byPath = new Map(drawn.value.map((field) => [field.path, field]));
    const assigned = new Set<string>();
    const list: ObjectFormResolvedGroup[] = [];
    for (const group of props.groups) {
      const groupFields: PanelFormField[] = [];
      for (const path of group.fields ?? []) {
        const matched = byPath.get(path);
        if (matched && !assigned.has(matched.path)) {
          assigned.add(matched.path);
          groupFields.push(matched);
        }
      }
      if (group.sections && group.sections.length > 0) {
        const sectionKeys = new Set(group.sections);
        for (const field of drawn.value) {
          if (field.section && sectionKeys.has(field.section) && !assigned.has(field.path)) {
            assigned.add(field.path);
            groupFields.push(field);
          }
        }
      }
      const title = resolveLocalizedText({
        key: group.titleKey,
        map: group.titles,
        fallback: group.title,
        locale: locale.value,
        panelText: panel.t,
        t,
        te,
      }) || null;
      const hint = resolveLocalizedText({
        key: group.descriptionKey,
        map: group.descriptions,
        fallback: group.description,
        locale: locale.value,
        panelText: panel.t,
        t,
        te,
      }) || null;
      list.push(build(group.key, title, hint, group.column ?? "main", groupFields));
    }
    if (props.unassignedFields !== "omit") {
      const remaining = drawn.value.filter((field) => !assigned.has(field.path));
      if (remaining.length > 0) {
        const otherTitle = te("platform.formOtherFields") ? t("platform.formOtherFields") : "Other";
        list.push(build("__other", otherTitle, null, "full", remaining));
      }
    }
    return list;
  }

  if (sectionGroups.value) {
    return sectionGroups.value.map((group) =>
      build(
        group.key || "__general",
        group.title,
        group.hint,
        "main",
        [...group.plain, ...group.advanced],
      ),
    );
  }

  if (effectivePresentation.value !== "default" && drawn.value.length > 0) {
    return [build("__default", null, null, "main", drawn.value)];
  }
  return [];
});

const internalActiveGroup = ref<string | null>(null);
const activeGroupKey = computed<string | null>(() => {
  const groups = resolvedGroups.value;
  if (!groups.length) return null;
  if (props.activeGroup !== undefined && groups.some((group) => group.key === props.activeGroup)) {
    return props.activeGroup;
  }
  if (internalActiveGroup.value !== null && groups.some((group) => group.key === internalActiveGroup.value)) {
    return internalActiveGroup.value;
  }
  return groups[0]!.key;
});

function setActiveGroup(key: string) {
  if (!resolvedGroups.value.some((group) => group.key === key)) return;
  internalActiveGroup.value = key;
  emit("update:activeGroup", key);
}

const activeGroupIndex = computed(() =>
  resolvedGroups.value.findIndex((group) => group.key === activeGroupKey.value),
);
const activeGroupObject = computed(() =>
  activeGroupIndex.value >= 0 ? resolvedGroups.value[activeGroupIndex.value]! : null,
);

function goPrevStep() {
  if (activeGroupIndex.value > 0) {
    setActiveGroup(resolvedGroups.value[activeGroupIndex.value - 1]!.key);
  }
}

function goNextStep() {
  if (activeGroupIndex.value >= 0 && activeGroupIndex.value < resolvedGroups.value.length - 1) {
    setActiveGroup(resolvedGroups.value[activeGroupIndex.value + 1]!.key);
  }
}

const hasSplitColumns = computed(() =>
  resolvedGroups.value.some((group) => group.column === "side"),
);
const effectiveCardColumns = computed<1 | 2>(() => {
  if (props.cardColumns !== undefined) return props.cardColumns;
  return hasSplitColumns.value ? 2 : 1;
});
const splitMainGroups = computed(() => resolvedGroups.value.filter((group) => group.column === "main"));
const splitSideGroups = computed(() => resolvedGroups.value.filter((group) => group.column === "side"));
const splitFullGroups = computed(() => resolvedGroups.value.filter((group) => group.column === "full"));

const fieldSliceClaims = shallowReactive(new Map<symbol, ReadonlySet<string>>());
const claimedPaths = computed<ReadonlySet<string>>(() => {
  const merged = new Set<string>();
  for (const set of fieldSliceClaims.values()) {
    for (const path of set) merged.add(path);
  }
  return merged;
});

provide(formFieldsContextKey, {
  drawn,
  groups: resolvedGroups,
  registerClaim(token, paths) {
    fieldSliceClaims.set(token, paths);
  },
  unregisterClaim(token) {
    fieldSliceClaims.delete(token);
  },
  claimedPaths,
});

const topLevelPaths = computed(() => new Set(fields.value.map((field) => field.path)));
const hasDefaults = computed(() => fields.value.some((field) => field.control.kind !== "hidden" && field.defaultValue !== undefined));

function hasRenderedNodes(nodes: VNode[]): boolean {
  return nodes.some((node) => node.type !== Comment);
}

provide(formControlsKey, {
  formSlot: slot.slot,
  values,
  prunedValues,
  errors: allErrors,
  changed,
  busy: saving,
  layout: computed(() => props.layout),
  hasDefaults,
  sharedReadOnlyReasons,
  isTopLevel: (path) => topLevelPaths.value.has(path),
  hasInvalid: (path) => Object.keys(activeInvalid.value).some((at) => at === path || at.startsWith(`${path}/`)),
  invalidText: (path) => invalid.value[path]?.source,
  set,
  remove,
  reorder,
  invalid: markInvalid,
  resolveFieldSlot(field, absolutePath, arrayPath, index) {
    const pointerToDot = (pointer: string) => pointer.replace(/^\/+/u, "").replaceAll("/", ".");
    const dotName = arrayPath !== undefined
      ? `field-${pointerToDot(arrayPath)}.*.${pointerToDot(field.path)}`
      : `field-${pointerToDot(absolutePath)}`;
    const rawName = arrayPath !== undefined
      ? `field-${arrayPath}/*${field.path}`
      : `field-${absolutePath}`;
    const exactSlot = slots[dotName] ?? slots[rawName];
    const fallbackSlot = arrayPath !== undefined ? (slots["row-field"] ?? slots.field) : slots.field;
    const chosen = exactSlot ?? fallbackSlot;
    if (!chosen) return undefined;
    const slotProps = {
      field,
      path: absolutePath,
      ...(arrayPath !== undefined ? { arrayPath, itemPath: field.path, index } : {}),
      value: valueAt(values.value, absolutePath),
      error: allErrors.value[absolutePath],
      changed: changed.value.has(absolutePath),
      disabled: field.readOnly || saving.value,
      set: (value: RuntimeJsonValue) => set(absolutePath, value),
      remove: () => remove(absolutePath),
    };
    if (!exactSlot) {
      const rendered = chosen(slotProps);
      if (!hasRenderedNodes(rendered)) return undefined;
    }
    return { slot: chosen, props: slotProps };
  },
});

const formObjectLabel = computed<string | null>(() => {
  if (key.value) {
    const known = panel.instance.objectName(objectType, key.value);
    if (known) return known;
  }
  const current = values.value;
  for (const candidate of ["displayName", "name", "title", "label"]) {
    const raw = current[candidate];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return key.value ?? null;
});

useMemberOutput("label", () => (description.value ? formObjectLabel.value : null));
useMemberOutput("dirty", () => dirty.value);
useMemberOutput("draft", () => (description.value ? prunedValues.value : null));

useProjectionForm({
  handle: {
    fields,
    values,
    errors,
    changed,
    busy: saving,
    dirty: canSettle,
    dirtyFields,
    submitting: saving,
    canSubmit,
    set,
    submit: () => panel.instance.forms.submit(slot.slot),
    reset: async (options) => {
      if (options?.confirm) return await confirmDiscard();
      discard();
      return true;
    },
  },
  async fill(rawValues, options) {
    if (options?.expectedFormInstanceId !== undefined && options.expectedFormInstanceId !== formInstanceId.value) {
      return {
        ok: false,
        reason: "stale",
        message: "The form instance changed or rebound since the last observation.",
      };
    }
    if (options?.expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, options.expectedTarget)) {
      return {
        ok: false,
        reason: "stale",
        message: "The form switched to a different target object or draft.",
      };
    }
    if (!mounted || unmounted || !target.value || !opened.value || loading.value || saving.value || failure.value) {
      return {
        ok: false,
        reason: "form_not_ready",
        message: failure.value?.reason.message ?? "The form is not ready for editing.",
      };
    }
    if (asking.value || askNext !== null) {
      await waitForOwnerAsk();
      if (options?.expectedFormInstanceId !== undefined && options.expectedFormInstanceId !== formInstanceId.value) {
        return {
          ok: false,
          reason: "stale",
          message: "The form instance changed or rebound since the last observation.",
        };
      }
      if (options?.expectedTarget !== undefined && !matchesExpectedTarget(effectiveTarget.value, options.expectedTarget)) {
        return {
          ok: false,
          reason: "stale",
          message: "The form switched to a different target object or draft.",
        };
      }
      const postFailure = failure.value as { reason: Error; retry: () => void } | null;
      if (!mounted || unmounted || !target.value || !opened.value || loading.value || saving.value || postFailure) {
        return {
          ok: false,
          reason: "form_not_ready",
          message: postFailure?.reason.message ?? "The form is no longer ready for editing.",
        };
      }
    }

    const pending = new Map<string, RuntimeJsonValue>();
    for (const [rawKey, value] of Object.entries(rawValues)) {
      const pointer = rawKey.startsWith("/") ? rawKey : `/${rawKey}`;
      pending.set(pointer, value);
    }

    const isSecret = (pointer: string) => formSecretPaths(fields.value, values.value, { target: pointer }).length > 0;

    // Standard detail 3.8: only block when filling fields that overlap unsaved edits made by the user.
    // Filling untouched fields or revising fields filled by the agent earlier in this session proceeds directly.
    if (!options?.overwriteUnsaved) {
      const activeUserEdited = activeUserEditedPaths();
      const conflicts = [...pending.keys()].filter((pointer) =>
        !isSecret(pointer) && activeUserEdited.some((userPath) => pathsOverlap(pointer, userPath)),
      );
      if (conflicts.length > 0) {
        return {
          ok: false,
          reason: "blocked_unsaved",
          message: `The form has unsaved user edits on ${conflicts.join(", ")}. Ask the user before overwriting them with overwriteUnsaved: true.`,
        };
      }
    }

    const startTargetKey = targetKey(target.value);
    const startReading = latestRead;
    const filledFields: string[] = [];
    const rejectedFields: FormFieldRejection[] = [];

    const applyField = (pointer: string, value: RuntimeJsonValue) => {
      edit(pointer, withValueAt(values.value, pointer, value), "agent");
      const described = fields.value.find((item) => pointer === item.path || pointer.startsWith(`${item.path}/`));
      const nextChanged = new Set(changed.value);
      nextChanged.add(pointer);
      if (described) nextChanged.add(described.path);
      changed.value = nextChanged;
      if (pointer in invalid.value) markInvalid(pointer, null);
      filledFields.push(pointer);
    };

    const fillableFields = () => (
      props.groups && props.groups.length > 0 && props.unassignedFields === "omit"
        ? resolvedGroups.value.flatMap((group) => group.fields)
        : drawn.value
    );

    const validateEntry = (
      pointer: string,
      value: RuntimeJsonValue,
    ): { readonly ok: true; readonly field: PanelFormField } | { readonly ok: false; readonly rejection: FormFieldRejection } => {
      if (isSecret(pointer)) {
        const key = "platform.formSecretHumanInput";
        return { ok: false, rejection: { path: pointer, reason: "secret", message: te(key) ? t(key) : "Enter this secret yourself on the page." } };
      }
      if (isFixed(pointer)) {
        return { ok: false, rejection: { path: pointer, reason: "fixed", message: `Field ${pointer} is fixed by page state.` } };
      }
      const resolved = resolveActiveField(fillableFields(), values.value, pointer);
      if (!resolved) {
        return { ok: false, rejection: { path: pointer, reason: "unknown_field", message: `Field ${pointer} is not active or shown in this form.` } };
      }
      if (resolved.readOnly) {
        return {
          ok: false,
          rejection: {
            path: pointer,
            reason: "read_only",
            message: resolved.readOnlyReason ?? `Field ${pointer} is read-only.`,
          },
        };
      }
      const valueRejection = validateFormFieldValue(resolved.field, pointer, value, values.value, fixedValues.value);
      if (valueRejection) {
        return { ok: false, rejection: valueRejection };
      }
      return { ok: true, field: resolved.field };
    };

    const rejectRemaining = (
      reason: FormFieldRejection["reason"],
      messageFor: (pointer: string) => string,
    ) => {
      for (const pointer of pending.keys()) {
        rejectedFields.push({ path: pointer, reason, message: messageFor(pointer) });
      }
      pending.clear();
    };

    while (pending.size > 0) {
      if (unmounted || targetKey(target.value) !== startTargetKey) {
        rejectRemaining("unknown_field", (pointer) => `Field ${pointer} was not applied because the form target changed or closed.`);
        break;
      }
      const loopFailure = failure.value as { reason: Error; retry: () => void } | null;
      if (latestRead !== startReading || loopFailure || saving.value) {
        const detail = loopFailure
          ? `form refresh failed: ${loopFailure.reason.message}`
          : saving.value
            ? "the form started saving"
            : "the form reloaded during fill";
        rejectRemaining("read_only", (pointer) => `Field ${pointer} was not applied because ${detail}.`);
        break;
      }
      // Apply any currently active, valid `refreshOnChange` field first so dependent fields unlock before validation.
      let refreshEntry: [string, RuntimeJsonValue] | null = null;
      for (const entry of pending) {
        const [pointer, value] = entry;
        const checked = validateEntry(pointer, value);
        if (checked.ok && checked.field.refreshOnChange) {
          refreshEntry = entry;
          break;
        }
      }
      if (refreshEntry) {
        const [pointer, value] = refreshEntry;
        pending.delete(pointer);
        applyField(pointer, value);
        const editsAfter = edits;
        await waitForOwnerAsk();
        if (unmounted || targetKey(target.value) !== startTargetKey) {
          rejectRemaining("unknown_field", (remaining) => `Field ${remaining} was not applied because the form target changed or closed.`);
          break;
        }
        if (edits !== editsAfter) {
          rejectRemaining("read_only", (remaining) => `Field ${remaining} was not applied because the form was edited during refresh.`);
          break;
        }
        continue;
      }

      for (const [pointer, value] of pending) {
        const checked = validateEntry(pointer, value);
        if (!checked.ok) {
          rejectedFields.push(checked.rejection);
          continue;
        }
        applyField(pointer, value);
      }
      pending.clear();
    }

    if (filledFields.length === 0) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        rejectedFields,
        message: "None of the requested fields could be edited in this form.",
      };
    }
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
      ownerShown: ownerShown.value!,
      values: values.value,
      changed: changed.value,
      submitted: submitted.value,
      invalid: invalid.value,
      errors: errors.value,
      refusal: refusal.value,
      editedPaths: editedPaths.value,
      userEditedPaths: userEditedPaths.value,
      agentFilledPaths: agentFilledPaths.value,
    }),
    restore: restoreDraft,
  },
  snapshot() {
    if (!opened.value) return null;
    const currentTarget = target.value;
    const modified = [...dirtyFields.value];
    const paths = formSecretPaths(fields.value, values.value);
    const active = formSecretPaths(fields.value, values.value, { active: true });
    const save = currentTarget && canSubmit.value && Object.keys(activeInvalid.value).length === 0
      ? forms.prepareActionSave(currentTarget, saveInput(prunedValues.value), saveContext())
      : null;
    return {
      formInstanceId: formInstanceId.value,
      ...(save ? { save } : {}),
      ...(currentTarget
        ? {
            target: currentTarget.kind === "object"
              ? { kind: "object" as const, objectType: currentTarget.objectType, primaryKey: currentTarget.primaryKey }
              : { kind: "draft" as const, objectType },
          }
        : {}),
      dirty: dirty.value,
      ...(modified.length ? { dirtyFields: modified } : {}),
      values: splitPanelSecrets(values.value, paths).redacted,
      ...(active.length && { secretFields: Object.fromEntries(active.map(path => [path, panelSecretValuePresent(valueAt(values.value, path))])) }),
    };
  },
});

function resetDraft(reopenWhenUnfieldedRefusal: boolean) {
  const refused = refusal.value;
  const reopen = reopenWhenUnfieldedRefusal && refused instanceof PlatformObjectRefusal &&
    Object.keys(refused.fields).length === 0 && Object.keys(refused.savedFields).length === 0;
  if (ownerOpened.value) adopt(ownerOpened.value);
  if (reopen) load(target.value);
}

function discard(reopenWhenUnfieldedRefusal = true) {
  resetDraft(reopenWhenUnfieldedRefusal);
  emit("discarded");
}

/** The reader's Discard: what they have not saved is thrown away only once they say so (原页面对照《智能体设置》). */
async function confirmDiscard(): Promise<boolean> {
  const confirmed = await confirmDanger(t("platform.formDiscardConfirm"), t("platform.discard"), {
    confirmButtonText: t("platform.discard"),
    cancelButtonText: t("platform.keepEditing"),
  });
  if (confirmed) discard();
  return confirmed;
}

/**
 * The reader's Cancel on a create form: asks before throwing away edits when dirty, otherwise resets immediately
 * and tells the page `cancel`.
 */
async function cancelCreate() {
  if (canSettle.value) {
    const confirmed = await confirmDanger(t("platform.formDiscardConfirm"), t("platform.cancel"), {
      confirmButtonText: t("platform.discard"),
      cancelButtonText: t("platform.keepEditing"),
    });
    if (!confirmed) return;
  }
  resetDraft(false);
  emit("cancel");
}

async function saveFromForm() {
  const startTargetKey = targetKey(target.value);
  const startOpened = ownerOpened.value;
  try {
    await panel.instance.forms.submit(slot.slot);
  } catch (reason) {
    if (reason instanceof PanelConfirmationDeferred) return;
    // The operation also rejects for programmatic callers. Only show the refusal in the form if it is still on the originating target.
    if (!unmounted && targetKey(target.value) === startTargetKey && ownerOpened.value === startOpened) {
      showRefusal(reason);
    }
  }
}

/**
 * What the foot of the form says of the owner's refusal (panelisation lead, 2026-11-22): a message shown on a field is
 * not said again there — the reader is told how many fields to change, and taken to the first — and only what no field
 * shows is said in full. A refusal that names no field is its own message.
 */
const refusalFoot = computed(() => {
  if (!refusal.value) return null;
  const named = Object.entries(errors.value);
  if (!(refusal.value instanceof PlatformObjectRefusal) || !named.length) return { fields: [], said: [refusal.value.message] };
  const onFields = new Set<string>();
  const said: string[] = [];
  for (const [path, message] of named) {
    const field = fieldShowing(fields.value, values.value, path);
    if (field === null) said.push(message);
    else onFields.add(field);
  }
  return { fields: [...onFields], said };
});
const formElement = ref<HTMLElement | null>(null);
/** Takes the reader to the first field, in the form's order, that the refusal's messages are on. */
async function showFirstRefused() {
  const refused = new Set(refusalFoot.value?.fields ?? []);
  if (!refused.size) return;
  if ((effectivePresentation.value === "tabs" || effectivePresentation.value === "steps") && resolvedGroups.value.length > 0) {
    const targetGroup = resolvedGroups.value.find((group) =>
      group.fields.some((field) =>
        [...refused].some((path) => path === field.path || path.startsWith(`${field.path}/`)),
      ),
    );
    if (targetGroup && targetGroup.key !== activeGroupKey.value) {
      setActiveGroup(targetGroup.key);
      await nextTick();
    }
  }
  const targetElement = [...(formElement.value?.querySelectorAll<HTMLElement>("[data-field]") ?? [])]
    .find((item) => refused.has(item.dataset.field!));
  targetElement?.scrollIntoView?.({ block: "center" });
}

function showRefusal(reason: unknown) {
  refusal.value = reason instanceof Error ? reason : new Error(String(reason));
  errors.value = reason instanceof PlatformObjectRefusal ? reason.fields : {};
}

function formatSaveRefusalReason(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : String(reason).trim();
  if (!(reason instanceof PlatformObjectRefusal)) return message;
  const fieldDetails = Object.values(reason.fields)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== message);
  if (!fieldDetails.length) return message;
  return message ? `${message}: ${fieldDetails.join("; ")}` : fieldDetails.join("; ");
}

function notifyStaleSaveRefusal(action: string, targetLabel: string | null, reason: unknown) {
  const message = formatSaveRefusalReason(reason);
  const text = targetLabel
    ? (te("platform.formSaveFailedFor")
        ? t("platform.formSaveFailedFor", { action, target: targetLabel, message })
        : `${action} (${targetLabel}) failed: ${message}`)
    : (te("platform.formSaveFailed")
        ? t("platform.formSaveFailed", { action, message })
        : `${action} failed: ${message}`);
  panel.notify({ kind: "error", text });
}

function takeSavedFields(receipt: PlatformObjectRefusal) {
  const saved = Object.entries(receipt.savedFields);
  if (!saved.length) return;
  const previous = ownerOpened.value!;
  const baseline = { ...previous, values: saved.reduce(
    (all, [path, value]) => withValueAt(all, path, value), previous.values,
  ) };
  ownerOpened.value = baseline;
  opened.value = fixDescription(baseline);
  const savedPaths = new Set(saved.map(([path]) => path));
  const stillChanged = effectiveChangedPaths.value;
  const keep = (path: string) => !savedPaths.has(path) || stillChanged.has(path);
  submitted.value = new Set([...submitted.value].filter(keep));
  changed.value = new Set([...changed.value].filter(keep));
  const keepNested = (path: string) =>
    ![...savedPaths].some((savedPath) => path === savedPath || path.startsWith(`${savedPath}/`))
    || [...stillChanged].some((changedPath) => path === changedPath || path.startsWith(`${changedPath}/`));
  editedPaths.value = new Set([...editedPaths.value].filter(keepNested));
  userEditedPaths.value = new Set([...userEditedPaths.value].filter(keepNested));
  agentFilledPaths.value = new Set([...agentFilledPaths.value].filter(keepNested));
  editGeneration += 1;
}

function saveInput(payloadValues: PanelFormValues) {
  const { revision } = opened.value!;
  return {
    values: payloadValues,
    submittedFields: [...submitted.value],
    ...(revision === undefined ? {} : { revision }),
  };
}

function saveContext(agentContext?: PanelAgentActionContext, evaluateSubmission?: SubmissionEvaluator) {
  return {
    secretFields: formSecretPaths(fields.value, values.value),
    fixedFieldPaths: Object.keys(fixedValues.value),
    changedFields: [...new Set([...changed.value, ...effectiveChangedPaths.value, ...editedPaths.value])],
    baselineValues: opened.value!.values,
    ...(agentContext ? { agentContext } : {}),
    ...(evaluateSubmission ? { evaluateSubmission } : {}),
    formatUnwiredFieldRefusal: (paths: readonly string[]) => ({
      message: te("platform.formActionUnwiredFields")
        ? t("platform.formActionUnwiredFields", { fields: paths.join(", ") })
        : `Cannot save: the current save action does not accept changes to ${paths.join(", ")}`,
      fieldMessage: () => actionFieldReadOnlyReason.value,
    }),
  };
}

/** Finish the save for the target it started with, whether the page button or the agent requested it. */
function settleSave(into: PanelFormTarget, payloadValues: PanelFormValues) {
  const fixed = fixedValues.value;
  return async (saved: FormSaveResult) => {
    const createdWithoutKey = into.kind === "draft" && saved.primaryKey === null;
    const stillShowingTarget = !unmounted && target.value === into && fixedValues.value === fixed;
    if (stillShowingTarget) {
      if (createdWithoutKey) {
        adopt(ownerOpened.value!);
      } else {
        adopt({ ...ownerShown.value!, values: splitPanelSecrets(payloadValues, formSecretPaths(fields.value, payloadValues)).redacted, errors: [] });
        if (into.kind === "draft") moveTo({ kind: "object", objectType, primaryKey: saved.primaryKey! });
      }
    }
    if (!stillShowingTarget || createdWithoutKey) {
      panel.notify({ kind: "success", text: saved.message ?? t("platform.operationDone") });
    }
    emit("saved", { className: objectType, primaryKey: saved.primaryKey });
  };
}

/**
 * Writes the form through its owner — the selected object's update, or the create — with the revision it was read at
 * where the owner has one. An owner that refuses has its reason shown beside the form and its field messages on the
 * fields it named; nothing is retried, and the reader's form stays as they left it. A create selects the object the
 * owner created; every projection showing the saved object reads it again, this form included, at its new revision.
 */
async function write(override?: FormSubmitOverride, agentContext?: PanelAgentActionContext): Promise<unknown> {
  const into = target.value;
  if (!into) throw new Error("This form edits one object, and none is selected");
  if (failure.value) throw failure.value.reason;
  if (saving.value) throw new Error("The form is currently saving.");
  if (loading.value || asking.value) throw new Error(t("common.loading"));
  if (Object.keys(activeInvalid.value).length) throw new Error(t("platform.formFixInvalid"));
  const capturedTargetKey = targetKey(into);
  const capturedOpened = ownerOpened.value;
  const capturedLabel = formObjectLabel.value;
  const saveActionLabel = override?.descriptor.label ?? admittedSave.value?.descriptor.label
    ?? (into.kind === "draft" ? t("platform.create") : t("platform.save"));
  const isStillSameForm = () =>
    !unmounted && targetKey(target.value) === capturedTargetKey && ownerOpened.value === capturedOpened;
  const handleSaveRefusal = (refusalReason: unknown) => {
    if (isStillSameForm()) {
      if (refusalReason instanceof PlatformObjectRefusal) takeSavedFields(refusalReason);
      showRefusal(refusalReason);
      return;
    }
    notifyStaleSaveRefusal(saveActionLabel, capturedLabel, refusalReason);
  };
  const evaluateSaveSubmission: SubmissionEvaluator = (phase: SubmissionCheckPhase) => {
    if (unmounted || !mounted || panel.instance.isDisposed()) {
      return { ok: false, message: "The form was closed or unmounted." };
    }
    if (formContextChanged()) {
      return { ok: false, message: "The form target or fixed values changed." };
    }
    if (!target.value || !opened.value) {
      return { ok: false, message: "The form no longer has an active target." };
    }
    if (failure.value) {
      return { ok: false, message: failure.value.reason.message };
    }
    if (loading.value || asking.value) {
      return { ok: false, message: "The form is currently busy loading." };
    }
    if (phase === "confirm" && saving.value) {
      return { ok: false, message: "The form is currently saving." };
    }
    if (Object.keys(activeInvalid.value).length > 0) {
      return { ok: false, message: t("platform.formFixInvalid") };
    }
    if (override) {
      const originCheck = override.evaluateOrigin?.();
      if (originCheck && !originCheck.ok) return originCheck;
    } else if (!admittedSave.value) {
      return { ok: false, message: "The form save operation is no longer available." };
    }
    if (!isCreate.value && !canSettle.value) {
      return { ok: false, message: "The form no longer has unsaved changes to save." };
    }
    const liveOperationId = override?.operationId ?? panel.instance.operationIdOf(slot.slot, admittedSave.value!.name);
    const liveDescriptor = override?.descriptor ?? admittedSave.value!.descriptor;
    const liveCallTarget = liveDescriptor.target.source === "none" ? null : target.value;
    const livePayloadValues = pruneInactivePanelFormVariants(fields.value, values.value);
    const liveMemberInputs = override
      ? (override.readMemberInputs ? override.readMemberInputs() : override.memberInputs)
      : member.inputs.value;
    return {
      ok: true,
      instanceId: panel.instance.instanceId,
      operationId: liveOperationId,
      target: { formTarget: effectiveTarget.value, callTarget: liveCallTarget },
      payload: {
        formInstanceId: formInstanceId.value,
        values: livePayloadValues,
        fixedValues: fixedValues.value,
        submittedFields: [...submitted.value].sort(),
        activeInvalid: activeInvalid.value,
        editGeneration,
        revision: opened.value.revision ?? null,
        dirty: dirty.value,
        baseline: ownerOpened.value?.values ?? null,
        memberInputs: liveMemberInputs ?? null,
      },
    };
  };
  saving.value = true;
  refusal.value = null;
  errors.value = {};
  const payloadValues = pruneInactivePanelFormVariants(fields.value, values.value);
  const finishSave = settleSave(into, payloadValues);
  try {
    const saved = await forms.save(
      into,
      saveInput(payloadValues),
      override,
      saveContext(agentContext ?? override?.agentContext, evaluateSaveSubmission),
    );
    await finishSave(saved);
    return saved;
  } catch (reason) {
    if (reason instanceof PanelOperationDeferred) {
      const deferred = reason;
      const { preparation } = deferred;
      const confirmation = createDeferredConfirmation({
        intentId: preparation.intentId,
        questionId: preparation.questionId!,
        operationId: preparation.operationId,
        label: preparation.label,
        staleCode: "FORM_CONFIRMATION_STALE",
        isStillValid: deferred.isStillValid,
        cancel: deferred.cancelNow,
        async dispatchVerified(): Promise<PageActionConfirmedDispatchResult> {
          saving.value = true;
          refusal.value = null;
          errors.value = {};
          try {
            const confirmed = await deferred.dispatchNow();
            if (confirmed.decision !== "confirm") {
              return { ok: false, intentId: preparation.intentId, reason: "not_dispatched", message: "The save was cancelled." };
            }
            const classified = classifyDispatchResponseForConfirmation(preparation.intentId, confirmed.response);
            if (!classified.ok) {
              try {
                resolveFormSaveAnswer(confirmed, into, objectType);
              } catch (refusalReason) {
                handleSaveRefusal(refusalReason);
              }
              return classified;
            }
            const saved = resolveFormSaveAnswer(confirmed, into, objectType);
            await finishSave(saved);
            return classified;
          } catch (dispatchReason) {
            if (dispatchReason instanceof PanelSubmissionStaleError) {
              return {
                ok: false,
                intentId: preparation.intentId,
                reason: "stale",
                message: dispatchReason.message,
              };
            }
            handleSaveRefusal(dispatchReason);
            return {
              ok: false,
              intentId: preparation.intentId,
              reason: "failed",
              message: dispatchReason instanceof Error ? dispatchReason.message : String(dispatchReason),
            };
          } finally {
            saving.value = false;
          }
        },
      });
      throw new PanelConfirmationDeferred(confirmation);
    }
    if (reason instanceof PanelConfirmationDeferred || reason instanceof PanelSubmissionStaleError) throw reason;
    handleSaveRefusal(reason);
    throw reason;
  } finally {
    saving.value = false;
  }
}

/**
 * The form's state, in the product's one presentation: the owner's form once read, a selection needed first, loading,
 * no permission, or the reason it could not be read.
 */
const shown = computed<DataStateResult<PanelFormDescription>>(() => {
  if (state.value !== null && panel.instance.addressPending?.value) {
    return { status: "loading" };
  }
  if (failure.value) {
    const { reason, retry } = failure.value;
    return reason instanceof MemberDataUnavailable && reason.state.status !== "error"
      ? reason.state : { status: "error", message: reason.message, retry };
  }
  if (loading.value) return { status: "loading" };
  return description.value ? { status: "ready", value: description.value } : { status: "awaiting" };
});
const labels = useDataStateLabels();

/**
 * Bottom action bar visibility:
 * - Always pinned in create mode (`Cancel` / `Create`).
 * - Never shown on an all-read-only edit form with no pending changes.
 * - On an edit form, appears only once there are changes to settle (`Discard` / `Save`).
 */
const showActionBar = computed(() => {
  if (props.actions === "none") return false;
  if (isCreate.value) return true;
  if (props.actions === "create-only") return false;
  if (allReadOnly.value && !canSettle.value) return false;
  return canSettle.value;
});

/** The fields an assistant filled, by the owner's labels, in the form's order — those other slots draw included. */
const changedLabels = computed(() => fields.value.filter((field) => changed.value.has(field.path)).map((field) => field.label).join(", "));

const prevStepLabel = computed(() => (te("platform.formPrevStep") ? t("platform.formPrevStep") : "Previous"));
const nextStepLabel = computed(() => (te("platform.formNextStep") ? t("platform.formNextStep") : "Next"));

const hasCustomLayout = computed(() => Boolean(slots.default));

const slotScope = computed<ObjectFormSlotScope>(() => ({
  groups: resolvedGroups.value,
  activeGroup: activeGroupKey.value,
  setActiveGroup,
  dirty: canSettle.value,
  canSave: canSubmit.value,
  saving: saving.value,
  isCreate: isCreate.value,
  changedCount: changedCount.value,
  dirtyFields: dirtyFields.value,
  errors: allErrors.value,
  groupDirty: (groupKey: string) => resolvedGroups.value.find((group) => group.key === groupKey)?.dirty ?? false,
  groupErrorCount: (groupKey: string) => resolvedGroups.value.find((group) => group.key === groupKey)?.errorCount ?? 0,
  fieldsDirty: (paths: readonly string[]) => paths.some((path) => dirtyFields.value.has(path) || changed.value.has(path)),
  fieldsErrorCount: (paths: readonly string[]) => errorCountForPaths(new Set(paths)),
  save: saveFromForm,
  discard: confirmDiscard,
  cancel: cancelCreate,
}));
</script>

<template>
  <div
    ref="formElement"
    class="sdk-owner-form"
    :class="[
      { 'sdk-owner-form-rows': props.layout === 'rows' },
      `sdk-owner-form-presentation-${effectivePresentation}`,
    ]"
  >
    <data-state :result="shown" :labels="labels">
    <!-- The panel frame is sandboxed without allow-forms, so the browser drops a native form submission before any
         submit handler runs: the reader's save is the button's own click. -->
    <el-form label-position="top" class="sdk-owner-form-inner">
      <div class="sdk-owner-form-body">
        <p v-for="reason in sharedReadOnlyReasons" :key="reason" class="sdk-owner-form-readonly" role="note">{{ reason }}</p>

        <template v-if="hasCustomLayout">
          <slot v-bind="slotScope"></slot>
        </template>

        <template v-else-if="effectivePresentation === 'cards' && resolvedGroups.length > 0">
          <div
            v-if="hasSplitColumns && effectiveCardColumns === 2"
            class="sdk-owner-form-cards is-split"
          >
            <div class="sdk-owner-form-cards-col is-main">
              <section
                v-for="group in splitMainGroups"
                :key="group.key"
                class="sdk-owner-form-card"
                :class="{ changed: group.changed, dirty: group.dirty }"
                :data-form-group="group.key"
              >
                <header v-if="group.title || group.description" class="sdk-owner-form-card-head">
                  <h3 v-if="group.title" class="sdk-owner-form-section-title">{{ group.title }}</h3>
                  <p v-if="group.description" class="sdk-owner-form-section-hint">{{ group.description }}</p>
                </header>
                <slot :name="`group-${group.key}-header`" :group="group"></slot>
                <form-field-place v-for="field in group.plain" :key="field.path" :field="field"></form-field-place>
                <form-advanced-section v-if="group.advanced.length" :paths="group.advanced.map((field) => field.path)">
                  <form-field-place v-for="field in group.advanced" :key="field.path" :field="field"></form-field-place>
                </form-advanced-section>
                <slot :name="`group-${group.key}-footer`" :group="group"></slot>
              </section>
            </div>
            <div class="sdk-owner-form-cards-col is-side">
              <section
                v-for="group in splitSideGroups"
                :key="group.key"
                class="sdk-owner-form-card"
                :class="{ changed: group.changed, dirty: group.dirty }"
                :data-form-group="group.key"
              >
                <header v-if="group.title || group.description" class="sdk-owner-form-card-head">
                  <h3 v-if="group.title" class="sdk-owner-form-section-title">{{ group.title }}</h3>
                  <p v-if="group.description" class="sdk-owner-form-section-hint">{{ group.description }}</p>
                </header>
                <slot :name="`group-${group.key}-header`" :group="group"></slot>
                <form-field-place v-for="field in group.plain" :key="field.path" :field="field"></form-field-place>
                <form-advanced-section v-if="group.advanced.length" :paths="group.advanced.map((field) => field.path)">
                  <form-field-place v-for="field in group.advanced" :key="field.path" :field="field"></form-field-place>
                </form-advanced-section>
                <slot :name="`group-${group.key}-footer`" :group="group"></slot>
              </section>
            </div>
            <section
              v-for="group in splitFullGroups"
              :key="group.key"
              class="sdk-owner-form-card is-full"
              :class="{ changed: group.changed, dirty: group.dirty }"
              :data-form-group="group.key"
            >
              <header v-if="group.title || group.description" class="sdk-owner-form-card-head">
                <h3 v-if="group.title" class="sdk-owner-form-section-title">{{ group.title }}</h3>
                <p v-if="group.description" class="sdk-owner-form-section-hint">{{ group.description }}</p>
              </header>
              <slot :name="`group-${group.key}-header`" :group="group"></slot>
              <form-field-place v-for="field in group.plain" :key="field.path" :field="field"></form-field-place>
              <form-advanced-section v-if="group.advanced.length" :paths="group.advanced.map((field) => field.path)">
                <form-field-place v-for="field in group.advanced" :key="field.path" :field="field"></form-field-place>
              </form-advanced-section>
              <slot :name="`group-${group.key}-footer`" :group="group"></slot>
            </section>
          </div>
          <div
            v-else
            class="sdk-owner-form-cards"
            :class="{ 'is-two-col': effectiveCardColumns === 2 }"
          >
            <section
              v-for="group in resolvedGroups"
              :key="group.key"
              class="sdk-owner-form-card"
              :class="{ changed: group.changed, dirty: group.dirty, 'is-full': group.column === 'full' }"
              :data-form-group="group.key"
            >
              <header v-if="group.title || group.description" class="sdk-owner-form-card-head">
                <h3 v-if="group.title" class="sdk-owner-form-section-title">{{ group.title }}</h3>
                <p v-if="group.description" class="sdk-owner-form-section-hint">{{ group.description }}</p>
              </header>
              <slot :name="`group-${group.key}-header`" :group="group"></slot>
              <form-field-place v-for="field in group.plain" :key="field.path" :field="field"></form-field-place>
              <form-advanced-section v-if="group.advanced.length" :paths="group.advanced.map((field) => field.path)">
                <form-field-place v-for="field in group.advanced" :key="field.path" :field="field"></form-field-place>
              </form-advanced-section>
              <slot :name="`group-${group.key}-footer`" :group="group"></slot>
            </section>
          </div>
        </template>

        <template v-else-if="effectivePresentation === 'tabs' && resolvedGroups.length > 0">
          <div class="sdk-owner-form-tabs">
            <div class="sdk-owner-form-tablist" role="tablist" :aria-label="t('platform.formSections')">
              <button
                v-for="group in resolvedGroups"
                :key="group.key"
                type="button"
                role="tab"
                class="sdk-owner-form-tab"
                :class="{ 'is-active': group.key === activeGroupKey, 'is-changed': group.changed, 'is-dirty': group.dirty, 'has-errors': group.errorCount > 0 }"
                :aria-selected="group.key === activeGroupKey ? 'true' : 'false'"
                :data-form-tab="group.key"
                :data-dirty="group.dirty ? 'true' : undefined"
                :data-errors="group.errorCount > 0 ? String(group.errorCount) : undefined"
                @click="setActiveGroup(group.key)"
              >
                <span class="sdk-owner-form-tab-label">{{ group.title || group.key }}</span>
                <span v-if="group.errorCount > 0" class="sdk-owner-form-tab-errors">{{ group.errorCount }}</span>
                <span v-else-if="group.dirty" class="sdk-owner-form-tab-dot" aria-hidden="true"></span>
              </button>
            </div>
            <section
              v-if="activeGroupObject"
              :key="activeGroupObject.key"
              class="sdk-owner-form-tabpanel"
              role="tabpanel"
              :data-form-group="activeGroupObject.key"
            >
              <p v-if="activeGroupObject.description" class="sdk-owner-form-section-hint">{{ activeGroupObject.description }}</p>
              <slot :name="`group-${activeGroupObject.key}-header`" :group="activeGroupObject"></slot>
              <form-field-place v-for="field in activeGroupObject.plain" :key="field.path" :field="field"></form-field-place>
              <form-advanced-section v-if="activeGroupObject.advanced.length" :paths="activeGroupObject.advanced.map((field) => field.path)">
                <form-field-place v-for="field in activeGroupObject.advanced" :key="field.path" :field="field"></form-field-place>
              </form-advanced-section>
              <slot :name="`group-${activeGroupObject.key}-footer`" :group="activeGroupObject"></slot>
            </section>
          </div>
        </template>

        <template v-else-if="effectivePresentation === 'steps' && resolvedGroups.length > 0">
          <div class="sdk-owner-form-steps">
            <ol class="sdk-owner-form-stepbar" :aria-label="t('platform.formSections')">
              <li
                v-for="(group, index) in resolvedGroups"
                :key="group.key"
                class="sdk-owner-form-step-item"
                :class="{
                  'is-active': group.key === activeGroupKey,
                  'is-complete': index < activeGroupIndex,
                  'is-dirty': group.dirty,
                  'has-errors': group.errorCount > 0,
                }"
              >
                <button
                  type="button"
                  class="sdk-owner-form-step-btn"
                  :disabled="!allowStepJump && index > activeGroupIndex"
                  :aria-current="group.key === activeGroupKey ? 'step' : undefined"
                  :data-form-step="group.key"
                  :data-dirty="group.dirty ? 'true' : undefined"
                  :data-errors="group.errorCount > 0 ? String(group.errorCount) : undefined"
                  @click="setActiveGroup(group.key)"
                >
                  <span class="sdk-owner-form-step-index">{{ index + 1 }}</span>
                  <span class="sdk-owner-form-step-label">{{ group.title || group.key }}</span>
                  <span v-if="group.errorCount > 0" class="sdk-owner-form-tab-errors">{{ group.errorCount }}</span>
                  <span v-else-if="group.dirty" class="sdk-owner-form-tab-dot" aria-hidden="true"></span>
                </button>
              </li>
            </ol>
            <section
              v-if="activeGroupObject"
              :key="activeGroupObject.key"
              class="sdk-owner-form-step-panel"
              :data-form-group="activeGroupObject.key"
            >
              <header v-if="activeGroupObject.title || activeGroupObject.description" class="sdk-owner-form-card-head">
                <h3 v-if="activeGroupObject.title" class="sdk-owner-form-section-title">{{ activeGroupObject.title }}</h3>
                <p v-if="activeGroupObject.description" class="sdk-owner-form-section-hint">{{ activeGroupObject.description }}</p>
              </header>
              <slot :name="`group-${activeGroupObject.key}-header`" :group="activeGroupObject"></slot>
              <form-field-place v-for="field in activeGroupObject.plain" :key="field.path" :field="field"></form-field-place>
              <form-advanced-section v-if="activeGroupObject.advanced.length" :paths="activeGroupObject.advanced.map((field) => field.path)">
                <form-field-place v-for="field in activeGroupObject.advanced" :key="field.path" :field="field"></form-field-place>
              </form-advanced-section>
              <slot :name="`group-${activeGroupObject.key}-footer`" :group="activeGroupObject"></slot>
            </section>
            <div v-if="resolvedGroups.length > 1" class="sdk-owner-form-step-nav">
              <el-button
                :disabled="activeGroupIndex <= 0"
                data-form-step-prev
                @click="goPrevStep"
              >{{ prevStepLabel }}</el-button>
              <el-button
                v-if="activeGroupIndex < resolvedGroups.length - 1"
                type="primary"
                plain
                data-form-step-next
                @click="goNextStep"
              >{{ nextStepLabel }}</el-button>
            </div>
          </div>
        </template>

        <div v-else-if="sectionGroups" class="sdk-owner-form-sectioned">
          <div class="sdk-owner-form-sections">
            <section
              v-for="group in sectionGroups"
              :key="group.key"
              class="sdk-owner-form-section"
              :class="{ changed: group.changed }"
              :data-form-section="group.key || undefined"
            >
              <h3 v-if="group.title" class="sdk-owner-form-section-title">{{ group.title }}</h3>
              <p v-if="group.hint" class="sdk-owner-form-section-hint">{{ group.hint }}</p>
              <form-field-place v-for="field in group.plain" :key="field.path" :field="field"></form-field-place>
              <form-advanced-section v-if="group.advanced.length" :paths="group.advanced.map((field) => field.path)">
                <form-field-place v-for="field in group.advanced" :key="field.path" :field="field"></form-field-place>
              </form-advanced-section>
            </section>
          </div>
          <!-- The form's contents: each entry brings its section into view; every section stays on the page. -->
          <nav class="sdk-owner-form-contents" :aria-label="t('platform.formSections')">
            <button v-for="group in sectionGroups.filter((item) => item.title)" :key="group.key" type="button" @click="goToSection(group.key)">
              {{ group.title }}
            </button>
          </nav>
        </div>
        <template v-else>
          <form-field-place v-for="field in plain" :key="field.path" :field="field"></form-field-place>
          <form-advanced-section v-if="advanced.length" :paths="advanced.map((field) => field.path)">
            <form-field-place v-for="field in advanced" :key="field.path" :field="field"></form-field-place>
          </form-advanced-section>
        </template>
        <slot name="after-fields"></slot>
        <p v-if="changed.size" class="sdk-owner-form-changed" role="status">
          {{ t("platform.panelDraftChanged", { fields: changedLabels }) }}
        </p>
        <div v-if="refusalFoot" class="sdk-owner-form-refusal" role="alert">
          <button v-if="refusalFoot.fields.length" type="button" class="sdk-owner-form-refusal-count" @click="showFirstRefused">
            {{ t("platform.formFieldsNeedChanges", { n: refusalFoot.fields.length }, refusalFoot.fields.length) }}
          </button>
          <p v-for="message in refusalFoot.said" :key="message">{{ message }}</p>
        </div>
      </div>
      <div v-if="$slots.actions || showActionBar" class="sdk-owner-form-actions">
        <slot
          name="actions"
          :saving="saving"
          :asking="asking"
          :dirty="dirty"
          :can-settle="canSettle"
          :is-create="isCreate"
          :changed-count="changedCount"
          :save="saveFromForm"
          :discard="confirmDiscard"
          :cancel="cancelCreate"
        >
          <span v-if="canSettle" class="sdk-owner-form-unsaved" role="status">
            {{ t("platform.formChangedCount", { count: changedCount }, changedCount) }}
          </span>
          <template v-if="isCreate">
            <el-button text :disabled="saving" @click="cancelCreate">{{ t("platform.cancel") }}</el-button>
            <el-button type="primary" :disabled="asking || saveUnavailable" :loading="saving" @click="saveFromForm">{{ t("platform.create") }}</el-button>
          </template>
          <template v-else>
            <el-button :disabled="saving || !canSettle" @click="confirmDiscard">{{ t("platform.discard") }}</el-button>
            <el-button type="primary" :disabled="!canSettle || asking || saveUnavailable" :loading="saving" @click="saveFromForm">{{ t("platform.save") }}</el-button>
          </template>
        </slot>
      </div>
    </el-form>
    </data-state>
  </div>
</template>

<style scoped>
/* Save and Discard stay below the form's fields (never overlapping the last textarea in flow-down cards);
   when filling a definite box, `.sdk-owner-form-body` scrolls above them so they stay in reach at the foot. */
.sdk-owner-form-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-block-start: var(--spacing-md);
  padding-block: var(--spacing-sm);
  border-top: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
/* Sections one after another at a reading width, a hairline between them; their list beside them while they scroll. */
.sdk-owner-form {
  container: sdk-owner-form / inline-size;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.sdk-owner-form-inner {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.sdk-owner-form-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.sdk-owner-form-sectioned {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  gap: var(--spacing-2xl);
  align-items: start;
}
.sdk-owner-form-section {
  min-width: 0;
  padding-block: var(--spacing-lg);
  scroll-margin-top: var(--spacing-sm);
}
.sdk-owner-form-section + .sdk-owner-form-section {
  border-top: 1px solid var(--ui-divider);
}
.sdk-owner-form-section-title {
  margin: 0 0 var(--spacing-xs);
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
}
.sdk-owner-form-section.changed .sdk-owner-form-section-title {
  color: var(--brand-link);
}
.sdk-owner-form-section-hint {
  margin: 0 0 var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.sdk-owner-form-contents {
  position: sticky;
  top: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: var(--spacing-lg);
}
.sdk-owner-form-contents button {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: start;
  cursor: pointer;
}
.sdk-owner-form-contents button:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-owner-form-contents button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
/* Narrow, the list gives way to the sections: below this the fields beside it would be narrower than a line of text. */
@container sdk-owner-form (max-width: 720px) {
  .sdk-owner-form-sectioned {
    grid-template-columns: minmax(0, 1fr);
  }
  .sdk-owner-form-contents {
    display: none;
  }
}
.sdk-owner-form-readonly {
  margin: 0 0 var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.sdk-owner-form-changed {
  color: var(--brand-link);
  font-size: var(--text-xs);
  margin: var(--spacing-xs) 0 0;
}
.sdk-owner-form-refusal {
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  margin: var(--spacing-xs) 0 0;
}
.sdk-owner-form-refusal > p {
  margin: 0;
}
/* The count of fields to change, which takes the reader to the first of them. */
.sdk-owner-form-refusal-count {
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: underline;
}
.sdk-owner-form-unsaved {
  margin-inline-end: auto;
  color: var(--el-color-warning);
  font-size: var(--text-sm);
}

/* Multi-card, multi-tab, and multi-step containers sharing one form draft. */
.sdk-owner-form-cards {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--page-content-gap, var(--spacing-lg));
  align-items: start;
}
.sdk-owner-form-cards.is-two-col,
.sdk-owner-form-cards.is-split {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.sdk-owner-form-cards-col {
  display: flex;
  flex-direction: column;
  gap: var(--page-content-gap, var(--spacing-lg));
  min-width: 0;
}
.sdk-owner-form-card {
  min-width: 0;
  padding: var(--surface-padding, var(--spacing-lg));
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  box-sizing: border-box;
}
.sdk-owner-form-card.is-full {
  grid-column: 1 / -1;
}
.sdk-owner-form-card.changed .sdk-owner-form-section-title {
  color: var(--brand-link);
}
.sdk-owner-form-card-head {
  margin-bottom: var(--spacing-md);
}
.sdk-owner-form-card-head .sdk-owner-form-section-hint {
  margin-bottom: 0;
}

.sdk-owner-form-tabs,
.sdk-owner-form-steps {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}
.sdk-owner-form-tablist {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  border-bottom: 1px solid var(--ui-divider);
  padding-bottom: var(--spacing-xs);
}
.sdk-owner-form-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-height: var(--control-height-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.sdk-owner-form-tab:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-owner-form-tab.is-active {
  background: var(--ui-fill-secondary, var(--ui-fill-tertiary));
  color: var(--el-text-color-primary);
}
.sdk-owner-form-tab.is-changed:not(.is-active) {
  color: var(--brand-link);
}
.sdk-owner-form-tab:focus-visible,
.sdk-owner-form-step-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.sdk-owner-form-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--brand-link, var(--el-color-primary));
}
.sdk-owner-form-tab-errors {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
}
.sdk-owner-form-tabpanel,
.sdk-owner-form-step-panel {
  min-width: 0;
}

.sdk-owner-form-stepbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}
.sdk-owner-form-step-item {
  display: flex;
  align-items: center;
  min-width: 0;
}
.sdk-owner-form-step-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.sdk-owner-form-step-btn:hover:not(:disabled) {
  border-color: var(--ui-border);
  color: var(--el-text-color-primary);
}
.sdk-owner-form-step-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.sdk-owner-form-step-item.is-active .sdk-owner-form-step-btn {
  border-color: var(--brand-link, var(--el-color-primary));
  background: var(--el-color-primary-light-9, var(--ui-fill-tertiary));
  color: var(--el-text-color-primary);
}
.sdk-owner-form-step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
}
.sdk-owner-form-step-item.is-active .sdk-owner-form-step-index {
  background: var(--el-color-primary);
  color: var(--on-primary, #fff);
}
.sdk-owner-form-step-item.is-complete .sdk-owner-form-step-index {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}
.sdk-owner-form-step-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--ui-divider);
}

@container sdk-owner-form (max-width: 720px) {
  .sdk-owner-form-cards.is-two-col,
  .sdk-owner-form-cards.is-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
