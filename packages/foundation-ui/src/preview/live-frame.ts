import { APP_HOST_GLOBAL, type AppHost } from "@ontomato/contracts/app-host";

/** Standalone renderers have no SDK host; platform renderers explicitly register before HTML runs. */
export function registerLiveHtmlFrame(source: object) {
  const host=(window as Window & {[APP_HOST_GLOBAL]?:AppHost})[APP_HOST_GLOBAL];
  return host?.registerLiveFrame(source);
}
