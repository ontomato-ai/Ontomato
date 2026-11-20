import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelOperationId, type PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { directReadDeclaration, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { awaitsInputs, paramValues, readKey, type MemberData, type MemberDataState, type MemberInputs } from "./direct";
import type { PanelInstance } from "./instance";
import { adapterPart, type PlatformGraphNeighborsQuery, type PlatformObjectRecord } from "./platform-objects";

type PanelObjectValue = NonNullable<ReturnType<typeof stateObject>>;
import { stateObject, type PanelFieldValue } from "./state";

/*
 * A direct projection placed in a panel's frame (an older code panel using a declared projection): its components get
 * the same member data as in the platform's document, read here through this release's resource modules for the
 * projection's type — rows by its list, a record by its single read, a form by its form (a create form for the type),
 * choices by its options, the ontology graph by its graph reads, a registered chart's drawing and output by its source
 * card's metric reads — and an operation's description from the coordinator, until every caller reads through the
 * platform (design 4.2, step 4). A datum waits, unread, for its object or a parameter its owner requires. A module that
 * cannot answer rejects; a shown datum says why.
 */

/** The graph reads of a type's module. */
const graphOf = (type: string) => adapterPart(type, "graph");

/** The object a datum is read from, given the member's inputs. */
function objectOf(data: DirectProjectionData, inputs: MemberInputs) {
  if (!("object" in data.source)) return null;
  const object = data.source.object;
  return stateObject(("literal" in object ? object.literal : inputs[object.input]) as PanelFieldValue | undefined);
}

/** What a record read declares of a module's record: the owner's identity, label, fields and their names. */
function panelRecord({ primaryKey, label, subtitle, fields, fieldLabels }: PlatformObjectRecord) {
  return { primaryKey, label, ...(subtitle === undefined ? {} : { subtitle }), fields, ...(fieldLabels === undefined ? {} : { fieldLabels }) };
}

/** The form a type's module describes: an object's, or the type's create form (a draft) when the datum reads the type. */
function formOf(data: DirectProjectionData, object: PanelObjectValue | null, params: Record<string, unknown>) {
  const target: PanelFormTarget = object
    ? { kind: "object", objectType: object.className, primaryKey: object.primaryKey }
    : { kind: "draft" };
  const objectType = object ? object.className : (data.source as { type: { id: string } }).type.id;
  return adapterPart(objectType, "forms").describe({
    target,
    ...(params.values === undefined || params.values === null ? {} : { values: params.values as Record<string, RuntimeJsonValue> }),
    changedField: (params.changedField ?? null) as string | null,
  });
}

export function frameMemberData(projection: DirectProjection, slot: string, instance: PanelInstance, inputs: () => MemberInputs): MemberData {
  /** What the member's component set itself; a frame's resource module takes it with the author's parameters. */
  const own = () => instance.ownParams(slot);
  async function answer(name: string, values: MemberInputs): Promise<MemberDataState> {
    const data = projection.data[name];
    if (!data) throw new Error(`Projection ${projection.id} declares no datum '${name}'`);
    const declaration = directReadDeclaration(projection, data);
    if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
    if (awaitsInputs(projection, data, values, own())) return { status: "awaiting" };
    const object = objectOf(data, values);
    const params = paramValues(projection, data, values, own());
    const type = "type" in data.source ? data.source.type.id : object?.className;
    let value: unknown;
    switch (declaration.result) {
      case "panelRecordList":
        value = (await adapterPart(type!, "list")()).map(panelRecord);
        break;
      case "panelRecord":
        value = panelRecord(await adapterPart(object!.className, "read")(object!.primaryKey));
        break;
      case "panelFormDescription":
        value = await formOf(data, object, params);
        break;
      case "panelOperationDescriptor":
        value = await instance.describeOperation(panelOperationId(slot, (data.source as { operation: { id: string } }).operation.id.split(".").pop()!));
        break;
      case "panelOptionList": {
        const options = adapterPart(type!, "options");
        value = data.read === "resolve"
          ? { options: await options.resolve(params.values as RuntimeJsonValue[]) }
          : await options.list({
            ...(params.keyword ? { keyword: params.keyword as string } : {}),
            ...(params.page ? { page: params.page as { number: number; size: number } } : {}),
          });
        break;
      }
      case "panelGraphSchema":
        value = await graphOf(type!).schema!();
        break;
      case "panelGraphCounts":
        value = { counts: await graphOf(type!).counts!() };
        break;
      case "panelGraphStart":
        value = { node: await graphOf(type!).start!() };
        break;
      case "panelGraphNeighbors":
        value = await graphOf(type!).neighbors({
          node: params.node as unknown as PanelObjectValue,
          ...(params.relationKinds ? { relationKinds: params.relationKinds as string[] } : {}),
          ...(params.layers ? { layers: params.layers as PlatformGraphNeighborsQuery["layers"] } : {}),
        });
        break;
      case "panelOntologyObjects": {
        const page = params.page as { number: number; size: number } | null;
        value = await graphOf(type!).objects!({
          type: params.type as string,
          ...(params.keyword ? { keyword: params.keyword as string } : {}),
          ...(page ? { page: page.number, pageSize: page.size } : {}),
        });
        break;
      }
      case "chartTemplate":
      case "metricOutput": {
        // A frame reaches a chart's source only through the registered chart projection it read.
        if (!("metricId" in projection))
          throw new Error(`Only a registered chart reads '${data.read}' in a panel's frame`);
        const metric = adapterPart(object!.className, "metric");
        value = declaration.result === "chartTemplate"
          ? await metric.template(projection)
          : await metric.result(projection, params as Record<string, RuntimeJsonValue>);
        break;
      }
    }
    return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(value) as RuntimeJsonValue };
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
      watch(() => readKey(projection, data, inputs(), own()), reread, { immediate: true });
      onScopeDispose(instance.onObjectChanged((changed) => {
        const object = objectOf(data, inputs());
        if (!changed || (object && object.className === changed.objectType && object.primaryKey === changed.primaryKey)
          || ("type" in data.source && data.source.type.id === changed.objectType)) reread();
      }));
      return computed(() => state.value);
    },
    // A refusal the module raises (a draft the owner refuses, by field) reaches the form as it was raised.
    read: (name, run) => answer(name, { ...inputs(), ...run }),
  };
}
