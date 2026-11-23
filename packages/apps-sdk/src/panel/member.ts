import { computed, inject, type ComputedRef, type InjectionKey } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelMemberItemKey } from "@ontomato/contracts/panel-object-ref";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { MemberData, MemberDataState, MemberInputs } from "./direct";
import { usePanelContext } from "./context";
import type { MemberOperationsState } from "./member-operations";
import type { MemberFormDraftChannel } from "./member-forms";
import type { PanelWriteResult } from "./instance";

/**
 * Row-scoped write operation runner provided to components mounted inside `listColumn` or `listRowDetail`.
 * Automatically attaches the row's `itemKey` on `memberPath` and the host list's `rowContext`; callers
 * cannot override the operation target or any `operation.params` bound by the panel member.
 */
export interface PanelMemberRowOperation {
  run(
    operationName: string,
    input?: Readonly<Record<string, unknown>>,
    hooks?: { onConfirmed?: () => void },
  ): Promise<PanelWriteResult>;
}

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
  /** The operations its projection names, as the owners admit them for its inputs now, by local name. */
  readonly operations: ComputedRef<MemberOperationsState>;
  /** Pending draft channel held by a directly rendered ObjectForm member so unmounted forms hand off drafts on mount. */
  readonly formDraft?: MemberFormDraftChannel;
  /** Optional isolated parameter store for per-row mounted members (`listRowDetail` / `listColumn`). */
  readonly param?: (name: string) => MemberParam;
  /** Present on `listColumn` / `listRowDetail` row instances: executes a declared write operation on that row. */
  readonly rowOperation?: PanelMemberRowOperation;
  /** Present on `listColumn` / `listRowDetail` row instances: canonical `itemKey` of the mounted row. */
  readonly rowItemKey?: PanelMemberItemKey;
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

/**
 * A datum as the reader is shown it: a read the platform never answered is said in the reader's language, not with the
 * browser's words for a dropped request; a reason the owner or the platform gave stays its own.
 */
export function readerDataState(state: Readonly<ComputedRef<MemberDataState>>): ComputedRef<MemberDataState> {
  const { t } = useI18n();
  return computed(() => {
    const shown = state.value;
    return shown.status === "error" && shown.unreachable ? { ...shown, message: t("platform.dataUnreachable") } : shown;
  });
}

/** A named datum of this member, read and kept current while the component is mounted. */
export function useMemberData(name: string): ComputedRef<MemberDataState> {
  return readerDataState(member().data.use(name));
}

/** This member's operations, as their owners admit them now, by the projection's local name. */
export function useMemberOperations(): ComputedRef<MemberOperationsState> {
  return member().operations;
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
  const current = member();
  if (current.param) return current.param(name);
  return usePanelContext().instance.memberParam(current.key, name);
}

/** One more read of a named datum with values of the component's own for its read parameters, such as a form's values. */
export function useMemberRead(name: string): (params: Readonly<Record<string, RuntimeJsonValue>>) => Promise<MemberDataState> {
  const { data } = member();
  return (params) => data.read(name, params);
}
