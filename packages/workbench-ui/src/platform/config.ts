import { apiUrl } from "../utils/api-base";

export function readRuntimeConfig() {
  return {
    apiBase: new URL(apiUrl(""), window.location.href).href,
    initialRoute: window.__APP_CONFIG__?.INITIAL_ROUTE || "",
  };
}
