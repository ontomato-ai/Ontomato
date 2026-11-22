<script setup lang="ts">
import { projectionElement } from "../panel/projection-element";
import { computed, onMounted, provide, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElForm } from "element-plus/es/components/form/index";
import { confirmDanger } from "@ontomato/platform-shell";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { slotInputState, usePanelContext, useProjectionForm, useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import type { PanelFieldValue } from "../panel/state";
import { PlatformObjectRefusal, selectedKey } from "../panel/platform-objects";
import { changedPaths, fieldAt, movedPath, valueAt, withValueAt, withoutValueAt } from "../panel/form-values";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMember } from "../panel/member";
import {
  editedInput,
  evaluateMemberFormDraft,
  formTargetKey,
  memberFormSource,
  MemberDataUnavailable,
  type FormSource,
  type HeldMemberDraft,
} from "../panel/member-forms";
import { fieldControlKey, fieldControlsOf, formControlsKey } from "./form-controls";
import FormAdvancedSection from "./FormAdvancedSection.vue";
import FormFieldPlace from "./FormFieldPlace.vue";
import { fieldShowing } from "./form-placement";
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
 * through this form's field port, and is this form's value, dirty state and draft all the same.
 *
 * A draft an agent wrote reaches the form whose owner names the draft's operation for its target; the owner checks the
 * whole draft (one it refuses is refused whole, with the fields and the reasons) and the form shows it, the changed
 * fields marked and nothing written, until the reader saves or discards.
 *
 * A page that opens the form under a parent (an attribute created in its class, a relationship from its two ends) fixes
 * the fields that parent decides, through `fixedFields`: the form shows each with the page's value, read-only, and
 * submits it with every save; one fixed from a state that holds nothing (no parent chosen) is the owner's to edit as usual. The owner's form does not know which page it is in, so the page says it; the owner checks
 * the value as it checks any other.
 */
/**
 * What the form tells the page's code, which decides what the page shows next (a form's own buttons do not): the owner
 * saved it — the object it saved, or the one it created — or the reader discarded what it held.
 */
const props = withDefaults(defineProps<{
  /**
   * The fields the page fixes, by the owner's JSON Pointer path: each value comes from a field of the panel's state
   * (`{state}`, the value it holds, or with `path` the part of it that JSON Pointer names, such as an object
   * reference's `/primaryKey`) or is written here (`{literal}`). The form shows them read-only and submits them with
   * every save; while the state holds nothing, the field is not fixed.
   */
  fixedFields?: Record<string, { state: string; path?: string } | { literal: RuntimeJsonValue }>;
  /**
   * How top-level fields are arranged: `stacked` (default) draws each field's label above its control; `rows` draws
   * each top-level field as a settings row with its name and help on the left, its control and messages in the middle,
   * and Reset to default on the right when the owner declares a `defaultValue`.
   */
  layout?: "stacked" | "rows";
  /**
   * Where Save, Discard and the unsaved marker live: `footer` (default) keeps them sticky at the foot of the form;
   * `header` hands the form's draft to the enclosing page header and hides the form's own action bar, falling back to
   * the footer when no page header host is present (such as a nested panel or headerless preview).
   */
  actions?: "footer" | "header";
}>(), { fixedFields: () => ({}), layout: "stacked", actions: "footer" });
const emit = defineEmits<{
  /** The owner saved the form: the object it saved, or the one it created. */
  saved: [object: { className: string; primaryKey: string }];
  /** The reader discarded the changes the form held. */
  discarded: [];
  /** The reader cancelled creating a new object. */
  cancel: [];
}>();
defineSlots<{
  /** Projections that edit this form's fields, drawn with the current owner values before Save and Discard. */
  "after-fields"(): unknown;
}>();
const { t } = useI18n();
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
const key = computed(() => (
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
const target = computed<PanelFormTarget | null>(() => {
  if (key.value) return { kind: "object", objectType, primaryKey: key.value };
  return creates ? { kind: "draft" } : null;
});
const targetKey = formTargetKey;

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
const invalid = shallowRef<Readonly<Record<string, string>>>({});
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
const fixedValues = computed<Readonly<Record<string, RuntimeJsonValue>>>(() => Object.fromEntries(Object.entries(props.fixedFields).flatMap(
  ([path, from]): [string, RuntimeJsonValue][] => {
    if ("literal" in from) return [[path, from.literal]];
    const held = (panel.instance.state.values.value[from.state] ?? null) as RuntimeJsonValue;
    if (held === null) return [];
    if (from.path === undefined) return [[path, held]];
    const part = valueAt(held as PanelFormValues, from.path);
    if (part === undefined) throw new Error(`The fixed field ${path} reads ${from.path} of the state '${from.state}', which holds none`);
    return [[path, part]];
  })));
/** Whether a path is a fixed field or inside one. */
const isFixed = (path: string) => Object.keys(fixedValues.value).some((fixed) => path === fixed || path.startsWith(`${fixed}/`));
/** Values with the fixed fields as the page fixes them. */
function fixValues(next: PanelFormValues): PanelFormValues {
  return Object.entries(fixedValues.value).reduce((all, [path, value]) => withValueAt(all, path, value) as PanelFormValues, next);
}
/** An owner's description with the fixed fields read-only and their values the page's. */
function fixDescription(next: PanelFormDescription): PanelFormDescription {
  return {
    ...next,
    fields: next.fields.map((field) => (field.path in fixedValues.value ? { ...field, readOnly: true } : field)),
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
/** Changed values, or text a reader typed that is no value yet (JSON that does not parse): either is unsaved. */
const dirty = computed(() => opened.value !== null
  && (JSON.stringify(values.value) !== JSON.stringify(opened.value.values) || Object.keys(invalid.value).length > 0));
/**
 * The described fields this edit submits, by path: those the reader set (whatever value they end on) and those a received
 * draft wrote. The owner keeps a field not named here as it is, so a field nobody touched is never added. Whether a
 * value ended where it began does not matter: a field set back to the value shown is still submitted, and can be saved.
 */
const submitted = shallowRef<ReadonlySet<string>>(new Set());
/** Whether the form has something to save or discard: changed values, a received draft, or fields set on purpose. */
const canSettle = computed(() => dirty.value || panel.instance.draft.value?.slot === slot.slot || submitted.value.size > 0);
/** Whether the form is creating a new object (`createForm`, no existing object selected). */
const isCreate = computed(() => target.value?.kind === "draft");
/** Whether every non-hidden field in the owner's form description is read-only. */
const allReadOnly = computed(() => drawn.value.length > 0 && drawn.value.every((field) => field.readOnly));
/**
 * Count of distinct top-level fields modified in this draft (union of draft-marked `changed`, reader-edited
 * `submitted`, and unparseable `invalid` fields), guaranteed >= 1 whenever `canSettle` is true.
 */
const changedCount = computed(() => {
  const paths = new Set<string>([...changed.value, ...submitted.value]);
  for (const path of Object.keys(invalid.value)) {
    const described = fields.value.find((item) => path === item.path || path.startsWith(`${item.path}/`));
    paths.add(described ? described.path : path);
  }
  if (paths.size === 0 && opened.value) {
    for (const path of changedPaths(fields.value, opened.value.values, values.value)) paths.add(path);
  }
  return paths.size > 0 ? paths.size : (canSettle.value ? 1 : 0);
});

/** A draft this form took, for the target it addresses, shown once the form is on that target. */
let held: HeldMemberDraft | null = null;
/** A draft refusal received while this form was unmounted, shown on its baseline once mounted. */
let heldRefusal: { target: string; baseline: PanelFormDescription; reason: unknown } | null = null;
/** Whether this form component has mounted and performed its initial load. */
let mounted = false;
/** The target the form was last read for, so one change of target is one read. */
let loaded: string | null = null;

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

function load(next: PanelFormTarget | null) {
  const nextKey = targetKey(next);
  const reading = ++latestRead;
  loaded = nextKey;
  failure.value = null;
  askNext = null;
  if (next === null) {
    description.value = opened.value = ownerShown.value = ownerOpened.value = null;
    values.value = {};
    loading.value = false;
    return;
  }
  if (held?.target === nextKey) {
    adopt(held.baseline, held.checked, held.changed, held.submitted);
    return;
  }
  if (heldRefusal?.target === nextKey) {
    const refused = heldRefusal;
    heldRefusal = null;
    adopt(refused.baseline);
    showRefusal(refused.reason);
    return;
  }
  loading.value = true;
  void forms.describe({ target: next, changedField: null }).then(
    (answer) => { if (reading === latestRead && held?.target !== nextKey) adopt(answer); },
    (reason: unknown) => { if (reading === latestRead) fail(reason, () => load(next)); },
  );
}

function fail(reason: unknown, retry: () => void) {
  failure.value = { reason: reason instanceof Error ? reason : new Error(String(reason)), retry };
  loading.value = false;
}

onMounted(() => {
  mounted = true;
  load(target.value);
});
let pendingRefresh = false;
/**
 * The form is moving itself to show a draft it just took: what it held before is that earlier draft's, not the reader's,
 * so only changes the reader made themselves are asked about.
 */
let movingForDraft = false;
/**
 * The panel moved the form to another object (or to a new one) while it held the reader's unsaved changes: the reader is
 * asked first, as the platform asks before leaving a page. Keeping them puts the panel back on the object being edited;
 * discarding them is the form's own discard, and the form then shows where the panel moved.
 */
watch(target, async (next, previous) => {
  pendingRefresh = false;
  const forDraft = movingForDraft;
  movingForDraft = false;
  if (targetKey(next) === loaded) return;
  if ((forDraft ? dirty.value : canSettle.value) && !saving.value && previous !== null && targetKey(previous) === loaded) {
    const leave = panel.confirmLeaveUnsaved
      ? await panel.confirmLeaveUnsaved()
      : await confirmDanger(t("platform.formLeaveUnsaved"), t("platform.unsavedChanges"), {
          confirmButtonText: t("platform.discard"),
          cancelButtonText: t("platform.keepEditing"),
        });
    if (!leave) {
      moveTo(previous);
      return;
    }
    discard();
  }
  if (targetKey(target.value) !== loaded) load(target.value);
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
  const currentKey = targetKey(current);
  if (current === null || held?.target === currentKey || !description.value) return load(current);
  const reading = ++latestRead;
  failure.value = null;
  void forms.describe({ target: current, changedField: null }).then(
    (answer) => {
      if (reading !== latestRead || held?.target === currentKey) return;
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
useProjectionObjectRefresh((id) => id === key.value, () => {
  pendingRefresh = true;
  refreshWhenClean();
});
watch([canSettle, saving], refreshWhenClean);

// The page's fixed values follow the state they come from: what the form opened with and what it shows both take them.
// A field no longer fixed (its state emptied) is the owner's again, with the value the form opened with.
watch(fixedValues, (next, previous) => {
  if (!ownerOpened.value || !ownerShown.value) return;
  const baseline = ownerOpened.value.values;
  const released = Object.keys(previous).filter((path) => !(path in next));
  opened.value = fixDescription(ownerOpened.value);
  description.value = fixDescription(ownerShown.value);
  values.value = fixValues(released.reduce((all, path) => withValueAt(all, path, valueAt(baseline, path) ?? null), values.value));
});

/** One field changed: the form holds the value; a field the owner's form depends on has the owner asked again. */
function set(path: string, value: RuntimeJsonValue) {
  edit(path, withValueAt(values.value, path, value));
}
function remove(path: string) {
  edit(path, withoutValueAt(values.value, path));
}
/** The reader's edit of one field, as the values it leaves: submitted, and the owner asked again where it says so. */
function edit(path: string, next: PanelFormValues) {
  if (isFixed(path)) throw new Error(`The page fixes the field ${path}; it is not edited in the form`);
  // The described field the edit is in: a row's or an object's field submits the array or object it belongs to.
  const described = fields.value.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (described) submitted.value = new Set([...submitted.value, described.path]);
  values.value = next;
  editedAt.set(path, ++edits);
  const field = fieldAt(fields.value, path);
  if (field?.refreshOnChange) askOwner(path);
}

/** How many edits the reader has made, and when each path was last edited, counted in them. */
let edits = 0;
const editedAt = new Map<string, number>();
/** A question to the owner on its way, and the field changed since that the next question is about. */
const asking = ref(false);
let askNext: string | null = null;
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
  failure.value = null;
  const asked = target.value!;
  const askedAt = edits;
  const reading = latestRead;
  // The owner changes the fields for these edits; the opened reading, its revision and the discard baseline stay.
  void forms.describe({ target: asked, values: values.value, changedField }).then((answer) => {
    if (reading !== latestRead) return;
    ownerShown.value = answer;
    description.value = fixDescription(answer);
    values.value = [...editedAt].filter(([, at]) => at > askedAt).reduce((all, [edited]) => {
      const kept = valueAt(values.value, edited);
      return kept === undefined ? withoutValueAt(all, edited) : withValueAt(all, edited, kept);
    }, description.value.values);
    errors.value = fieldMessages(answer.errors);
  }, (reason) => {
    if (reading === latestRead) fail(reason, () => askOwner(changedField));
  }).finally(() => {
    asking.value = false;
    const again = askNext;
    askNext = null;
    if (again !== null) askOwner(again);
  });
}

/**
 * Rearranges the rows of an array field, `order[next] = previous`: the values, and the messages and marks inside each
 * row, which follow the row to its new index (one inside a removed row goes with it).
 */
function reorder(path: string, order: readonly number[]) {
  const rows = valueAt(values.value, path) as RuntimeJsonValue[];
  const moved = (byPath: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(byPath).flatMap(([at, message]) => {
    const next = movedPath(at, path, order);
    return next === null ? [] : [[next, message]];
  }));
  errors.value = moved(errors.value);
  invalid.value = moved(invalid.value);
  changed.value = new Set([...changed.value].flatMap((at) => movedPath(at, path, order) ?? []));
  set(path, order.map((index) => rows[index]!));
}

function markInvalid(path: string, message: string | null) {
  const { [path]: _, ...rest } = invalid.value;
  invalid.value = message === null ? rest : { ...rest, [path]: message };
}

/**
 * A read-only reason the owner gives more than one field (a function an action uses: every field) is the form's to say,
 * once above its fields; a field says only a reason of its own.
 */
const sharedReadOnlyReasons = computed<ReadonlySet<string>>(() => {
  const counts = new Map<string, number>();
  const visit = (fields: readonly PanelFormField[]) => {
    for (const field of fields) {
      if (field.readOnly && field.readOnlyReason) counts.set(field.readOnlyReason, (counts.get(field.readOnlyReason) ?? 0) + 1);
      if (field.control.kind === "object") visit(field.control.fields);
      if (field.control.kind === "object-array") visit(field.control.itemFields);
    }
  };
  visit(fields.value);
  return new Set([...counts].filter(([, count]) => count > 1).map(([reason]) => reason));
});

const topLevelPaths = computed(() => new Set(fields.value.map((field) => field.path)));
const hasDefaults = computed(() => fields.value.some((field) => field.control.kind !== "hidden" && field.defaultValue !== undefined));

provide(formControlsKey, {
  values,
  errors: computed(() => ({ ...errors.value, ...invalid.value })),
  changed,
  busy: saving,
  layout: computed(() => props.layout),
  hasDefaults,
  sharedReadOnlyReasons,
  isTopLevel: (path) => topLevelPaths.value.has(path),
  hasInvalid: (path) => Object.hasOwn(invalid.value, path),
  set,
  remove,
  reorder,
  invalid: markInvalid,
  fieldControl(path, itemPath) {
    const declared = Object.values(panel.manifest.members).some(({ formField }) =>
      formField?.slot === slot.slot && formField.path === path && formField.itemPath === itemPath);
    if (!declared) return undefined;
    return fieldControlsOf(panel.instance).get(fieldControlKey(slot.slot, path, itemPath)) ?? null;
  },
});

function consumePendingDraft() {
  const pending = member.formDraft?.takePending();
  if (!pending) return;
  if (pending.kind === "accepted") {
    heldRefusal = null;
    held = pending.held;
    if (!mounted) return;
    if (targetKey(target.value) === pending.held.target) load(target.value);
    else {
      movingForDraft = true;
      moveTo(pending.into);
    }
    return;
  }
  held = null;
  if (!mounted) {
    heldRefusal = { target: pending.target, baseline: pending.baseline, reason: pending.reason };
    return;
  }
  latestRead += 1;
  if (ownerOpened.value === null) adopt(pending.baseline);
  showRefusal(pending.reason);
}
if (member.formDraft) watch(() => member.formDraft!.pending.value, consumePendingDraft, { immediate: true });

useProjectionForm({
  handle: { fields, values, errors, changed, busy: saving, set },
  async receive(draft) {
    const evaluated = await evaluateMemberFormDraft(member, panel.instance, forms, draft);
    if (!evaluated) return null;
    if (evaluated.refusal !== null) {
      showRefusal(evaluated.refusal);
      return new Set();
    }
    heldRefusal = null;
    held = evaluated.held;
    if (targetKey(target.value) === targetKey(evaluated.into)) load(evaluated.into);
    else {
      movingForDraft = true;
      moveTo(evaluated.into);
    }
    return evaluated.marked;
  },
  submit: () => write(),
  dirty: () => dirty.value,
  discard,
});

function resetDraft(reopenWhenUnfieldedRefusal: boolean) {
  const refused = refusal.value;
  const reopen = reopenWhenUnfieldedRefusal && refused instanceof PlatformObjectRefusal &&
    Object.keys(refused.fields).length === 0 && Object.keys(refused.savedFields).length === 0;
  held = null;
  heldRefusal = null;
  if (ownerOpened.value) adopt(ownerOpened.value);
  if (reopen) load(target.value);
  void panel.instance.settleDraft(slot.slot).catch(showRefusal);
}

function discard() {
  resetDraft(true);
  emit("discarded");
}

/** The reader's Discard: what they have not saved is thrown away only once they say so (原页面对照《智能体设置》). */
async function confirmDiscard() {
  const confirmed = await confirmDanger(t("platform.formDiscardConfirm"), t("platform.discard"), {
    confirmButtonText: t("platform.discard"),
    cancelButtonText: t("platform.keepEditing"),
  });
  if (confirmed) discard();
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
  try {
    await panel.instance.forms.submit(slot.slot);
  } catch (reason) {
    // The operation also rejects for programmatic callers. The reader sees the same refusal in the form.
    showRefusal(reason);
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
    const field = fieldShowing(fields.value, path);
    if (field === null) said.push(message);
    else onFields.add(field);
  }
  return { fields: [...onFields], said };
});
const formElement = ref<HTMLElement | null>(null);
/** Takes the reader to the first field, in the form's order, that the refusal's messages are on. */
function showFirstRefused() {
  const refused = new Set(refusalFoot.value!.fields);
  [...formElement.value!.querySelectorAll<HTMLElement>("[data-field]")].find((item) => refused.has(item.dataset.field!))!
    .scrollIntoView({ block: "center" });
}

function showRefusal(reason: unknown) {
  refusal.value = reason instanceof Error ? reason : new Error(String(reason));
  errors.value = reason instanceof PlatformObjectRefusal ? reason.fields : {};
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
  const stillChanged = changedPaths(fields.value, opened.value.values, values.value);
  const keep = (path: string) => !savedPaths.has(path) || stillChanged.has(path);
  submitted.value = new Set([...submitted.value].filter(keep));
  changed.value = new Set([...changed.value].filter(keep));
  if (held) held = { ...held, baseline, submitted: submitted.value, changed: changed.value };
}

/**
 * Writes the form through its owner — the selected object's update, or the create — with the revision it was read at
 * where the owner has one. An owner that refuses has its reason shown beside the form and its field messages on the
 * fields it named; nothing is retried, and the reader's form stays as they left it. A create selects the object the
 * owner created; every projection showing the saved object reads it again, this form included, at its new revision.
 */
async function write(): Promise<unknown> {
  const into = target.value;
  if (!into) throw new Error("This form edits one object, and none is selected");
  if (failure.value) throw failure.value.reason;
  if (loading.value || asking.value) throw new Error(t("common.loading"));
  if (Object.keys(invalid.value).length) throw new Error(t("platform.formFixInvalid"));
  saving.value = true;
  refusal.value = null;
  errors.value = {};
  try {
    const revision = opened.value!.revision;
    const saved = await forms.save(into, {
      values: values.value, submittedFields: [...new Set([...submitted.value, ...Object.keys(fixedValues.value)])],
      ...(revision === undefined ? {} : { revision }),
    });
    submitted.value = new Set();
    held = null;
    ownerOpened.value = { ...ownerShown.value!, values: values.value };
    opened.value = { ...description.value!, values: values.value };
    changed.value = new Set();
    if (into.kind === "draft") moveTo({ kind: "object", objectType, primaryKey: saved.primaryKey });
    emit("saved", { className: objectType, primaryKey: saved.primaryKey });
    // The save went through the coordinator, whose receipt reaches the host's one refresh port and is read again there.

    // A received draft ends with its save; a create draft first records the object it created. The save stands either
    // way: a record that fails is shown with the form, on the object the owner created.
    await panel.instance.settleDraft(slot.slot, into.kind === "draft" ? saved.primaryKey : undefined);
    return saved;
  } catch (reason) {
    if (reason instanceof PlatformObjectRefusal && targetKey(target.value) === targetKey(into)) takeSavedFields(reason);
    showRefusal(reason);
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
 * When `actions: "header"` is configured and the enclosing host draws a page header, hand the form's Save/Discard draft
 * to the page header and hide the form's own footer bar; otherwise keep the footer bar so the form stays usable in
 * nested panels, headerless previews, and sandboxed frames.
 */
const usesHeaderActions = computed(() => props.actions === "header" && panel.registerHeaderDraft !== undefined);
watch(usesHeaderActions, (inHeader, _previous, onCleanup) => {
  if (!inHeader || !panel.registerHeaderDraft) return;
  const stop = panel.registerHeaderDraft(slot.slot, () => (
    shown.value.status === "ready"
      ? {
          dirty: canSettle.value,
          saving: saving.value,
          save: () => { if (!asking.value) void saveFromForm(); },
          discard: () => { void confirmDiscard(); },
        }
      : null
  ));
  onCleanup(stop);
}, { immediate: true });

/**
 * Bottom action bar visibility:
 * - Hidden when the enclosing page header carries the draft (`actions: "header"`).
 * - Always pinned in create mode (`Cancel` / `Create`).
 * - Never shown on an all-read-only edit form with no pending changes.
 * - On an edit form, appears only once there are changes to settle (`Discard` / `Save`).
 */
const showActionBar = computed(() => {
  if (usesHeaderActions.value) return false;
  if (isCreate.value) return true;
  if (allReadOnly.value && !canSettle.value) return false;
  return canSettle.value;
});

/** The fields a received draft changed, by the owner's labels, in the form's order — those other slots draw included. */
const changedLabels = computed(() => fields.value.filter((field) => changed.value.has(field.path)).map((field) => field.label).join(", "));
</script>

<template>
  <div ref="formElement" class="sdk-owner-form" :class="{ 'sdk-owner-form-rows': props.layout === 'rows' }">
    <data-state :result="shown" :labels="labels">
    <!-- The panel frame is sandboxed without allow-forms, so the browser drops a native form submission before any
         submit handler runs: the reader's save is the button's own click. -->
    <el-form label-position="top" class="sdk-owner-form-inner">
      <div class="sdk-owner-form-body">
        <p v-for="reason in sharedReadOnlyReasons" :key="reason" class="sdk-owner-form-readonly" role="note">{{ reason }}</p>
        <div v-if="sectionGroups" class="sdk-owner-form-sectioned">
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
      <div v-if="showActionBar" class="sdk-owner-form-actions">
        <span v-if="canSettle" class="sdk-owner-form-unsaved" role="status">
          {{ t("platform.formChangedCount", { count: changedCount }, changedCount) }}
        </span>
        <template v-if="isCreate">
          <el-button :disabled="saving" @click="cancelCreate">{{ t("platform.cancel") }}</el-button>
          <el-button type="primary" :disabled="asking" :loading="saving" @click="saveFromForm">{{ t("platform.create") }}</el-button>
        </template>
        <template v-else>
          <el-button :disabled="saving || !canSettle" @click="confirmDiscard">{{ t("platform.discard") }}</el-button>
          <el-button type="primary" :disabled="!canSettle || asking" :loading="saving" @click="saveFromForm">{{ t("platform.save") }}</el-button>
        </template>
      </div>
    </el-form>
    </data-state>
  </div>
</template>

<style scoped>
/* Save and Discard stay in reach at the foot of the view however long the form, both when filling a definite box
   (the body scrolls above them) and when flowing down the page (they stick to the enclosing content box). */
.sdk-owner-form-actions {
  flex: 0 0 auto;
  position: sticky;
  bottom: 0;
  z-index: 1;
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
</style>
