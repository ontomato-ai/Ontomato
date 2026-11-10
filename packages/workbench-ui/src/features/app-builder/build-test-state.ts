import { onScopeDispose, readonly, shallowRef, watch } from "vue";
import { buildExecutionContext, type AppExecutionContext } from "@ontomato/contracts/build-tests";
import { builderApi } from "./api";

/** A read-only mirror for preview wiring and status presentation. Only Java changes lifecycle state. */
export function useBuildTestState(workspaceId: () => string | null) {
  const state=shallowRef<AppExecutionContext>(buildExecutionContext(workspaceId() ?? "",null));
  let revision=0;
  async function refresh() {
    const id=workspaceId(), read=++revision;
    if(!id) { state.value=buildExecutionContext("",null);return; }
    try {
      const context=await builderApi.buildTestStatus(id);
      if(read===revision) state.value=buildExecutionContext(id,context);
    } catch(error) {
      if(read===revision) state.value={...buildExecutionContext(id,null),status:"UNAVAILABLE",error:error instanceof Error?error.message:String(error)};
    }
  }
  watch(workspaceId,(id)=>{state.value=buildExecutionContext(id ?? "",null);void refresh();},{immediate:true});
  const timer=setInterval(refresh,5000);
  onScopeDispose(()=>{clearInterval(timer);revision++;});
  return {state:readonly(state),refresh};
}
