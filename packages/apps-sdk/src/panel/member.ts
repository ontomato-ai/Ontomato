import { inject, type ComputedRef, type InjectionKey } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { MemberData, MemberDataState, MemberInputs } from "./direct";
import { usePanelContext } from "./context";

/*
 * The member a component is drawn as in a directly rendered panel (design 4.2): its projection with the named data it
 * declares, the data the instance reads for it, and the inputs its placement fills now. A component shows a datum
 * through `useMemberData` and asks for one more read with values of its own through `useMemberRead`; it never sends a request
 * of its own. A projection is drawn as a member in a panel's frame too, where the frame reads its data.
 */
export interface PanelMemberContext {
  readonly key: string;
  readonly projection: DirectProjection;
  readonly inputs: ComputedRef<MemberInputs>;
  readonly data: MemberData;
}

/** The member a projection is drawn as, once its projection is loaded. */
export const panelMemberKey: InjectionKey<() => PanelMemberContext> = Symbol("panel-member");

/** The member this component is drawn as, in a panel's frame or in the platform's document. */
export function useMember(): PanelMemberContext {
  const found = inject(panelMemberKey, null);
  if (!found) throw new Error("A member's component is drawn by <Projection> or a panel member, which provide its member");
  return found();
}

const member = useMember;

/** A named datum of this member, read and kept current while the component is mounted. */
export function useMemberData(name: string): ComputedRef<MemberDataState> {
  return member().data.use(name);
}

/**
 * One parameter of this member, as its component reads and sets it (a list's search, page, filter, checked or selected
 * objects): the panel state the member binds it to — by its input of that name, else its output — or, unbound, the
 * member's own value, which lives in this member alone and reaches the owner as a run-time parameter. Every datum whose
 * read takes the parameter is read again when it changes.
 */
export interface MemberParam {
  readonly value: ComputedRef<RuntimeJsonValue | null>;
  set(value: RuntimeJsonValue | null): void;
}

export function useMemberParam(name: string): MemberParam {
  return usePanelContext().instance.memberParam(member().key, name);
}

/** One more read of a named datum with values of the component's own for its read parameters, such as a form's values. */
export function useMemberRead(name: string): (params: Readonly<Record<string, RuntimeJsonValue>>) => Promise<MemberDataState> {
  const { data } = member();
  return (params) => data.read(name, params);
}
