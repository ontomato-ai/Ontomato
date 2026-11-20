import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { buildBackendHeaders } from "../../utils/backend-client";
import type { AssistantSkillView } from "../assistant/skills";
import type { PanelOperationActor, PanelOperationHost } from "./server-operations";

export function operationHost(initiator: PanelOperationActor, skillView?: AssistantSkillView, executor = initiator): PanelOperationHost {
  const { credentials } = executor;
  const request = (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers));
    if (init.body instanceof FormData) headers.delete("Content-Type");
    new Headers(init.headers).forEach((value,key) => headers.set(key,value));
    return fetch(url,{...init,redirect:"error",headers});
  };
  return {
    locale: credentials.locale,
    initiator, executor, skillView,
    request: (path, init) => request(config.dataQuery.baseUrl.replace(/\/$/u,"") + path.slice(DATA_QUERY_GATEWAY.length), init),
    requestWorkbench: (path, init) => request(environment.agentRuntime().callbackUrl.replace(/\/$/u,"") + "/api" + path, init),
  };
}
