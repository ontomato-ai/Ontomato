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

/** Provider response bodies stay in logs; only readable text and HTTP status reach users. */
export function runtimeFailureMessage(failure: unknown, language = "en"): string {
  const errors = failure instanceof Error
    ? [failure, ...(failure.cause instanceof Error ? [failure.cause] : [])]
    : [];
  const structuredStatus = errors.flatMap(item => [
    (item as { status?: unknown }).status,
    (item as { statusCode?: unknown }).statusCode,
    (item as { response?: { status?: unknown } }).response?.status,
  ]).find((value): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599,
  );
  // pi-ai's stream errors expose the status as a prefix rather than a structured field.
  const text = typeof failure === "string" ? failure : failure instanceof Error ? failure.message : "";
  const prefix = /^([45]\d{2}):/u.exec(text);
  const status = structuredStatus ?? (prefix ? Number(prefix[1]) : undefined);
  const detail = status === undefined ? "" : ` (HTTP ${status})`;
  return language.startsWith("zh")
    ? `模型服务请求失败${detail}，请联系管理员查看服务日志。`
    : `The model service request failed${detail}. Contact an administrator to check the service logs.`;
}
