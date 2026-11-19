import { computed, readonly, ref, type DeepReadonly, type Ref } from "vue";
import {
  panelStateValueSchema,
  type PanelManifest,
  type PanelStateValue,
} from "@ontomato/contracts/panel-manifest";
import type { PanelSelection } from "./types";

/*
 * One panel instance's state (overall design 3.4, "declare and manage panel state"): the values a panel declares, held
 * once per instance, so the same panel open twice keeps two readers' selections apart. The declaration says what each
 * field is (`object` of one ontology type, or a scalar) and whether it may travel in the address; this module keeps the
 * values and checks them against that declaration when a value arrives from outside the panel (an open request, a link).
 *
 * The state is the panel's own; the page context a message carries is projected from it (see `page-context.ts`), so a
 * panel author writes neither.
 */

/** One field's value as the panel reads it: the object reference, the scalar, or null while nothing is set. */
export type PanelFieldValue = PanelStateValue;

/**
 * What a panel instance starts with: values for the fields an open request or a link named. A field it leaves out starts
 * empty, and an object-typed field starts with no object: which object to open on belongs to the request, never to the
 * shared declaration.
 */
export type PanelInitialState = Readonly<Record<string, PanelFieldValue>>;

export interface PanelStateStore {
  /** Every declared field, by name, as the panel's template and script read them. */
  readonly values: DeepReadonly<Ref<Record<string, PanelFieldValue>>>;
  /** One field; the same value `values` holds. */
  field(name: string): DeepReadonly<Ref<PanelFieldValue>>;
  /** What the reader or a state operation set. A value of the wrong type for the field is refused here. */
  set(name: string, value: PanelFieldValue): void;
  /**
   * Atomically updates multiple declared fields in one state assignment (for example changing a parent object while
   * clearing its child selection, or switching mutually exclusive selections). Every entry is validated before any
   * field changes, so reactive watchers and the host bridge never see a half-updated state.
   */
  setState(patch: Readonly<Record<string, PanelFieldValue>>): void;
  /** The fields an address or an open request may carry, with the values they hold now. */
  deepLinkable(): Record<string, PanelFieldValue>;
}

/**
 * Checks a value against the field a panel declared. `object` takes a reference to one object of the declared ontology
 * type; a scalar takes its own type. Null clears the field.
 */
export function checkPanelValue(manifest: PanelManifest, name: string, value: PanelFieldValue): PanelFieldValue {
  const field = manifest.state[name];
  if (!field) throw new Error(`Panel state has no field '${name}'`);
  const parsed = panelStateValueSchema.parse(value);
  if (parsed === null) return null;
  if (field.kind === "object") {
    if (typeof parsed !== "object") throw new TypeError(`Panel state '${name}' is a ${field.objectType} reference`);
    if (parsed.className !== field.objectType)
      throw new TypeError(`Panel state '${name}' is a ${field.objectType} reference, not ${parsed.className}`);
    return parsed;
  }
  if (typeof parsed === "object") throw new TypeError(`Panel state '${name}' is a ${field.type}`);
  if (field.type === "date" && (typeof parsed !== "string" || !Number.isFinite(Date.parse(parsed))))
    throw new TypeError(`Panel state '${name}' is a date`);
  if (field.type !== "date" && typeof parsed !== field.type)
    throw new TypeError(`Panel state '${name}' is a ${field.type}`);
  return parsed;
}

/**
 * One instance's state: its own values, checked against the declaration as they arrive. Nothing here is shared with
 * another instance of the panel, and nothing is written to the platform: the panel's state is the reader's moment.
 */
export function createPanelState(manifest: PanelManifest, initial: PanelInitialState = {}): PanelStateStore {
  const values = ref<Record<string, PanelFieldValue>>(
    Object.fromEntries(
      Object.keys(manifest.state).map((name) => [name, name in initial ? checkPanelValue(manifest, name, initial[name]!) : null]),
    ),
  );
  const fields = new Map<string, DeepReadonly<Ref<PanelFieldValue>>>(
    Object.keys(manifest.state).map((name) => [
      name,
      readonly(computed(() => values.value[name] ?? null)) as DeepReadonly<Ref<PanelFieldValue>>,
    ]),
  );
  return {
    values: readonly(values) as DeepReadonly<Ref<Record<string, PanelFieldValue>>>,
    field(name) {
      const field = fields.get(name);
      if (!field) throw new Error(`Panel state has no field '${name}'`);
      return field;
    },
    set(name, value) {
      values.value = { ...values.value, [name]: checkPanelValue(manifest, name, value) };
    },
    setState(patch) {
      const entries = Object.entries(patch);
      if (!entries.length) return;
      const checked: Record<string, PanelFieldValue> = {};
      for (const [name, value] of entries) checked[name] = checkPanelValue(manifest, name, value);
      values.value = { ...values.value, ...checked };
    },
    deepLinkable() {
      return Object.fromEntries(
        Object.entries(values.value).filter(([name, value]) => value !== null && manifest.state[name]!.deepLink),
      );
    },
  };
}

/** How an instance keeps the name of one object it has read: by its type and its key, never by its name. */
export function objectNameKey(objectType: string, primaryKey: string): string {
  return `${objectType}\u0000${primaryKey}`;
}

/**
 * The objects a panel instance holds, as a message names them: one entry per declared object field that has a value, in
 * declaration order. The entry's label is the name the object's owner gave it, from a read this instance already made,
 * followed by its type and key, so an agent reads which object it is from the same line as the page; an object not read
 * yet is named by its type and key alone. The name lives here and nowhere else: the state and the address hold the key.
 */
export function panelSelection(
  manifest: PanelManifest,
  values: Readonly<Record<string, PanelFieldValue>>,
  names: ReadonlyMap<string, string>,
): PanelSelection[] {
  return Object.entries(manifest.state).flatMap(([name, field]) => {
    const value = values[name];
    if (field.kind !== "object" || !value || typeof value !== "object") return [];
    const reference = `${field.objectType} ${value.primaryKey}`;
    const named = names.get(objectNameKey(field.objectType, value.primaryKey));
    return [{ kind: field.objectType, id: value.primaryKey, label: named ? `${named} (${reference})` : reference }];
  });
}
