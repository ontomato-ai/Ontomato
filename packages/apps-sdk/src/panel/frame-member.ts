import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelOperationId } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { directReadDeclaration, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { readKey, type MemberData, type MemberDataState, type MemberInputs } from "./direct";
import type { PanelInstance } from "./instance";
import { adapterPart } from "./platform-objects";
import { stateObject, type PanelFieldValue } from "./state";

/*
 * A direct projection placed in a panel's frame (an older code panel using a declared projection): its components get
 * the same member data as in the platform's document, read here through this version's resource modules for the
 * projection's type — rows by its list, a record by its single read, a form by its form, an operation's description
 * from the coordinator — until every caller reads through the platform (design 4.2, step 4). A module that cannot
 * answer rejects; a shown datum says why.
 */

/** The object a datum is read from, given the member's inputs. */
function objectOf(data: DirectProjectionData, inputs: MemberInputs) {
  if (!("object" in data.source)) return null;
  const object = data.source.object;
  return stateObject(("literal" in object ? object.literal : inputs[object.input]) as PanelFieldValue | undefined);
}

export function frameMemberData(projection: DirectProjection, slot: string, instance: PanelInstance, inputs: () => MemberInputs): MemberData {
  /** The run input a read parameter takes its value from, when the projection declares one. */
  const runInput = (data: DirectProjectionData, parameter: string) => {
    const source = data.params[parameter];
    return source && "input" in source ? source.input : undefined;
  };

  async function answer(name: string, values: MemberInputs): Promise<MemberDataState> {
    const data = projection.data[name];
    if (!data) throw new Error(`Projection ${projection.id} declares no datum '${name}'`);
    const declaration = directReadDeclaration(projection, data);
    if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
    const object = objectOf(data, values);
    if ("object" in data.source && object === null) return { status: "awaiting" };
    let value: unknown;
    if (declaration.result === "panelRecordList" && "type" in data.source) {
      const rows = await adapterPart(data.source.type, "list")();
      value = rows.map(({ primaryKey, label, subtitle, fields }) => ({ primaryKey, label, ...(subtitle === undefined ? {} : { subtitle }), fields }));
    } else if (declaration.result === "panelRecord" && object) {
      const { primaryKey, label, subtitle, fields } = await adapterPart(object.className, "read")(object.primaryKey);
      value = { primaryKey, label, ...(subtitle === undefined ? {} : { subtitle }), fields };
    } else if (declaration.result === "panelFormDescription" && object) {
      const valuesInput = runInput(data, "values");
      const changedInput = runInput(data, "changedField");
      value = await adapterPart(object.className, "forms").describe({
        target: { kind: "object", objectType: object.className, primaryKey: object.primaryKey },
        ...(valuesInput && values[valuesInput] !== undefined ? { values: values[valuesInput] as Record<string, RuntimeJsonValue> } : {}),
        changedField: (changedInput ? values[changedInput] ?? null : null) as string | null,
      });
    } else if (declaration.result === "panelOperationDescriptor" && "operation" in data.source) {
      value = await instance.describeOperation(panelOperationId(slot, data.source.operation.split(".").pop()!));
    } else {
      throw new Error(`This version reads no '${data.read}' for datum '${name}' in a panel's frame`);
    }
    return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(value) };
  }

  return {
    use(name) {
      const state = shallowRef<MemberDataState>({ status: "loading" });
      let sequence = 0;
      const reread = () => {
        const reading = ++sequence;
        state.value = { status: "loading" };
        answer(name, inputs()).then(
          (result) => { if (reading === sequence) state.value = result; },
          (reason: unknown) => {
            if (reading === sequence) state.value = { status: "error", message: reason instanceof Error ? reason.message : String(reason) };
          },
        );
      };
      // An object an operation changed is read again where it is shown: its own datum, or a list of its type.
      const data = projection.data[name]!;
      watch(() => readKey(data, inputs()), reread, { immediate: true });
      onScopeDispose(instance.onObjectChanged((changed) => {
        const object = objectOf(data, inputs());
        if (!changed || (object && object.className === changed.objectType && object.primaryKey === changed.primaryKey)
          || ("type" in data.source && data.source.type === changed.objectType)) reread();
      }));
      return computed(() => state.value);
    },
    // A refusal the module raises (a draft the owner refuses, by field) reaches the form as it was raised.
    read: (name, run) => answer(name, { ...inputs(), ...run }),
  };
}
