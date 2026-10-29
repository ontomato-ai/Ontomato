import path from "node:path";
import { ServiceLogStore } from "@ontomato/service-logging";
import { environment } from "../config/environment";
import { runtimeDataDir } from "../content/layout";
import { workbenchProduct } from "../product/installed";
import { workbenchLogging } from "../logging/logger";

let store: ServiceLogStore | undefined;
export function workbenchLogDirectory(): string {
  return process.env[workbenchProduct().logDirEnvName] || path.join(runtimeDataDir(), "logs");
}
export function initializeWorkbenchLogging(): void {
  workbenchLogging.initialize({ directory: workbenchLogDirectory(), level: environment.level() });
}
export function getWorkbenchLogStore(): ServiceLogStore {
  if (!store) {
    store = new ServiceLogStore("workbench", environment.pgConnection(), environment.pgSchema(), workbenchLogging.warn);
    workbenchLogging.attach(store);
  }
  return store;
}
export async function closeWorkbenchLogging(): Promise<void> {
  await workbenchLogging.close();
}
