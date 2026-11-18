import type { FormField } from "@ontomato/contracts/form-fields";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { registerHandler } from "./handlers";

/*
 * How the SDK reads and writes one read-only platform object type (overall design 3.2): a projection binds
 * `PlatformObjectType:platform:ScheduledTask`, and this registry says what reading one, listing them, reading the owner's
 * form for one and saving it mean for that type. It sits beside the handler registry and for the same reason: a component
 * is generic, and the type it is bound to decides which client answers.
 *
 * Only the types this step's panels use are registered. A binding to a type this version has not registered fails
 * visibly; it never falls back to another read.
 */

/** One object of a registered platform type, as its owner's list and read return it. */
export interface PlatformObjectRecord {
  /** The primary key the object's own service uses, as text. */
  primaryKey: string;
  /** What a reader recognises it by, in one line. */
  label: string;
  /** What a summary may show: the owner's own fields, by name, as text. */
  fields: Readonly<Record<string, string>>;
}

/**
 * One object as its owner hands it over to be edited: its fields, what they hold now, and the revision those values
 * belong to. The revision is the owner's own concurrency token, read once when the form opens (or when a draft arrives)
 * and sent back with the save, so a change somebody else made meanwhile is refused rather than overwritten.
 */
export interface PlatformObjectForm {
  fields: readonly FormField[];
  values: Readonly<Record<string, string>>;
  revision: number;
}

/** One object type's read side: what a list, a summary and a form need from its owner. */
export interface PlatformObjectClient {
  /** The type this client answers for, as a projection's binding names it: `platform:ScheduledTask`. */
  objectType: string;
  /** The objects of this type the reader may see, in the owner's own order. */
  list(): Promise<readonly PlatformObjectRecord[]>;
  /** One object as its owner holds it now. */
  read(primaryKey: string): Promise<PlatformObjectRecord>;
  /** The owner's current form for one object, with the revision its values belong to. */
  form(primaryKey: string): Promise<PlatformObjectForm>;
  /**
   * Asks the owner for a new form after one of its fields changed, as the field declares the form depends on it. The
   * answer is the complete form: a selection that removed fields removes them with their values.
   */
  changed(primaryKey: string, values: Readonly<Record<string, string>>, field: string): Promise<PlatformObjectForm>;
  /**
   * Writes one object through its owner's own interface, with the values its form holds and the revision those values
   * were read at. An owner that has the object at another revision, or that finds a value invalid, refuses the write:
   * the client throws a `PlatformObjectRefusal` with the owner's reason, and the reader sees it.
   */
  save(primaryKey: string, values: Readonly<Record<string, string>>, revision: number): Promise<PlatformObjectRecord>;
}

/**
 * An owner's refusal of a write, as a generic form shows it: the owner's own reason, and the message for each form field
 * the owner named, by field key. A refusal that names no field (somebody else changed the object first, say) has none.
 */
export class PlatformObjectRefusal extends Error {
  constructor(
    message: string,
    readonly fields: Readonly<Record<string, string>>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PlatformObjectRefusal";
  }
}

const clients = new Map<string, PlatformObjectClient>();

/**
 * Registers one platform object type's client, and with it the type's own save operation — `<type>.save` — so the save a
 * form projection publishes is a registered handler like any other, reached by a person's header button and by an
 * agent's call alike. Registering the same type twice fails: one type, one client, one save.
 */
export function registerPlatformObject(client: PlatformObjectClient): void {
  if (clients.has(client.objectType)) throw new Error(`Platform object '${client.objectType}' is already registered`);
  clients.set(client.objectType, client);
  registerHandler({
    handlerRef: `${client.objectType}.save`,
    async invoke({ target, input }) {
      if (target?.kind !== "object") throw new Error(`Saving a ${client.objectType} needs the object it saves`);
      const { revision, ...values } = input;
      if (typeof revision !== "number") throw new Error(`Saving a ${client.objectType} needs the revision it was read at`);
      return client.save(
        target.primaryKey,
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [name, typeof value === "string" ? value : String(value ?? "")]),
        ),
        revision,
      );
    },
  });
}

/** The client that answers for one binding's type. */
export function platformObjectFor(objectType: string): PlatformObjectClient {
  const found = clients.get(objectType);
  if (!found) throw new Error(`This SDK version reads no platform object '${objectType}'`);
  return found;
}

/** The types this version reads: what a projection may bind. */
export function registeredPlatformObjects(): readonly string[] {
  return [...clients.keys()];
}

/** The primary key a projection's input value names, or null when nothing is selected. */
export function selectedKey(value: PanelStateValue | undefined): string | null {
  return value && typeof value === "object" ? value.primaryKey : null;
}
