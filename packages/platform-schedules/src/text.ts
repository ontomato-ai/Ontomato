import { useI18n } from "vue-i18n";

/** The shared frequency control uses the same locale as the rest of the owner form. */
export function useScheduleText() {
  const { t: translate, locale } = useI18n();
  const t = (key: string, values: Record<string, unknown> = {}) => translate(`platformSchedules.${key}`, values);
  return { t, locale };
}
