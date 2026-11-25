import { computed, onScopeDispose, shallowRef, watch } from "vue";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { directReadDeclaration, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { awaitsInputs, memberReadKey, paramValues, readMemberDatum, runValues, type MemberData, type PanelReadPort, type MemberDataState, type MemberInputs, type MemberReadyData } from "./direct";
import type { PanelInstance } from "./instance";
import { adapterPart, registeredPlatformObjects, type PlatformGraphNeighborsQuery, type PlatformObjectRecord } from "./platform-objects";

type PanelObjectValue = NonNullable<ReturnType<typeof stateObject>>;
import { stateObject, type PanelFieldValue } from "./state";

/*
 * A direct projection placed in a panel's frame (an older code panel using a declared projection): its components get
 * the same member data as in the platform's document, read here through this release's resource modules for the
 * projection's type — rows by its list, a record by its single read, a form by its form (a create form for the type),
 * choices by its options, the ontology graph by its graph reads, a registered chart's drawing and output by its source
 * card's metric reads — until every caller reads through the platform (design 4.2, step 4). A datum waits, unread, for its object or a parameter its owner requires. A module that
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
function panelRecord({ primaryKey, className, label, subtitle, fields, fieldLabels, tones, tags, highlights }: PlatformObjectRecord) {
  return {
    primaryKey,
    ...(className === undefined ? {} : { className }),
    label,
    ...(subtitle === undefined ? {} : { subtitle }),
    fields,
    ...(fieldLabels === undefined ? {} : { fieldLabels }),
    ...(tones === undefined ? {} : { tones }),
    ...(tags === undefined ? {} : { tags }),
    ...(highlights === undefined ? {} : { highlights }),
  };
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

export function frameMemberData(
  projection: DirectProjection,
  slot: string,
  instance: PanelInstance,
  inputs: () => MemberInputs,
  read: PanelReadPort,
  ownParams?: () => MemberInputs,
): MemberData {
  /** What the member's component set itself; a frame's resource module takes it with the author's parameters. */
  const own = ownParams ?? (() => instance.ownParams(slot));
  const placement = instance.manifest.members[slot]!;
  async function answer(name: string, values: MemberInputs, ownRun: MemberInputs = own()): Promise<MemberDataState> {
    const data = projection.data[name];
    if (!data) throw new Error(`Projection ${projection.id} declares no datum '${name}'`);
    const declaration = directReadDeclaration(projection, data);
    if (!declaration) throw new Error(`No owner registers the read '${data.read}' that datum '${name}' names`);
    if (awaitsInputs(projection, data, placement, values, ownRun)) return { status: "awaiting" };
    const object = objectOf(data, values);
    const params = paramValues(projection, data, placement, values, ownRun);
    const type = "type" in data.source ? data.source.type.id : object?.className;
    // A type this release has no resource module for is read where a directly rendered panel reads it: through the
    // platform's read entry, from its owner's one adapter. A type moves there when its page does and its module goes.
    if (type !== undefined && !registeredPlatformObjects().includes(type))
      return readMemberDatum(read, projection, [{ member: slot }], placement, name, values, ownRun);
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
      case "panelGraphOverview":
        value = await graphOf(type!).overview!();
        break;
      case "panelGraphConnections":
        value = await graphOf(type!).connections!({
          version: params.version as string,
          ...(params.sampleToken ? { sampleToken: params.sampleToken as string } : {}),
        });
        break;
      case "panelGraphNeighbors":
        value = await graphOf(type!).neighbors({
          node: params.node as unknown as PanelObjectValue,
          ...(params.relationKinds ? { relationKinds: params.relationKinds as string[] } : {}),
          ...(params.layers ? { layers: params.layers as PlatformGraphNeighborsQuery["layers"] } : {}),
          ...(params.targetClass ? { targetClass: params.targetClass as string } : {}),
          ...(params.direction ? { direction: params.direction as PlatformGraphNeighborsQuery["direction"] } : {}),
          ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
          ...(typeof params.offset === "number" ? { offset: params.offset } : {}),
        });
        break;
      case "panelOntologyObjects": {
        const page = params.page as { number: number; size: number } | null;
        value = await graphOf(type!).objects!({
          type: params.type as string,
          ...(params.search ? { keyword: params.search as string } : {}),
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
      const loadedTargetKey = shallowRef<string | null>(null);
      let sequence = 0;
      const data = projection.data[name]!;
      const declaration = directReadDeclaration(projection, data);
      const isObjectDatum = "object" in data.source;
      const requiredParams = declaration?.parameterMode === "fixed" ? declaration.requiredParams ?? [] : [];
      const hasTarget = isObjectDatum || requiredParams.length > 0;
      const datumTargetKeyOf = (): string | null => {
        if (!hasTarget) return null;
        const object = isObjectDatum ? (objectOf(data, inputs()) ?? null) : null;
        if (requiredParams.length === 0) return JSON.stringify(object);
        const values = paramValues(projection, data, placement, inputs(), own());
        return JSON.stringify([object, requiredParams.map((param) => values[param] ?? null)]);
      };
      let lastTargetKey: string | null = null;
      let lastReady: MemberReadyData | undefined;
      const snapshotReady = (ready: Extract<MemberDataState, { status: "ready" }>): MemberReadyData =>
        ready.rowOperations !== undefined
          ? { status: "ready", value: ready.value, rowOperations: ready.rowOperations }
          : { status: "ready", value: ready.value };
      let rereadTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingRereadAfterMs: number | undefined;
      let datumDisposed = false;
      const isDocumentVisible = () => (typeof document === "undefined" ? true : documentVisible());
      const clearRereadTimer = () => {
        if (rereadTimer !== null) {
          clearTimeout(rereadTimer);
          rereadTimer = null;
        }
      };
      const scheduleReread = (delayMs: number) => {
        clearRereadTimer();
        if (datumDisposed || !isDocumentVisible()) return;
        rereadTimer = setTimeout(() => {
          rereadTimer = null;
          if (datumDisposed || !isDocumentVisible()) return;
          void reread();
        }, delayMs);
      };
      const reread = (): Promise<void> => {
        clearRereadTimer();
        if (datumDisposed) return Promise.resolve();
        const reading = ++sequence;
        const nextTargetKey = datumTargetKeyOf();
        const targetChanged = hasTarget && nextTargetKey !== lastTargetKey;
        lastTargetKey = nextTargetKey;
        // Re-reading the same target keeps the shown record on screen until the new answer arrives. Switching targets
        // clears the previous target's ready state immediately.
        if (targetChanged) {
          lastReady = undefined;
          state.value = awaitsInputs(projection, data, placement, inputs(), own())
            ? { status: "awaiting" }
            : { status: "loading" };
        } else if (state.value.status === "ready") {
          if (!state.value.refreshing) {
            state.value = { ...state.value, refreshing: true };
          }
        } else {
          state.value = lastReady ? { status: "loading", previous: lastReady } : { status: "loading" };
        }
        return answer(name, inputs()).then(
          (result) => {
            if (datumDisposed || reading !== sequence) return;
            loadedTargetKey.value = nextTargetKey;
            if (result.status === "ready") {
              lastReady = snapshotReady(result);
              state.value = result;
              if (result.rereadAfterMs !== undefined) {
                pendingRereadAfterMs = result.rereadAfterMs;
                scheduleReread(result.rereadAfterMs);
              } else {
                pendingRereadAfterMs = undefined;
                clearRereadTimer();
              }
            } else if (result.status === "error") {
              pendingRereadAfterMs = undefined;
              clearRereadTimer();
              state.value = {
                ...result,
                ...(lastReady ? { previous: lastReady } : {}),
                retry: () => { void reread(); },
              };
            } else {
              pendingRereadAfterMs = undefined;
              clearRereadTimer();
              lastReady = undefined;
              state.value = result;
            }
          },
          (reason: unknown) => {
            if (datumDisposed || reading !== sequence) return;
            pendingRereadAfterMs = undefined;
            clearRereadTimer();
            loadedTargetKey.value = nextTargetKey;
            const code = reason && typeof reason === "object" && typeof (reason as { code?: unknown }).code === "string"
              ? (reason as { code: string }).code
              : undefined;
            state.value = {
              status: "error",
              message: reason instanceof Error ? reason.message : String(reason),
              ...(code ? { code } : {}),
              ...(lastReady ? { previous: lastReady } : {}),
              retry: () => { void reread(); },
            };
          },
        );
      };
      const stopVisibility = typeof document !== "undefined"
        ? onDocumentVisibility((visible) => {
            if (!visible) clearRereadTimer();
            else if (pendingRereadAfterMs !== undefined && !datumDisposed) reread();
          })
        : undefined;
      // An object an operation changed is read again where it is shown: its own datum, or a list of its type.
      watch(() => memberReadKey(projection, data, placement, inputs(), own()), reread, { immediate: true });
      const stopObjectChanged = instance.onObjectChanged((changed) => {
        const object = objectOf(data, inputs());
        if (!changed || (object && object.className === changed.objectType && object.primaryKey === changed.primaryKey)
          || ("type" in data.source && data.source.type.id === changed.objectType)) return reread();
      });
      onScopeDispose(() => {
        datumDisposed = true;
        pendingRereadAfterMs = undefined;
        clearRereadTimer();
        stopVisibility?.();
        stopObjectChanged();
      });
      return computed<MemberDataState>(() => {
        const hasTargetData = state.value.status === "ready"
          || ((state.value.status === "error" || state.value.status === "loading") && state.value.previous !== undefined);
        if (hasTarget && hasTargetData && datumTargetKeyOf() !== loadedTargetKey.value) {
          return awaitsInputs(projection, data, placement, inputs(), own())
            ? { status: "awaiting" }
            : { status: "loading" };
        }
        return state.value;
      });
    },
    // A refusal the module raises (a draft the owner refuses, by field) reaches the form as it was raised.
    read: (name, params, overrides = {}) => {
      const { inputs: run, own: ownRun } = runValues(projection, name, params);
      return answer(name, { ...inputs(), ...overrides, ...run }, { ...own(), ...ownRun });
    },
  };
}
