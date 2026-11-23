import { inject, type ComputedRef, type InjectionKey } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelMemberItemKey } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import type { PanelObjectRef } from "./state";

/**
 * Context provided by `ObjectForm` inside `#field-<path>`, `#field-<arrayPath>/*<itemPath>`, and `#field` Vue slots.
 * Projection components (`ReferencePicker`, `ObjectGraph`) and custom author field components rendered inside a form
 * field slot inject this automatically — no `formField` declaration in `panel.json` is needed.
 */
export interface FormFieldSlotContext {
  readonly formSlot: string;
  readonly path: ComputedRef<string>;
  readonly field: ComputedRef<PanelFormField>;
  readonly index?: ComputedRef<number | undefined>;
}

export const formFieldSlotKey: InjectionKey<FormFieldSlotContext> = Symbol("ontomato.formFieldSlot");

export function useFormFieldSlot(): FormFieldSlotContext | null {
  return inject(formFieldSlotKey, null);
}

/** Per-row operation state handed to `ObjectList` Vue slots (`#cell-*`, `#actions`, `#row-detail`, `#card`). */
export interface ListRowSlotOperation {
  readonly name: string;
  readonly label: string;
  readonly available: boolean;
  readonly unavailable?: { readonly reason: string };
  readonly danger: boolean;
  readonly effect: PanelOwnerOperationDescriptor["effect"];
}

/**
 * Context provided by `ObjectList` inside row-scoped Vue slots (`#cell-<key>`, `#cell`, `#actions`, `#row-detail`, `#card`).
 * Both author-registered slot components and nested `<Projection>`s placed inside these slots can read the current row's
 * typed object reference and invoke declared row operations without receiving the raw row record.
 */
export interface ListRowSlotContext {
  readonly listSlot: string;
  readonly ref: ComputedRef<PanelObjectRef>;
  readonly itemKey: ComputedRef<PanelMemberItemKey>;
  readonly index: ComputedRef<number>;
  readonly operations: ComputedRef<Readonly<Record<string, ListRowSlotOperation>>>;
  runOperation(operationName: string, extraInput?: Readonly<Record<string, RuntimeJsonValue>>): Promise<void>;
}

export const listRowSlotKey: InjectionKey<ListRowSlotContext> = Symbol("ontomato.listRowSlot");

export function useListRowSlot(): ListRowSlotContext | null {
  return inject(listRowSlotKey, null);
}
