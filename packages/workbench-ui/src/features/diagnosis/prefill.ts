import { workbenchI18n, type SupportedLocale } from "../../i18n";

/**
 * Builds the prefilled opening message for diagnosing a specific assistant turn.
 * Prefills the composer for human review and submission instead of auto-sending.
 */
export function turnDiagnosisPrefill(sessionId: string, runId: string, locale?: string): string {
  try {
    const i18n = workbenchI18n();
    const activeLocale = (locale ?? String(i18n.global.locale.value ?? "en")) as SupportedLocale;
    if (i18n.global.te("chat.diagnoseTurnPrefill", activeLocale)) {
      return i18n.global.t("chat.diagnoseTurnPrefill", { sessionId, runId });
    }
    if (activeLocale.startsWith("zh")) {
      return `请诊断此轮对话的问题（sessionId: ${sessionId}, runId: ${runId}）。`;
    }
  } catch {
    if (locale?.startsWith("zh")) {
      return `请诊断此轮对话的问题（sessionId: ${sessionId}, runId: ${runId}）。`;
    }
  }
  return `Diagnose this Turn (sessionId: ${sessionId}, runId: ${runId}).`;
}
