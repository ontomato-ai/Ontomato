import type { InjectionKey, DeepReadonly, Ref } from "vue";
import type { AgentHostSessionRunFrame } from "@ontomato/contracts/agent-host";

/** The page's single feed also informs the selected conversation, without another connection. */
export const sessionRunNotices: InjectionKey<DeepReadonly<Ref<AgentHostSessionRunFrame | null>>> = Symbol("session-run-notices");
