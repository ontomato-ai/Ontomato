import { computed, inject, onBeforeUnmount, onScopeDispose, shallowRef, watch, type ComputedRef, type InjectionKey } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelMemberItemKey } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { MemberData, MemberInputs } from "./direct";
import { withMemberReadRetry, type MemberDataState, type MemberReadyData } from "./member-data-state";
import { panelContextKey, usePanelContext } from "./context";
import type { MemberOperationsState } from "./member-operations";

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
  /** Optional isolated parameter store for per-slot scoped projection instances (e.g. inside `#row-detail`). */
  readonly param?: (name: string) => MemberParam;
  /** True when mounted as a per-instance scoped projection inside a Vue slot (suppresses writing top-level member outputs). */
  readonly scoped?: boolean;
  /** Row identity when mounted inside an ObjectList row Vue slot (e.g. `#row-detail`). */
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

/** A component-owned parameterized read with the same stale data and retry presentation as a bound datum. */
export function useParameterizedMemberData(name: string) {
  const read = useMemberRead(name);
  const state = shallowRef<MemberDataState>({ status: "awaiting" });
  let previous: MemberReadyData | undefined;
  let sequence = 0;
  onScopeDispose(() => { sequence += 1; });
  async function refresh(params: MemberInputs | null) {
    const reading = ++sequence;
    if (params === null) {
      previous = undefined;
      state.value = { status: "awaiting" };
      return;
    }
    state.value = { status: "loading", previous };
    const result = await Promise.resolve().then(() => read(params))
      .catch(() => ({ status: "error", message: "", unreachable: true }) as const);
    if (reading !== sequence) return;
    if (result.status === "ready") previous = result;
    else if (result.status !== "error") previous = undefined;
    // Parameterized readers can receive owner transport or schema diagnostics in an error response.
    // Show the shared localized read failure instead of formatting that text in the control.
    const safe = result.status === "error" ? { ...result, message: "", unreachable: true as const } : result;
    state.value = withMemberReadRetry(safe, previous, () => { void refresh(params); });
  }
  return { state: readerDataState(computed(() => state.value)), refresh };
}

/** Re-read one named datum (or all active data of this member) without reloading unrelated panel members. */
export function useMemberRefresh(name?: string): () => void {
  const current = member();
  const panel = inject(panelContextKey, null);
  return () => {
    if (current.data.refresh) {
      current.data.refresh(name);
    } else {
      panel?.instance.refreshObjects();
    }
  };
}

/**
 * Publish one read-only output from a projection component onto the panel instance (`outputs[member][name]`),
 * kept separate from the panel's writable `manifest.state`. Cleaned up automatically when the component unmounts.
 */
export function useMemberOutput(name: string, getter: () => RuntimeJsonValue | null): void {
  const current = member();
  if (current.scoped) return;
  const { instance } = usePanelContext();
  watch(getter, (value) => {
    instance.setMemberOutput(current.key, name, value);
  }, { immediate: true });
  onBeforeUnmount(() => {
    instance.setMemberOutput(current.key, name, null);
  });
}
