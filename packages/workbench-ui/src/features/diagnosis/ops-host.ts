import type { InjectionKey } from "vue";
import type { DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { createAgentHostClient } from "@ontomato/agent-shell-ui";
import { nodeApiFetch } from "../../utils/api";
export const diagnosisActionKey: InjectionKey<(target: DiagnosisTarget, fromRoute?: boolean) => Promise<boolean>> = Symbol("diagnosis-action");
export const createDiagnosisClient = () => createAgentHostClient({
  request: (path, init) => nodeApiFetch(`/observe/agent${path}`, init.method ?? "GET", typeof init.body === "string" ? JSON.parse(init.body) : undefined, { headers: init.headers, signal: init.signal }),
});
