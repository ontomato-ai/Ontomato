import { computed, getCurrentInstance, type ComputedRef } from "vue";
import { panelOperationId } from "@ontomato/contracts/panel-manifest";
import { usePanelContext } from "./context";
import type { PanelOperationBinding } from "./types";

/*
 * One operation the panel's own code runs (the line's main control, 2026-11-21): an operation a member's projection
 * names under `operations.<name>`, found by the member and that name. It is the operation the page's header and an
 * agent run, as its owner admits it now: an action on an object is admitted once the object is chosen, and a read
 * (an export the reader saves) is read, a write frozen as one intent the host confirms where the owner asks.
 */

/** One member's operation, as the page's code holds it. */
export interface PanelOperationHandle {
  /** The owner's description while it admits the operation now — its label, kind and target — else null. */
  readonly operation: ComputedRef<PanelOperationBinding | null>;
  /** Runs it with the page's own input; a read answers what it read (or the file the reader saved). */
  run(input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/**
 * ```js
 * const approve = usePanelOperation("detail", "approve");
 * // <el-button :disabled="!approve.operation.value" @click="approve.run()">{{ approve.operation.value?.label }}</el-button>
 * ```
 */
export function usePanelOperation(member: string, name: string): PanelOperationHandle {
  if (!getCurrentInstance())
    throw new Error("Call usePanelOperation in a component's setup, before any await: it finds the panel through the component that calls it");
  const { instance, manifest } = usePanelContext();
  if (!Object.hasOwn(manifest.members, member)) throw new Error(`The panel declares no member '${member}'`);
  const id = panelOperationId(member, name);
  return {
    operation: computed(() => instance.operations.value.find((operation) => operation.id === id) ?? null),
    run: (input) => instance.invoke(id, input),
  };
}
