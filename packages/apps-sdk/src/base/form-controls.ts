import { inject, type InjectionKey, type Ref, type Slot } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { InvalidFormText } from "../panel/forms";

/*
 * What the controls of one owner form edit, provided by the form that holds it: the values, the messages and marks by
 * absolute JSON Pointer, and the three ways a control changes them. A control nested in an object or an array row reads
 * and writes the same values at its current absolute path, so there is one value and never a row's copy of it.
 */
export interface FormControls {
  /** The `ObjectForm`'s own member key in the panel manifest. */
  readonly formSlot: string;
  readonly values: Readonly<Ref<PanelFormValues>>;
  /** Effective values with inactive object-variant keys pruned, used for default equality checks. */
  readonly prunedValues: Readonly<Ref<PanelFormValues>>;
  /** The owner's messages and this form's own (text that is not the field's value), by absolute path. */
  readonly errors: Readonly<Ref<Readonly<Record<string, string>>>>;
  readonly changed: Readonly<Ref<ReadonlySet<string>>>;
  readonly busy: Readonly<Ref<boolean>>;
  /** How top-level fields of the form are arranged (`stacked` or `rows`). */
  readonly layout: Readonly<Ref<"stacked" | "rows">>;
  /** Whether required fields render the red required asterisk marker. */
  readonly showRequiredMark?: Readonly<Ref<boolean>>;
  /** Whether any visible top-level field declares `defaultValue`, reserving the reset column in `rows` layout. */
  readonly hasDefaults: Readonly<Ref<boolean>>;
  /** Read-only reasons the form says once for itself, because its owner gives them to several fields; a field skips them. */
  readonly sharedReadOnlyReasons: Readonly<Ref<ReadonlySet<string>>>;
  /** Whether `path` addresses a top-level field of this form (as opposed to an object child or array row field). */
  isTopLevel(path: string): boolean;
  /** Whether `path` currently holds unparseable local text (such as invalid JSON in a code editor). */
  hasInvalid(path: string): boolean;
  invalidText(path: string): string | undefined;
  set(path: string, value: RuntimeJsonValue): void;
  /** Leaves the field at `path` out of the values: a choice cleared, which the owner then does not receive. */
  remove(path: string): void;
  /**
   * Rearranges the rows of the array at `path`, `order[next] = previous`; a row left out is removed. Messages and marks
   * inside a row move with it.
   */
  reorder(path: string, order: readonly number[]): void;
  /** Keeps unparseable field text and its validation message until the field has a value again. */
  invalid(path: string, text: InvalidFormText | null): void;
  /**
   * Look up a custom Vue slot for a form field (`#field-<path>`, `#field-<arrayPath>/*<itemPath>`, or `#field`).
   * Returns the slot function and scoped props when a slot is provided for this field, or `undefined` to render the
   * default control.
   */
  resolveFieldSlot(
    field: PanelFormField,
    absolutePath: string,
    disabled?: boolean,
    arrayPath?: string,
    index?: number,
  ): { slot: Slot; props: Record<string, unknown> } | undefined;
  /**
   * Look up a custom item-level footer slot for an `object-array` card (`#array-item-footer-<arrayPath>` or
   * `#array-item-footer`), used for row-scoped actions and independent inline feedback.
   */
  resolveArrayItemFooterSlot?(
    arrayPath: string,
    item: RuntimeJsonValue,
    index: number,
    key: string,
    disabled: boolean,
    readOnly: boolean,
  ): { slot: Slot; props: Record<string, unknown> } | undefined;
}

export const formControlsKey: InjectionKey<FormControls> = Symbol("form-controls");

export function useFormControls(): FormControls {
  const controls = inject(formControlsKey, null);
  if (!controls) throw new Error("A form control is drawn inside an owner form, which provides its values");
  return controls;
}
