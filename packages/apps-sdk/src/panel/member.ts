import { inject, type ComputedRef, type InjectionKey } from "vue";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { MemberData, MemberDataState, MemberInputs } from "./direct";

/*
 * The member a component is drawn as in a directly rendered panel (design 4.2): its projection with the named data it
 * declares, the data the instance reads for it, and the inputs its placement fills now. A component shows a datum
 * through `useMemberData` and asks for one more read with run inputs through `useMemberRead`; it never sends a request
 * of its own. In a panel's frame there is no member: the component reads as it did there.
 */
export interface PanelMemberContext {
  readonly key: string;
  readonly projection: DirectProjection;
  readonly inputs: ComputedRef<MemberInputs>;
  readonly data: MemberData;
}

export const panelMemberKey: InjectionKey<PanelMemberContext> = Symbol("panel-member");

/** The member this component is drawn as, or null in a panel's frame. */
export function useMember(): PanelMemberContext | null {
  return inject(panelMemberKey, null);
}

function member(): PanelMemberContext {
  const found = useMember();
  if (!found) throw new Error("A member's data is read in a directly rendered panel, which draws the component as a member");
  return found;
}

/** A named datum of this member, read and kept current while the component is mounted. */
export function useMemberData(name: string): ComputedRef<MemberDataState> {
  return member().data.use(name);
}

/** One more read of a named datum with run inputs of the component's own, such as a form's values. */
export function useMemberRead(name: string): (run: MemberInputs) => Promise<MemberDataState> {
  const { data } = member();
  return (run) => data.read(name, run);
}
