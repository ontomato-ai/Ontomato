import { computed, readonly, ref, type DeepReadonly, type Ref } from "vue";
import {
  matchesDirectPanelValue,
  panelStateValueSchema,
  type PanelChildObjectIdentity,
  type PanelDeepLinkStateValue,
  type PanelManifest,
  type PanelObjectIdentity,
  type PanelStateValue,
} from "@ontomato/contracts/panel-manifest";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
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

/** A reference to one ontology object, as a state field holds it. */
export interface PanelObjectRef {
  readonly className: string;
  readonly primaryKey: string;
}

/** One field's value as the panel reads it: an object reference, a collection of them, a scalar, or null while unset. */
export type PanelFieldValue = Exclude<PanelStateValue, readonly unknown[]> | readonly PanelObjectRef[];

/** The one top-level object a state value names; null for a child identity, a scalar, a collection or nothing. */
export function stateObject(value: DeepReadonly<PanelFieldValue> | undefined): PanelObjectRef | null {
  return value !== null && value !== undefined && typeof value === "object" && "className" in value
    ? value as PanelObjectRef
    : null;
}

/** The parent-scoped child identity a state value holds; null for anything else. */
export function stateChildObject(value: DeepReadonly<PanelFieldValue> | undefined): PanelChildObjectIdentity | null {
  return value !== null && value !== undefined && typeof value === "object" && "parent" in value
    ? value as PanelChildObjectIdentity
    : null;
}

/** The objects a collection state value holds; none for anything else. */
export function stateObjects(value: DeepReadonly<PanelFieldValue> | undefined): readonly PanelObjectRef[] {
  return Array.isArray(value) ? value as readonly PanelObjectRef[] : [];
}

/**
 * What a panel instance starts with: values for the fields an open request or a link named. A field it leaves out starts
 * at its declared default, else empty; an object-typed field declares no object to open on: that belongs to the request.
 */
export type PanelInitialState = Readonly<Record<string, RuntimeJsonValue>>;

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
  deepLinkable(): Record<string, PanelDeepLinkStateValue>;
}

/**
 * Checks a value against the field a panel declared, by the contract's own rule for the field's type: an object or
 * object-union field takes one top-level reference, a list its references, a child-object field a parent-scoped child
 * identity, a scalar its primitive type. Null clears the field.
 */
export function checkPanelValue(manifest: PanelManifest, name: string, value: unknown): PanelFieldValue {
  const field = manifest.state[name];
  if (!field) throw new Error(`Panel state has no field '${name}'`);
  const parsed = panelStateValueSchema.parse(value);
  if (!matchesDirectPanelValue(field.type, parsed))
    throw new TypeError(`Panel state '${name}' holds no ${JSON.stringify(field.type)} value: ${JSON.stringify(parsed)}`);
  return parsed as PanelFieldValue;
}

/**
 * One instance's state: its own values, checked against the declaration as they arrive. Nothing here is shared with
 * another instance of the panel, and nothing is written to the platform: the panel's state is the reader's moment.
 */
export function createPanelState(manifest: PanelManifest, initial: PanelInitialState = {}): PanelStateStore {
  const values = ref<Record<string, PanelFieldValue>>(
    Object.fromEntries(
      Object.entries(manifest.state).map(([name, field]) => {
        // An address or an open request names what it opens on; otherwise the field starts at its declared default.
        const value = name in initial ? initial[name]! : field.default ?? null;
        return [name, checkPanelValue(manifest, name, value)];
      }),
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
      // A collection is the instance's own and never deep-links; the declaration already refuses that.
      return Object.fromEntries(Object.entries(values.value).filter((entry): entry is [string, PanelDeepLinkStateValue] =>
        entry[1] !== null && !Array.isArray(entry[1]) && manifest.state[entry[0]]!.deepLink));
    },
  };
}

/** How an instance keeps the name of one object it has read: by its type and its key, never by its name. */
export function objectNameKey(objectType: string, primaryKey: string): string {
  return `${objectType}\u0000${primaryKey}`;
}

/** How an instance keeps the name of one child object it has read: scoped by parent identity and collection. */
export function childObjectNameKey(parent: PanelObjectIdentity, collection: string, primaryKey: string): string {
  return `child\u0000${parent.objectType}\u0000${parent.primaryKey}\u0000${collection}\u0000${primaryKey}`;
}

/**
 * The objects a panel instance holds, as a message names them: one entry per declared object or child-object field
 * that has a value, in declaration order. The entry's label is the name the object's owner gave it, from a read this
 * instance already made, followed by its type and key, so an agent reads which object it is from the same line as the
 * page; an object not read yet is named by its type and key alone. The name lives here and nowhere else: the state and
 * the address hold the key.
 */
export function panelSelection(
  manifest: PanelManifest,
  values: Readonly<Record<string, PanelFieldValue>>,
  names: ReadonlyMap<string, string>,
  translate: (key: string) => string,
): PanelSelection[] {
  return Object.entries(manifest.state).flatMap(([name, { type: field }]) => {
    if (field.kind === "child-object") {
      const child = stateChildObject(values[name]);
      if (!child) return [];
      const parentTypeMeta = platformObjectTypes[child.parent.objectType];
      const parentTypeLabel = parentTypeMeta?.labelKey ? translate(parentTypeMeta.labelKey) : child.parent.objectType;
      const parentNamed = names.get(objectNameKey(child.parent.objectType, child.parent.primaryKey));
      const parentPart = parentNamed
        ? `${parentTypeLabel} ${parentNamed}`
        : `${parentTypeLabel} ${child.parent.primaryKey}`;
      const childNamed = names.get(childObjectNameKey(child.parent, field.collection, child.primaryKey));
      const childPart = childNamed && childNamed !== child.primaryKey
        ? `${childNamed} (${child.primaryKey})`
        : (childNamed ?? child.primaryKey);
      return [{
        kind: "child-object",
        parent: child.parent,
        collection: field.collection,
        id: child.primaryKey,
        label: `${parentPart} / ${childPart}`,
      }];
    }
    const value = stateObject(values[name]);
    if ((field.kind !== "object" && field.kind !== "object-union") || !value) return [];
    const objectType = field.kind === "object" ? field.objectType : value.className;
    const reference = `${objectType} ${value.primaryKey}`;
    const named = names.get(objectNameKey(objectType, value.primaryKey));
    if (field.kind === "object") {
      return [{ kind: objectType, id: value.primaryKey, label: named ? `${named} (${reference})` : reference }];
    }
    const typeLabel = translate(platformObjectTypes[objectType]!.labelKey!);
    const prefix = named ? `${typeLabel} ${named}` : typeLabel;
    return [{ kind: objectType, id: value.primaryKey, label: `${prefix} (${reference})` }];
  });
}
