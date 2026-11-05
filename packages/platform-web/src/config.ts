import { apiUrl } from "@ontomato/workbench-ui";

export function readRuntimeConfig() {
  return {
    apiBase: new URL(apiUrl(""), window.location.href).href,
    initialRoute: window.__APP_CONFIG__?.INITIAL_ROUTE || "",
  };
}
