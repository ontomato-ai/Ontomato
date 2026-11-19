import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelReadOperationInputs } from "@ontomato/contracts/panel-manifest";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { valueAt } from "./form-values";
import type { PanelInstance } from "./instance";

/*
 * The input of a read-only operation (a trial run) as this panel instance supplies it: the draft is the form the owner's
 * operation targets, and the parameters and the binding come from where the slot's declaration says
 * (`readOperationInputs.<operation>`) — a panel state field or a field of a form in this panel, read at the moment of
 * the call. Nothing is kept beside the state and the forms, and the owner checks what it receives.
 */

type Source = Exclude<PanelReadOperationInputs["parameters"], { fields: unknown }>;

/** The shape of `panelReadOperationInputSchema`; the owner's operation checks the values it receives. */
export interface ReadOperationInput {
  draft: PanelFormValues;
  parameters: PanelFormValues;
  bindingId?: string;
}

/** The value one declared source holds now. */
function sourceValue(instance: PanelInstance, source: Source): RuntimeJsonValue | undefined {
  if ("state" in source) return instance.state.values.value[source.state] as RuntimeJsonValue | undefined;
  const form = instance.forms.handle(source.formField.slot);
  if (!form) throw new Error(`Slot '${source.formField.slot}' holds no form yet`);
  return valueAt(form.values.value, source.formField.path);
}

/** The input of the operation `operation` of the projection in `slot`, with `draft` the values of the form it targets. */
export function readOperationInput(instance: PanelInstance, slot: string, operation: string, draft: PanelFormValues): ReadOperationInput {
  const declared = instance.manifest.slots[slot]?.readOperationInputs?.[operation];
  if (!declared) throw new Error(`Slot '${slot}' declares no inputs for its read operation '${operation}'`);
  const { parameters, bindingId } = declared;
  // A source that holds nothing yet is left out, never turned into null; the owner says what it requires.
  const present = (entries: [string, RuntimeJsonValue | undefined][]) =>
    Object.fromEntries(entries.filter((entry): entry is [string, RuntimeJsonValue] => entry[1] !== undefined));
  const values = "fields" in parameters
    ? present(Object.entries(parameters.fields).map(([name, source]) => [name, sourceValue(instance, source)]))
    : sourceValue(instance, parameters);
  const binding = bindingId && sourceValue(instance, bindingId);
  return { draft, parameters: values as PanelFormValues, ...(binding === undefined ? {} : { bindingId: binding as string }) };
}
