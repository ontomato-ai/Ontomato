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
  set(path: string, value: RuntimeJsonValue): void;
  /**
   * Rearranges the rows of the array at `path`, `order[next] = previous`; a row left out is removed. Messages and marks
   * inside a row move with it.
   */
  reorder(path: string, order: readonly number[]): void;
  /** The field at `path` holds text that is not a value of the owner's (a message), or no longer does (null). */
  invalid(path: string, message: string | null): void;
  /**
   * What draws the row field `itemPath` of the array at `path` in each row: the component another slot's projection
   * registered for it (drawn with the row field's absolute `path`), null while that declared projection has not drawn
   * yet, or undefined when no slot of the panel declares one.
   */
  rowControl(path: string, itemPath: string): Component | null | undefined;
}

export const formControlsKey: InjectionKey<FormControls> = Symbol("form-controls");

export function useFormControls(): FormControls {
  const controls = inject(formControlsKey, null);
  if (!controls) throw new Error("A form control is drawn inside an owner form, which provides its values");
  return controls;
}

/**
 * The row field controls of one panel instance, by form slot, array path and row path: a projection whose `formField`
 * port names an `itemPath` registers here the component that draws its field at one absolute path, and the form draws
 * it in each row. The projection is read, registered and admitted once, under its own binding.
 */
const rowControls = new WeakMap<object, Map<string, Component>>();
export const rowControlKey = (formSlot: string, path: string, itemPath: string) => JSON.stringify([formSlot, path, itemPath]);

export function rowControlsOf(instance: object): Map<string, Component> {
  let controls = rowControls.get(instance);
  if (!controls) rowControls.set(instance, (controls = shallowReactive(new Map())));
  return controls;
}
