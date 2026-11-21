import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelCommand, PanelManifest, PanelMemberInput, PanelOperation } from "@ontomato/contracts/panel-manifest";
import type { PanelFieldValue, PanelStateStore } from "./state";

/*
 * What a panel's commands do (overall design 3.4, 5.1): a command is an operation the header offers and a person or an
 * agent invokes by name. It ends in one of three effects, declared beside the panel's state and members rather than
 * written into a script: set the panel's own state, invoke a member's published operation, or open the conversation entry
 * a member's projection declares or an application entry.
 *
 * The values a command sends come from the declaration alone — a literal, or a state field read at the moment of the call
 * — so what a click or an agent's call sends is the same thing. A state change is written once, after every field is
 * resolved: no watcher and no host bridge ever sees half of it.
 */

/** What a command does outside the state: a member's operation, or an open the host carries out. */
export interface PanelCommandRuntime {
  readonly state: PanelStateStore;
  /** A member's published operation, by member key and operation name, with the resolved inputs. */
  invokeMember(member: string, operation: string, inputs: Readonly<Record<string, RuntimeJsonValue>>): Promise<unknown>;
  /** An open: the conversation entry a member's projection declares, or an application entry the host opens. */
  open(request: PanelCommandOpen): Promise<void>;
  /** The panel's own words for a labelKey. */
  text(key: string): string;
}

export type PanelCommandOpen =
  | { mode: "conversationEntry"; member: string }
  | { mode: "entry"; entry: { className: string; primaryKey: string }; inputs: Record<string, RuntimeJsonValue> };

export interface PanelCommands {
  /** The header's operations: every command, in declaration order, as `{id: <command key>, label: text(labelKey), kind: "state", inputSchema: {}}`. */
  operations(): PanelOperation[];
  /** Runs one command by its key (a header click, an agent's call). An unknown key rejects. */
  invoke(command: string): Promise<void>;
}

type CommandEntry = Extract<Extract<PanelCommand["do"], { open: unknown }>["open"], { mode: "entry" }>["entry"];

/** One object an entry names, as an `open` request carries it. */
type PanelEntryRef = { className: string; primaryKey: string };

export function createPanelCommands(manifest: PanelManifest, runtime: PanelCommandRuntime): PanelCommands {
  /** A value the declaration names, resolved now: a literal or a state field. */
  function value(source: PanelMemberInput | CommandEntry, where: string): RuntimeJsonValue {
    if ("literal" in source) return source.literal as RuntimeJsonValue;
    if ("state" in source) return runtime.state.field(source.state).value as unknown as RuntimeJsonValue;
    // A member's item is handed over only to the member that lists it; a command invoked by name has none.
    throw new Error(`Command value at '${where}' names a member's item, which no command is handed`);
  }

  const inputs = (values: Readonly<Record<string, PanelMemberInput>>, where: string) => Object.fromEntries(
    Object.entries(values).map(([name, source]) => [name, value(source, `${where}.${name}`)]),
  ) as Record<string, RuntimeJsonValue>;

  async function run(command: PanelCommand) {
    const action = command.do;
    if ("set" in action) {
      const patch: Record<string, PanelFieldValue> = {};
      for (const [field, source] of Object.entries(action.set.fields))
        patch[field] = value(source, `set.${field}`) as unknown as PanelFieldValue;
      runtime.state.setState(patch);
      return;
    }
    if ("invoke" in action) {
      const { member, operation } = action.invoke;
      await runtime.invokeMember(member, operation, inputs(action.invoke.inputs, `invoke.${member}.${operation}`));
      return;
    }
    const open = action.open;
    if (open.mode === "conversationEntry") await runtime.open({ mode: "conversationEntry", member: open.member });
    else await runtime.open({ mode: "entry", entry: value(open.entry, "open.entry") as unknown as PanelEntryRef, inputs: inputs(open.inputs ?? {}, "open.inputs") });
  }

  return {
    operations() {
      return Object.entries(manifest.commands).map(([id, command]) =>
        ({ id, label: runtime.text(command.labelKey), kind: "state" as const, inputSchema: {}, handlerRef: `panel.state.${id}` }));
    },

    async invoke(command) {
      const found = Object.hasOwn(manifest.commands, command) ? manifest.commands[command] : undefined;
      if (!found) throw new Error(`This panel declares no command '${command}'`);
      await run(found);
    },
  };
}
