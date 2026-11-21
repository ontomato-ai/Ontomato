import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormRequest, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { MemberDataState } from "./direct";
import type { PanelInstance } from "./instance";
import type { PanelMemberContext } from "./member";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { PlatformObjectRefusal } from "./platform-objects";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { MemberOperationsState } from "./member-operations";

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

/**
 * The form of a directly rendered member: an object's from its `form` datum, a new one's from its `createForm` datum
 * (the type's create form), and either saved through its owner's `save`.
 */
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
      const answer = await instance.writeOperation(instance.operationIdOf(member.key, save.name), { call: { target, input } });
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
      if (outcome.kind === "refusal") {
        // The owner names each refused field by its JSON Pointer.
        throw new PlatformObjectRefusal(outcome.message, Object.fromEntries((outcome.errors ?? []).map(({ field, message }) => [field, message])));
      }
      if (outcome.kind === "batch") throw new Error("A form's save is one call, not a batch");
      throw new Error(outcome.message);
    },
  };
}
