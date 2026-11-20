import { computed, effectScope, getCurrentInstance, getCurrentScope, inject, shallowRef, toValue, watch, type ComputedRef, type EffectScope, type MaybeRefOrGetter } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { MemberDataState } from "./direct";
import { directMountKey } from "./direct-projection";

/*
 * Data the panel's own code draws (big main's ruling, 2026-11-20): a member the panel declares, whose projection (a
 * `PanelData` one, or any other) names the data, read the way every member's data is — through the platform's one read
 * entry, by the projection's read, its mappings and the object it needs — and handed to the page's code to draw in its
 * own way. The author names the member and the datum; nothing about the read itself is written in the page.
 *
 * It is read again when the panel state the member binds changes and when an operation reports what it shows changed;
 * a datum whose object or required parameter has no value waits, unread. Values the code gives itself (a page, a
 * keyword) are the member's own run-time values, which the platform checks against the catalogue and the read.
 */

/**
 * One datum of one member, kept current while the calling component is mounted.
 *
 * ```js
 * const rows = usePanelData("list", "rows", () => ({ page: { number: page.value, size: 20 } }));
 * // rows.value: { status: "loading" | "awaiting" | "ready" | "empty" | "forbidden" | "error", value?, message? }
 * ```
 */
export function usePanelData(
  member: string,
  name: string,
  runtimeParams?: MaybeRefOrGetter<Readonly<Record<string, RuntimeJsonValue | null>>>,
): ComputedRef<MemberDataState> {
  // Where it is called comes first: outside a component's setup, or after an await in it, nothing it needs can be found.
  if (!getCurrentInstance())
    throw new Error("Call usePanelData in a component's setup, before any await: it reads the member through the component that calls it");
  const mount = inject(directMountKey, null);
  if (!mount) throw new Error("usePanelData reads in a panel the platform runs in its own page; this component is not drawn by one");
  const { instance } = mount;
  if (!Object.hasOwn(instance.direct.members, member)) throw new Error(`The panel declares no member '${member}'`);
  const scope = getCurrentScope();
  if (!scope) throw new Error("usePanelData is called in a component's setup");

  // The code's own values are the member's own: set, they reach every read of the member that takes them.
  if (runtimeParams !== undefined) {
    watch(() => ({ ...toValue(runtimeParams) }), (values) => {
      for (const [param, value] of Object.entries(values)) instance.memberParam(member, param).set(value);
    }, { immediate: true });
  }

  const shown = shallowRef<ComputedRef<MemberDataState> | null>(null);
  const failure = shallowRef<Error | null>(null);
  let reading: EffectScope | undefined;
  // Read from the member as the instance holds it, and again from its newer definition when that changes.
  watch(() => instance.projectionVersion(member), () => {
    reading?.stop();
    const current = reading = scope.run(() => effectScope())!;
    shown.value = null;
    failure.value = null;
    void instance.memberContext(member).then((context) => {
      if (current !== reading) return;
      if (!Object.hasOwn(context.projection.data, name))
        throw new Error(`The projection of member '${member}' declares no datum '${name}'`);
      shown.value = current.run(() => context.data.use(name))!;
    }).catch((reason: unknown) => {
      if (current === reading) failure.value = reason instanceof Error ? reason : new Error(String(reason));
    });
  }, { immediate: true });

  return computed(() => {
    if (failure.value) return { status: "error", message: failure.value.message };
    return shown.value?.value ?? { status: "loading" };
  });
}
