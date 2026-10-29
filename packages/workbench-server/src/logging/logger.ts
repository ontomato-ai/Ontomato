import { createServiceLogging } from "@ontomato/service-logging";

export const workbenchLogging = createServiceLogging("workbench");
export const createLogger = (module: string) => workbenchLogging.module(module);
export const defaultLogger = createLogger("app");
