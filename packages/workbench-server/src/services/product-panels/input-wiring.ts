import {
  panelStateIdentityField, type PanelChildObjectIdentity, type PanelMember, type PanelObjectRef,
  type PanelStateFieldRef, type PanelStateRef,
} from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { ResolvedPanelPathStep } from "./member-path";

function pinnedStateInput(ref: PanelStateRef | PanelStateFieldRef, state: ReadonlyMap<string, unknown>): unknown {
  const value = state.get(ref.state);
  return "field" in ref
    ? panelStateIdentityField(ref.field, value as PanelObjectRef | PanelChildObjectIdentity | null | undefined)
    : value;
}

/**
 * Compute server-pinned projection inputs derived strictly from server-verified sources:
 * 1. Application entry literal `use.inputs` on the content panel root (never client-controlled)
 * 2. Parent member literal/propagated inputs along any nested `memberPath` trail
 * 3. Leaf member literal inputs
 *
 * Any target or operation parameter bound to one of these pinned inputs is injected by the server and
 * cannot be overridden by client requests.
 */
export function resolvePinnedInputs(
  use: ApplicationPanelUse | undefined,
  trail: readonly ResolvedPanelPathStep[],
  leafMember: PanelMember,
  isFrameRoot: boolean,
): Map<string, unknown> {
  let pinnedState = new Map<string, unknown>();
  if (!isFrameRoot) {
    for (const [stateName, ref] of Object.entries(use?.inputs ?? {})) {
      if ("literal" in ref) pinnedState.set(stateName, ref.literal);
    }
  }
  for (const step of trail) {
    const nextPinned = new Map<string, unknown>();
    if ("target" in step.member && "fromPlatform" in step.member.target) {
      for (const [stateName, ref] of Object.entries(use?.inputs ?? {})) {
        if ("literal" in ref) nextPinned.set(stateName, ref.literal);
      }
    } else {
      for (const [childState, wire] of Object.entries(step.member.inputs ?? {})) {
        if ("literal" in wire) nextPinned.set(childState, wire.literal);
        else if ("state" in wire && pinnedState.has(wire.state)) nextPinned.set(childState, pinnedStateInput(wire, pinnedState));
      }
    }
    pinnedState = nextPinned;
  }
  const pinnedInputs = new Map<string, unknown>();
  for (const [inputName, wire] of Object.entries(leafMember.inputs ?? {})) {
    if ("literal" in wire) pinnedInputs.set(inputName, wire.literal);
    else if ("state" in wire && pinnedState.has(wire.state)) pinnedInputs.set(inputName, pinnedStateInput(wire, pinnedState));
  }
  return pinnedInputs;
}
