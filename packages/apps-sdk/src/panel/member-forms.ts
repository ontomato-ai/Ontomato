import { readonly, shallowRef, type Ref } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PageDraft } from "@ontomato/contracts/page-draft";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelMemberItemKey } from "@ontomato/contracts/panel-object-ref";
import type { PanelFormDescription, PanelFormRequest, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { MemberDataState } from "./direct";
import type { PanelInstance } from "./instance";
import type { PanelMemberContext } from "./member";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { PlatformObjectRefusal, selectedKey } from "./platform-objects";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { MemberOperationsState } from "./member-operations";
import { slotInputState } from "./context";
import { changedPaths, valueAt } from "./form-values";
import { projectionElement } from "./projection-element";
import type { PanelFieldValue } from "./state";

/*
 * Where an owner form reads its description and saves: in a panel's frame, the resource module of the bound type; in a
 * directly rendered panel, the member's `form` (or `createForm`) datum, read by the instance through the platform, and the owner's own
 * save operation, received by the platform's coordinator as an agent's call is. The form itself is the same either way.
 */

/** What an owner form asks of where it reads and saves. */
export interface FormSource {
  describe(request: PanelFormRequest): Promise<PanelFormDescription>;
  save(target: PanelFormTarget, input: PanelFormSaveInput): Promise<{ primaryKey: string }>;
}

/** The input a form's `form` datum reads its object from: the panel state the edited object is held in. */
export function editedInput(projection: ProductProjection): string | undefined {
  const data = projection.data.form;
  return data && "object" in data.source && "input" in data.source.object ? data.source.object.input : undefined;
}

/**
 * The member's form save as its owner admits it now: the one of its projection's operations the owner describes as a
 * form's save, under the projection's name for it, with the target the owner admits — the edited object, or a new one.
 * None while the operations are read, or while the owner admits no save (nothing chosen, and nothing to create).
 */
export function formSave(state: MemberOperationsState): { name: string; descriptor: PanelOwnerOperationDescriptor } | null {
  if (state.status !== "ready") return null;
  const saves = Object.entries(state.value).filter(([, descriptor]) => descriptor.kind === "form.save");
  if (saves.length > 1) throw new Error(`A form saves through one operation; its projection names ${saves.map(([name]) => name).join(", ")}`);
  const [found] = saves;
  return found ? { name: found[0], descriptor: found[1] } : null;
}

/** A datum the owner did not answer with a value: no permission, or the reason it could not be read. */
export class MemberDataUnavailable extends Error {
  constructor(readonly state: Exclude<MemberDataState, { status: "ready" }>) {
    super(state.status === "error" ? state.message : state.status);
    this.name = "MemberDataUnavailable";
  }
}

/** A checked draft held for one form target until the form shows that target. */
export interface HeldMemberDraft {
  readonly target: string;
  readonly baseline: PanelFormDescription;
  readonly checked: PanelFormDescription;
  readonly changed: ReadonlySet<string>;
  readonly submitted: ReadonlySet<string>;
}

/** A draft result handed from a member-level draft receiver to ObjectForm once ObjectForm mounts (or finishes mounting). */
export type PendingMemberFormDraft =
  | { readonly kind: "accepted"; readonly into: PanelFormTarget; readonly held: HeldMemberDraft }
  | { readonly kind: "refused"; readonly target: string; readonly baseline: PanelFormDescription; readonly reason: unknown };

export interface MemberFormDraftChannel {
  readonly pending: Readonly<Ref<PendingMemberFormDraft | null>>;
  setPending(next: PendingMemberFormDraft | null): void;
  takePending(): PendingMemberFormDraft | null;
}

export function createMemberFormDraftChannel(): MemberFormDraftChannel {
  const pending = shallowRef<PendingMemberFormDraft | null>(null);
  return {
    pending: readonly(pending) as Readonly<Ref<PendingMemberFormDraft | null>>,
    setPending(next) { pending.value = next; },
    takePending() {
      const current = pending.value;
      if (current !== null) pending.value = null;
      return current;
    },
  };
}

/** A comparable key for a form target: the object's primary key, "draft" for a create form, or empty for none. */
export const formTargetKey = (value: PanelFormTarget | null) =>
  value === null ? "" : value.kind === "object" ? value.primaryKey : "draft";

/** Resolves a form member's bound state, current target and move helper from the projection and manifest. */
export function formTargetState(member: PanelMemberContext, instance: PanelInstance) {
  const objectType = projectionElement(member.projection).id;
  const editInput = editedInput(member.projection);
  const creates = Object.values(member.projection.data).some((data) => data.read === "createForm");
  const state = editInput === undefined ? null : slotInputState(instance.manifest, member.key, editInput);
  const currentKey = () => (
    state !== null
      ? selectedKey(instance.state.values.value[state])
      : editInput === undefined
        ? null
        : selectedKey(member.inputs.value[editInput] as PanelFieldValue | undefined)
  );
  const currentTarget = (): PanelFormTarget | null => {
    const key = currentKey();
    if (key) return { kind: "object", objectType, primaryKey: key };
    return creates ? { kind: "draft" } : null;
  };
  const moveTo = (next: PanelFormTarget) => {
    if (state === null) return;
    instance.state.set(state, next.kind === "object" ? { className: objectType, primaryKey: next.primaryKey } : null);
  };
  return { objectType, editInput, creates, state, currentKey, currentTarget, moveTo };
}

export interface EvaluatedMemberFormDraft {
  readonly into: PanelFormTarget;
  readonly baseline: PanelFormDescription;
  readonly marked: ReadonlySet<string>;
  readonly held: HeldMemberDraft | null;
  readonly refusal: unknown | null;
}

/** Whether two canonical row `itemKey` values identify the same row (`string` primaryKey or `{ className, primaryKey }`). */
export function itemKeysEqual(a: PanelMemberItemKey, b: PanelMemberItemKey): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.className === b.className && a.primaryKey === b.primaryKey;
}

/**
 * Checks whether a draft belongs to this form member and, if so, asks the owner to validate it against the target form.
 * Shared by mounted `ObjectForm` instances and member-level draft receivers for unmounted forms so both follow one rule.
 */
export async function evaluateMemberFormDraft(
  member: PanelMemberContext,
  instance: PanelInstance,
  forms: FormSource,
  draft: PageDraft<Record<string, unknown>>,
): Promise<EvaluatedMemberFormDraft | null> {
  const rowItemKey = member.rowItemKey;
  const draftItemKey = draft.target.itemKey;
  if (rowItemKey !== undefined) {
    // Row-attached form: only claim drafts targeting this exact embedded row (`itemKey` present and equal).
    if (draftItemKey === undefined || !itemKeysEqual(rowItemKey, draftItemKey)) return null;
  } else if (draftItemKey !== undefined) {
    // Non-row form: never hijack drafts addressed to an embedded row (`itemKey` present).
    return null;
  }
  const { objectType, creates, state, currentTarget } = formTargetState(member, instance);
  // A draft for an object of another type is another form's: its owner is never asked about an object it does not hold.
  if (draft.target.objectType !== objectType) return null;
  const create = draft.target.id === undefined;
  // A create draft is the form's of this type that creates (a page may keep a separate form for new objects) — unless
  // an earlier save already created its object, which it then addresses.
  if (create && !creates && !draft.created) return null;
  // The target whose owner form names the draft's operation: the create target of a form that creates, otherwise the
  // object the draft (or its earlier save) addresses.
  const named: PanelFormTarget = create && creates
    ? { kind: "draft" }
    : { kind: "object", objectType, primaryKey: draft.target.id ?? draft.created!.id };
  // A create draft saved once addresses the object it created from then on.
  const into: PanelFormTarget = draft.created ? { kind: "object", objectType, primaryKey: draft.created.id } : named;
  // A form whose input is not bound to panel state (or a row-attached form mounted under a specific host row) cannot
  // move to another target; it only takes drafts for its own.
  if ((state === null || rowItemKey !== undefined) && formTargetKey(currentTarget()) !== formTargetKey(into)) return null;
  const namedForm = await forms.describe({ target: named, changedField: null });
  if (namedForm.save.draftOperation !== draft.operation) return null;
  const baseline = formTargetKey(into) === formTargetKey(named) ? namedForm : await forms.describe({ target: into, changedField: null });
  // The draft is this form's from here on: an owner that cannot check its values at all (a value it cannot read) has
  // not taken it either, and that is said on this form, as a refusal is; the rest of the panel goes on.
  let checked: PanelFormDescription;
  try {
    checked = await forms.describe({ target: into, values: draft.form as PanelFormValues, changedField: null });
  } catch (reason) {
    return { into, baseline, marked: new Set(), held: null, refusal: reason };
  }
  // A draft the owner does not accept is refused whole, with the fields and the reasons — said here, on this form, and
  // nothing of it taken; it is this form's to say, so the rest of the panel goes on as it was.
  if (checked.errors.length) {
    return {
      into,
      baseline,
      marked: new Set(),
      held: null,
      refusal: new PlatformObjectRefusal(checked.errors[0]!.message, fieldMessages(checked.errors)),
    };
  }
  const marked = changedPaths(checked.fields, baseline.values, checked.values);
  // What the draft wrote, by its presence: a field it left out is not submitted, though the owner's check returns it.
  const written = new Set(checked.fields.filter((item) => valueAt(draft.form as PanelFormValues, item.path) !== undefined).map((item) => item.path));
  // A draft is held for what it changed and for what it wrote: one that writes a field as it already is still submits it.
  const held = marked.size || written.size
    ? { target: formTargetKey(into), baseline, checked, changed: marked, submitted: written }
    : null;
  return { into, baseline, marked, held, refusal: null };
}

/**
 * The form of a directly rendered member: an object's from its `form` datum, a new one's from its `createForm` datum
 * (the type's create form), and either saved through its owner's `save`.
 */
function fieldMessages(errors: readonly { field: string; message: string }[] = []) {
  return Object.fromEntries(errors.map(({ field, message }) => [field, message]));
}

export function memberFormSource(member: PanelMemberContext, instance: PanelInstance): FormSource {
  const { projection } = member;
  /** The datum a target's form is read from, and the run inputs that read it for the target and the form's values. */
  function formRead(target: PanelFormTarget, values: PanelFormValues | undefined, changedField: string | null) {
    const name = target.kind === "object" ? "form" : "createForm";
    const data = projection.data[name];
    if (!data) throw new Error(`Member '${member.key}' declares no ${name} datum: it ${target.kind === "object" ? "edits no object" : "creates nothing"}`);
    const params: Record<string, RuntimeJsonValue> = { ...(values === undefined ? {} : { values }), changedField };
    const inputs: Record<string, RuntimeJsonValue> = {};
    if (target.kind === "object") {
      if (!("object" in data.source) || !("input" in data.source.object))
        throw new Error(`Member '${member.key}' reads its form from no object one of its inputs names`);
      inputs[data.source.object.input] = { className: target.objectType, primaryKey: target.primaryKey };
    }
    return { name, params, inputs, type: "type" in data.source ? data.source.type.id : null };
  }

  return {
    async describe({ target, values, changedField }) {
      const { name, params, inputs } = formRead(target, values, changedField);
      const result = await member.data.read(name, params, inputs);
      if (result.status !== "ready") throw new MemberDataUnavailable(result);
      return result.value as PanelFormDescription;
    },
    async save(target, input) {
      const save = formSave(member.operations.value);
      if (!save) throw new Error(`The owner admits no save for the form in member '${member.key}' now`);
      const answer = member.rowOperation
        ? await member.rowOperation.run(save.name, { ...input })
        : await instance.writeOperation(instance.operationIdOf(member.key, save.name), { call: { target, input } });
      if (answer.decision === "cancel") throw new Error("The save was cancelled");
      const { response } = answer;
      if (response.kind === "not-dispatched") throw new Error(response.message);
      const outcome = response.outcome;
      if (outcome === null) throw new Error("Whether the owner saved is not known");
      if (outcome.kind === "success") {
        if (target.kind === "object") return { primaryKey: target.primaryKey };
        // A new object is the one of the form's type the owner reports it created.
        const { type } = formRead(target, undefined, null);
        const created = (outcome.affected?.objects ?? []).filter((object) => object.objectType === type);
        if (created.length !== 1) throw new Error("The owner did not report the one object it created");
        return { primaryKey: created[0]!.primaryKey };
      }
      if (outcome.kind === "refusal" || outcome.kind === "failure") {
        // The owner names each refused field by its JSON Pointer.
        throw new PlatformObjectRefusal(outcome.message, fieldMessages(outcome.errors), undefined, outcome.savedFields);
      }
      if (outcome.kind === "batch") throw new Error("A form's save is one call, not a batch");
      throw new Error(outcome.message);
    },
  };
}
