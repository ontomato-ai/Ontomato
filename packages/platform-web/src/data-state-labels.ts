import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { DataStateLabels } from "@ontomato/foundation-ui/data-state";

export function usePlatformDataStateLabels() {
  const { t } = useI18n();
  return computed<DataStateLabels>(() => ({
    empty: t("platform.dataEmpty"),
    noMatch: t("platform.dataNoMatch"),
    forbidden: t("platform.dataForbidden"),
    awaiting: t("platform.dataAwaiting"),
    retry: t("common.retry"),
  }));
}
