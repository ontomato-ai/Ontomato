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

/**
 * Provider failures may embed request/response bodies, so a stored error message keeps only the
 * failure class and a numeric HTTP status. The full text goes to the service log.
 */
export function runtimeFailureMessage(failure: unknown): string {
  if (!(failure instanceof Error)) return "Model request failed";
  const status = [failure, ...(failure.cause instanceof Error ? [failure.cause] : [])]
    .flatMap((item) => [
      (item as { status?: unknown }).status,
      (item as { statusCode?: unknown }).statusCode,
      (item as { response?: { status?: unknown } }).response?.status,
    ])
    .find((value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599,
    );
  return status === undefined
    ? `Model request failed (${failure.name})`
    : `Model request failed (${failure.name} ${status})`;
}
