import { inject, shallowReactive, type Component, type InjectionKey, type Ref } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";

/*
 * What the controls of one owner form edit, provided by the form that holds it: the values, the messages and marks by
 * absolute JSON Pointer, and the three ways a control changes them. A control nested in an object or an array row reads
 * and writes the same values at its current absolute path, so there is one value and never a row's copy of it.
 */
export interface FormControls {
  readonly values: Readonly<Ref<PanelFormValues>>;
  /** The owner's messages and this form's own (text that is not the field's value), by absolute path. */
  readonly errors: Readonly<Ref<Readonly<Record<string, string>>>>;
  readonly changed: Readonly<Ref<ReadonlySet<string>>>;
  readonly busy: Readonly<Ref<boolean>>;
  /** Read-only reasons the form says once for itself, because its owner gives them to several fields; a field skips them. */
  readonly sharedReadOnlyReasons: Readonly<Ref<ReadonlySet<string>>>;
  set(path: string, value: RuntimeJsonValue): void;
  /** Leaves the field at `path` out of the values: a choice cleared, which the owner then does not receive. */
  remove(path: string): void;
  /**
   * Rearranges the rows of the array at `path`, `order[next] = previous`; a row left out is removed. Messages and marks
   * inside a row move with it.
   */
  reorder(path: string, order: readonly number[]): void;
  /** The field at `path` holds text that is not a value of the owner's (a message), or no longer does (null). */
  invalid(path: string, message: string | null): void;
  /**
   * What draws the field at `path` — or, with `itemPath`, the row field `itemPath` of the array at `path` in each row —
   * when a projection of the panel is declared for it: the component that projection registered (drawn with the field's
   * absolute `path`), null while it has not drawn yet, or undefined when no slot of the panel declares one, and the form
   * draws the field itself.
   */
  fieldControl(path: string, itemPath?: string): Component | null | undefined;
}

export const formControlsKey: InjectionKey<FormControls> = Symbol("form-controls");

export function useFormControls(): FormControls {
  const controls = inject(formControlsKey, null);
  if (!controls) throw new Error("A form control is drawn inside an owner form, which provides its values");
  return controls;
}

/**
 * The field controls of one panel instance, by form slot, field path and row path: a projection whose `formField` port
 * names a field registers here the component that draws it at one absolute path, and the form draws it where the field
 * is — in its place among the form's fields, or in each row of an array for a port with an `itemPath`. The projection is
 * read, registered and admitted once, under its own binding.
 */
const fieldControls = new WeakMap<object, Map<string, Component>>();
export const fieldControlKey = (formSlot: string, path: string, itemPath?: string) => JSON.stringify([formSlot, path, itemPath ?? null]);

export function fieldControlsOf(instance: object): Map<string, Component> {
  let controls = fieldControls.get(instance);
  if (!controls) fieldControls.set(instance, (controls = shallowReactive(new Map())));
  return controls;
}
