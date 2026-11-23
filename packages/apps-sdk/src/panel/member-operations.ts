import { computed, shallowRef, watch, type ComputedRef } from "vue";
import {
  productPanelOperationsReadResponseSchema, type ProductPanelOperationsReadResponse,
} from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { PublisherPath } from "./instance";
import type { MemberInputs, PanelReadPort } from "./direct";

/*
 * What a member can do (the second review's first item, big main's ruling, 2026-11-20): the operations its projection
 * names under `operations.<name>`, each one owner's registered operation, described as the owner admits it for this
 * reader, at this entry, with the member's inputs now. The platform's read entry answers them by name; nothing here
 * derives an operation from a component or a catalogue, and a button, the header and an agent read the same answer.
 *
 * An operation the owner does not admit now — an object's action while no object is chosen, a form's create where the
 * owner creates nothing — is not in the answer; the others still are.
 */

/** A member's admitted operations, by the projection's local name. */
export type MemberOperations = Readonly<Record<string, PanelOwnerOperationDescriptor>>;

/** A member's operations as a component shows them: the read entry's answer, or still being read. */
export type MemberOperationsState = ProductPanelOperationsReadResponse | { status: "loading" };

/** The admitted operations a state holds: none while they are read, refused or failed. */
export function admittedOperations(state: MemberOperationsState): MemberOperations {
  return state.status === "ready" ? state.value : {};
}

/**
 * Classifies why a declared operation has no admitted descriptor:
 * - `"loading"` reports `action_not_ready` ("not ready yet").
 * - `"forbidden"` or `"ready"` with a missing descriptor (not admitted/permitted by the owner) reports
 *   `action_unavailable` with an explicit permission/admission reason rather than a misleading "not ready yet".
 * - `"error"` reports `failed` with the read error message.
 * - `"empty"` reports `action_unavailable`.
 */
export function missingOperationDescriptorResult(
  state: MemberOperationsState,
  operationName: string,
): { readonly ok: false; readonly reason: "action_not_ready" | "action_unavailable" | "failed"; readonly message: string } {
  if (state.status === "loading") {
    return {
      ok: false,
      reason: "action_not_ready",
      message: `Operation '${operationName}' is not ready yet.`,
    };
  }
  if (state.status === "forbidden") {
    return {
      ok: false,
      reason: "action_unavailable",
      message: state.reason ?? `Operation '${operationName}' is not permitted for the current user.`,
    };
  }
  if (state.status === "error") {
    return {
      ok: false,
      reason: "failed",
      message: state.message,
    };
  }
  if (state.status === "empty") {
    return {
      ok: false,
      reason: "action_unavailable",
      message: `Operation '${operationName}' is not currently available.`,
    };
  }
  return {
    ok: false,
    reason: "action_unavailable",
    message: `Operation '${operationName}' is not permitted or admitted by its owner.`,
  };
}

/** What an operations read sends: the projection's own inputs, as the member's placement fills them now. */
function operationInputs(projection: DirectProjection, inputs: MemberInputs): MemberInputs {
  return Object.fromEntries(Object.keys(projection.inputs).filter((name) => Object.hasOwn(inputs, name)).map((name) => [name, inputs[name]!]));
}

/** Reads a member's admitted operations once; a projection that names none has none, and nothing is asked. */
export async function readMemberOperations(read: PanelReadPort, projection: DirectProjection, memberPath: PublisherPath, inputs: MemberInputs) {
  if (!projection.operations || Object.keys(projection.operations).length === 0) return { status: "ready", value: {} } as const;
  return productPanelOperationsReadResponseSchema.parse(
    await read({ memberPath, operations: true, inputs: operationInputs(projection, inputs) }));
}

/**
 * A member's admitted operations, kept current: read again when the inputs they are admitted for change (the object an
 * action acts on, the form's edited object) and when `reread` is called. An answer for earlier inputs is dropped once
 * later ones were asked for; one already shown stays until its new answer arrives.
 */
export function watchMemberOperations(
  read: PanelReadPort, projection: DirectProjection, memberPath: () => PublisherPath, inputs: () => MemberInputs, active: () => boolean = () => true,
): { state: ComputedRef<MemberOperationsState>; reread(): void } {
  const state = shallowRef<MemberOperationsState>({ status: "loading" });
  let sequence = 0;
  let lastInputsKey: string | undefined;
  const keyOf = () => JSON.stringify(operationInputs(projection, inputs()));
  const reread = () => {
    if (!active()) return;
    lastInputsKey = keyOf();
    const reading = ++sequence;
    // A read that fails is the member's to show, as a datum's is: its buttons say why there is nothing to press.
    void readMemberOperations(read, projection, memberPath(), inputs()).then(
      (result) => { if (reading === sequence) state.value = result; },
      (reason: unknown) => { if (reading === sequence) state.value = { status: "error", message: reason instanceof Error ? reason.message : String(reason) }; },
    );
  };
  watch(keyOf, (key) => {
    // Skip redundant watch flushes when an explicit reread already requested the same serialized inputs.
    if (key === lastInputsKey) return;
    reread();
  }, { immediate: true });
  return { state: computed(() => state.value), reread };
}
