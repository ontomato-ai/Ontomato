import type { MessageKey } from "./i18n";

export function assetStatusLabel(status: string | undefined, ot: (key: MessageKey) => string) {
  if (status === "PUBLISHED" || status === "RUNNING")
    return status === "RUNNING" ? ot("running") : ot("published");
  if (status === "PENDING_REVIEW") return ot("pendingReview");
  if (status === "STOPPED") return ot("stopped");
  if (status === "UNUSED") return ot("unused");
  return status || "-";
}

