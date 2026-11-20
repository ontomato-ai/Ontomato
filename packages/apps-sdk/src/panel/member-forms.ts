import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelOperationId, type PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormRequest, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { MemberDataState } from "./direct";
import type { PanelInstance } from "./instance";
import { readRun, type PanelMemberContext } from "./member";
import { PlatformObjectRefusal } from "./platform-objects";

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
    const takes = (param: string) => { const source = data.params[param]; return source !== undefined && "input" in source; };
    if (values !== undefined && !takes("values"))
      throw new Error(`Member '${member.key}' declares no values its owner checks the form with`);
    const run: Record<string, RuntimeJsonValue> = {
      ...readRun(projection, name, { ...(values === undefined ? {} : { values }), changedField }),
    };
    if (target.kind === "object") {
      if (!("object" in data.source) || !("input" in data.source.object))
        throw new Error(`Member '${member.key}' reads its form from no object one of its inputs names`);
      run[data.source.object.input] = { className: target.objectType, primaryKey: target.primaryKey };
    }
    return { name, run, type: "type" in data.source ? data.source.type : null };
  }

  return {
    async describe({ target, values, changedField }) {
      const { name, run } = formRead(target, values, changedField);
      const result = await member.data.read(name, run);
      if (result.status !== "ready") throw new MemberDataUnavailable(result);
      return result.value as PanelFormDescription;
    },
    async save(target, input) {
      const answer = await instance.writeOperation(panelOperationId(member.key, "save"), { call: { target, input } });
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
