import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelEvent, PanelManifest, PanelOperation } from "@ontomato/contracts/panel-manifest";
import type { PanelFieldValue, PanelStateStore } from "./state";

/*
 * What a panel's events do (overall design 3.4, 5.1): an event is either an operation the header offers and a person or
 * an agent invokes by name, or a trigger a member's output fires. Both end in one of three effects, declared beside the
 * panel's state and members rather than written into a script: set the panel's own state, invoke a member's published
 * operation, or open another member or an application entry.
 *
 * The values an event sends come from four places only — a literal in the declaration, a state field read at the moment
 * of the call, the output the member just handed over, or the item the member names — so what a click or an agent's
 * call sends is the same thing, and the same declaration drives both. A state change is written once, after every field
 * is resolved: no watcher and no host bridge ever sees half of it.
 */

/** What an event does outside the state: a member's operation, or an open the host carries out. */
export interface PanelEventRuntime {
  readonly state: PanelStateStore;
  /** A member's published operation, by member key and operation name, with the resolved inputs. */
  invokeMember(member: string, operation: string, inputs: Readonly<Record<string, RuntimeJsonValue>>): Promise<unknown>;
  /** An open the host carries out: another member in a mode, or an application entry. */
  open(request: PanelEventOpen): Promise<void>;
  /** The panel's own words for a labelKey. */
  text(key: string): string;
}

export type PanelEventOpen =
  | { mode: "replace" | "drawer" | "dialog"; member: string; inputs: Record<string, RuntimeJsonValue> }
  | { mode: "entry"; entry: { className: string; primaryKey: string }; inputs: Record<string, RuntimeJsonValue> };

export interface PanelEvents {
  /** The header's operations: each event with a labelKey and no `on`, in declaration order, as `{id: <event key>, label: text(labelKey), kind: "state", inputSchema: {}}`. */
  operations(): PanelOperation[];
  /** Runs one such event by its key (a header click, an agent's call). An unknown key, or an event with `on`, rejects. */
  invoke(event: string): Promise<void>;
  /** A member handed over an output: runs every event `on` that member and output, in declaration order. */
  emitted(member: string, output: string, payload: RuntimeJsonValue, item?: RuntimeJsonValue): Promise<void>;
}

/** The values an event's inputs hold, taken from the declaration's own vocabulary. */
type EventInputs = Extract<PanelEvent["do"], { invoke: unknown }>["invoke"]["inputs"];
type EventValue = EventInputs[string];
type EventEntry = Extract<Extract<PanelEvent["do"], { open: unknown }>["open"], { mode: "entry" }>["entry"];

/** One object an entry names, as an `open` request carries it. */
type PanelEntryRef = { className: string; primaryKey: string };

export function createPanelEvents(manifest: PanelManifest, runtime: PanelEventRuntime): PanelEvents {
  const declared = Object.entries(manifest.events);

  /** A value the declaration names, resolved now: a literal, a state field, the handed-over output, or the item. */
  function value(source: EventValue, payload: RuntimeJsonValue | undefined, item: RuntimeJsonValue | undefined, where: string): RuntimeJsonValue {
    if ("literal" in source) return source.literal;
    if ("state" in source) return runtime.state.field(source.state).value as unknown as RuntimeJsonValue;
    if ("item" in source) {
      if (item === undefined) throw new Error(`Event value at '${where}' names the member's item, and no item was handed over`);
      return item;
    }
    // The contract allows the output's own value only on an output trigger, which is the only caller that has one.
    if (payload === undefined) throw new Error(`Event value at '${where}' names the output's value, and the event was invoked without one`);
    return payload;
  }

  function inputs(values: EventInputs, payload: RuntimeJsonValue | undefined, item: RuntimeJsonValue | undefined, where: string) {
    return Object.fromEntries(
      Object.entries(values).map(([name, source]) => [name, value(source, payload, item, `${where}.${name}`)]),
    ) as Record<string, RuntimeJsonValue>;
  }

  function entry(source: EventEntry, payload: RuntimeJsonValue | undefined, item: RuntimeJsonValue | undefined): PanelEntryRef {
    return value(source, payload, item, "open.entry") as unknown as PanelEntryRef;
  }

  async function run(event: PanelEvent, payload: RuntimeJsonValue | undefined, item: RuntimeJsonValue | undefined) {
    const action = event.do;
    if ("set" in action) {
      const patch: Record<string, PanelFieldValue> = {};
      for (const [field, source] of Object.entries(action.set.fields))
        patch[field] = value(source, payload, item, `set.${field}`) as unknown as PanelFieldValue;
      runtime.state.setState(patch);
      return;
    }
    if ("invoke" in action) {
      const { member, operation } = action.invoke;
      await runtime.invokeMember(member, operation, inputs(action.invoke.inputs, payload, item, `invoke.${member}.${operation}`));
      return;
    }
    const open = action.open;
    const resolved = inputs(open.inputs ?? {}, payload, item, "open.inputs");
    if (open.mode === "entry") await runtime.open({ mode: "entry", entry: entry(open.entry, payload, item), inputs: resolved });
    else await runtime.open({ mode: open.mode, member: open.member, inputs: resolved });
  }

  return {
    operations() {
      return declared.flatMap(([id, event]) =>
        event.labelKey === undefined || event.on !== undefined
          ? []
          : [{ id, label: runtime.text(event.labelKey), kind: "state" as const, inputSchema: {}, handlerRef: `panel.state.${id}` }],
      );
    },

    async invoke(event) {
      const found = Object.hasOwn(manifest.events, event) ? manifest.events[event] : undefined;
      if (!found) throw new Error(`This panel declares no event '${event}'`);
      if (found.on) throw new Error(`Event '${event}' runs on '${found.on.member}.${found.on.output}', not on invocation`);
      await run(found, undefined, undefined);
    },

    async emitted(member, output, payload, item) {
      for (const [, event] of declared)
        if (event.on?.member === member && event.on.output === output) await run(event, payload, item);
    },
  };
}
