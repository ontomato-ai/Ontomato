import { computed, onScopeDispose, readonly, shallowRef, watch } from "vue";
import { buildExecutionContext, type AppExecutionContext } from "@ontomato/contracts/build-tests";
import { builderApi } from "./api";

/** A build-test context Java answered for a workspace: what the preview frame runs on. */
export type BuildTestBinding = Extract<AppExecutionContext, { kind: "build-test" }>;
/**
 * What the preview's line shows: Java's last answer, or this page's own LOADING before the workspace's first answer and
 * UNAVAILABLE while reads fail. No frame runs on those two.
 */
export type BuildTestView = Omit<BuildTestBinding, "status"> & {
  status: BuildTestBinding["status"] | "LOADING" | "UNAVAILABLE";
};

/**
 * A read-only mirror of the workspace's test context, read from Java every 5 seconds; only Java changes its lifecycle.
 *
 * `binding` is Java's last answer for the workspace, null before the first one. A failed read keeps it: Java checks the
 * context again on every business call, so a failed read is no reason to rebind or reload the frame. `state` is what the
 * preview's line shows.
 */
export function useBuildTestState(workspaceId: () => string | null) {
  const binding = shallowRef<BuildTestBinding | null>(null);
  /** Why the last read failed; null once a read succeeds. */
  const failure = shallowRef<string | null>(null);
  let revision = 0;
  async function refresh() {
    const id = workspaceId(), read = ++revision;
    if (!id) return;
    try {
      const context = await builderApi.buildTestStatus(id);
      if (read !== revision) return;
      binding.value = buildExecutionContext(id, context);
      failure.value = null;
    } catch (error) {
      if (read === revision) failure.value = error instanceof Error ? error.message : String(error);
    }
  }
  watch(workspaceId, () => {
    binding.value = null;
    failure.value = null;
    void refresh();
  }, { immediate: true });
  const timer = setInterval(refresh, 5000);
  onScopeDispose(() => { clearInterval(timer); revision++; });

  const state = computed<BuildTestView>(() => {
    const none = buildExecutionContext(workspaceId() ?? "", null);
    if (failure.value !== null) return { ...none, status: "UNAVAILABLE", error: failure.value };
    return binding.value ?? { ...none, status: "LOADING" };
  });
  return { binding: readonly(binding), state, refresh };
}
