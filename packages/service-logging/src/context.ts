import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { serviceLogFormat, serviceLogCorrelationSchema, type ServiceLogContext } from "@ontomato/contracts/service-logging";

const storage = new AsyncLocalStorage<ServiceLogContext>();
export const getServiceLogContext = (): ServiceLogContext => storage.getStore() ?? {};
export function withServiceLogContext<T>(context: ServiceLogContext, action: () => T): T {
  return storage.run({ ...getServiceLogContext(), ...context }, action);
}
export function updateServiceLogContext(context: ServiceLogContext): void {
  const current = storage.getStore();
  if (current) Object.assign(current, context);
}
export function correlationId(value?: unknown): string {
  const parsed = serviceLogCorrelationSchema.safeParse(value);
  return parsed.success ? parsed.data : randomUUID();
}
export function logHeaders(context: ServiceLogContext = getServiceLogContext()): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const key of ["correlationId", "runId", "sessionId"] as const) {
    const value = context[key];
    if (value && !/[\r\n]/u.test(value)) headers[serviceLogFormat.headers[key].toLowerCase()] = value;
  }
  return headers;
}
