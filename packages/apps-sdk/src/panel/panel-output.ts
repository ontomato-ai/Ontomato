import { computed, getCurrentInstance, type ComputedRef } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { usePanelContext } from "./context";

/**
 * Read one read-only output published by a projection member (e.g. `ObjectList`'s `total`, `loadedCount`,
 * `filteredCount`, `checkedCount`, `selectedLabel`, `activeLabel`; `ObjectSummary`/`ObjectHeader`/`ObjectForm`'s
 * `label`; `ObjectForm`'s `dirty` and `draft`; or named typed scalar outputs declared by the bound read's owner).
 * Read-only outputs stay separate from the panel's writable public `manifest.state`.
 */
export function usePanelOutput<T extends RuntimeJsonValue = RuntimeJsonValue>(
  member: string,
  name: string,
): ComputedRef<T | null> {
  if (!getCurrentInstance()) {
    throw new Error("Call usePanelOutput in a component's setup, before any await: it finds the panel through the component that calls it");
  }
  const { instance, manifest } = usePanelContext();
  if (!Object.hasOwn(manifest.members, member)) {
    throw new Error(`The panel declares no member '${member}'`);
  }
  return computed(() => (instance.outputs[member]?.[name] ?? null) as T | null);
}

/**
 * Read all read-only outputs published by a projection member as a reactive map (`{ total, filteredCount, ... }`).
 */
export function usePanelOutputs(
  member: string,
): ComputedRef<Readonly<Record<string, RuntimeJsonValue | null>>> {
  if (!getCurrentInstance()) {
    throw new Error("Call usePanelOutputs in a component's setup, before any await: it finds the panel through the component that calls it");
  }
  const { instance, manifest } = usePanelContext();
  if (!Object.hasOwn(manifest.members, member)) {
    throw new Error(`The panel declares no member '${member}'`);
  }
  return computed(() => instance.outputs[member] ?? {});
}
