import { EXECUTION_CONTEXT_HEADER, carriesPreviewIdentity, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { buildBackendHeaders } from "../../utils/backend-client";
import type { AssistantSkillView } from "../assistant/skills";
import type { PanelOperationActor, PanelOperationHost } from "./server-operations";

export function operationHost(initiator: PanelOperationActor, skillView?: AssistantSkillView, executor = initiator): PanelOperationHost {
  const { credentials } = executor;
  const request = (url: string, init: NonNullable<Parameters<typeof fetch>[1]>, preview = false) => {
    const headers = new Headers(buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers));
    if (init.body instanceof FormData) headers.delete("Content-Type");
    new Headers(init.headers).forEach((value,key) => headers.set(key,value));
    if (preview) headers.set(EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader);
    return fetch(url,{...init,redirect:"error",headers});
  };
  return {
    locale: credentials.locale,
    initiator, executor, skillView,
    request: (path, init) => {
      const entry = path.slice(DATA_QUERY_GATEWAY.length);
      // A preview caller's request to a business-data write entry carries the preview identity its owner refuses;
      // every other request, a read or a definition write, reaches its owner as it would live.
      return request(config.dataQuery.baseUrl.replace(/\/$/u,"") + entry, init,
        credentials.executionKind === "preview" && carriesPreviewIdentity("/data-query", init.method ?? "GET", entry));
    },
    requestWorkbench: (path, init) => request(environment.agentRuntime().callbackUrl.replace(/\/$/u,"") + "/api" + path, init),
  };
}
