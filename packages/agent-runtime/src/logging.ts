import { createServiceLogging } from "@ontomato/service-logging";
export const runtimeLogging = createServiceLogging("agent-runtime");
export const runtimeLogger = runtimeLogging.module("runtime");

/** External provider failures may embed request/response bodies in their message. Keep class and stack frames only. */
export function runtimeDiagnostic(failure: unknown): Error {
  const error = new Error("Runtime operation failed");
  if (failure instanceof Error) {
    error.name = failure.name;
    error.stack = `${error.name}: ${error.message}\n${(failure.stack ?? "").split("\n").filter(line => /^\s+at /u.test(line)).join("\n")}`;
  }
  return error;
}
