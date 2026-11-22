import { computed, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import type { DataStateLabels } from "@ontomato/foundation-ui/data-state";

/**
 * The words a component shows a datum's state with, in the reader's language: the platform's, except an empty answer a
 * component words itself (a list's own empty text, a chart's).
 */
export function useDataStateLabels(empty?: () => string): ComputedRef<DataStateLabels> {
  const { t } = useI18n();
  return computed(() => ({
    empty: empty?.() ?? t("platform.dataEmpty"),
    noMatch: t("platform.dataNoMatch"),
    forbidden: t("platform.dataForbidden"),
    awaiting: t("platform.dataAwaiting"),
    retry: t("common.retry"),
  }));
}
