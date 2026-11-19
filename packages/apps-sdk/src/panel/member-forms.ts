import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelOperationId, type PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormRequest, PanelFormSaveInput } from "@ontomato/contracts/panel-projection";
import type { MemberDataState } from "./direct";
import type { PanelInstance } from "./instance";
import type { PanelMemberContext } from "./member";
import { PlatformObjectRefusal } from "./platform-objects";

/*
 * Where an owner form reads its description and saves: in a panel's frame, the resource module of the bound type; in a
 * directly rendered panel, the member's `form` datum, read by the instance through the platform, and the owner's own
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

/** The form of a directly rendered member: its `form` datum and its owner's `save`. */
export function memberFormSource(member: PanelMemberContext, instance: PanelInstance): FormSource {
  const data = member.projection.data.form;
  if (!data || !("object" in data.source) || !("input" in data.source.object))
    throw new Error(`Member '${member.key}' declares no form datum read from the object one of its inputs names`);
  const objectInput = data.source.object.input;
  /** The member input a read parameter takes its run value from, when the projection declares one. */
  const runInput = (parameter: string) => {
    const source = data.params[parameter];
    return source && "input" in source ? source.input : undefined;
  };

  return {
    async describe({ target, values, changedField }) {
      if (target.kind !== "object") throw new Error("A member's form edits the object its input names; it creates none");
      const run: Record<string, RuntimeJsonValue> = { [objectInput]: { className: target.objectType, primaryKey: target.primaryKey } };
      if (values !== undefined) {
        const valuesInput = runInput("values");
        if (!valuesInput) throw new Error(`Member '${member.key}' declares no values its owner checks the form with`);
        run[valuesInput] = values;
      }
      const changedInput = runInput("changedField");
      if (changedInput) run[changedInput] = changedField;
      const result = await member.data.read("form", run);
      if (result.status !== "ready") throw new MemberDataUnavailable(result);
      return result.value as PanelFormDescription;
    },
    async save(target, input) {
      if (target.kind !== "object") throw new Error("A member's form edits the object its input names; it creates none");
      const answer = await instance.writeOperation(panelOperationId(member.key, "save"), { call: { target, input } });
      if (answer.decision === "cancel") throw new Error("The save was cancelled");
      const { response } = answer;
      if (response.kind === "not-dispatched") throw new Error(response.message);
      const outcome = response.outcome;
      if (outcome === null) throw new Error("Whether the owner saved is not known");
      if (outcome.kind === "success") return { primaryKey: target.primaryKey };
      if (outcome.kind === "refusal") {
        // The owner names each refused field by its JSON Pointer.
        throw new PlatformObjectRefusal(outcome.message, Object.fromEntries((outcome.errors ?? []).map(({ field, message }) => [field, message])));
      }
      if (outcome.kind === "batch") throw new Error("A form's save is one call, not a batch");
      throw new Error(outcome.message);
    },
  };
}
