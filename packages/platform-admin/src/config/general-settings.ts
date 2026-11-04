import { computed, inject, provide, reactive, ref, type InjectionKey } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { BusinessConfig, GeneralConfigKey } from "./types";
import type { PlatformApi } from "../api";
import type { BusinessConfigProps } from "./business-config";

/*
 * The general parameters and the backend language as one draft of the whole screen. The data engine takes one setting
 * per request, so a save posts the changed ones in order; the values stored before a failure stay saved and the rest
 * stay part of the draft. The DSL timeout is shown and entered in seconds and stored in milliseconds.
 */
export interface GeneralDraft {
  knowledgeMaxResult: number;
  /** Seconds, as the interface shows it; the engine stores milliseconds. */
  dslCookerTimeoutSeconds: number;
  lang: string;
}

interface GeneralField {
  key: GeneralConfigKey;
  /** The value as the engine takes it (milliseconds for the timeout). */
  value(draft: GeneralDraft): unknown;
  /** Write a value the engine stored back into the draft's own units. */
  take(draft: GeneralDraft, value: unknown): void;
}

const fields: readonly GeneralField[] = [
  {
    key: "knowledgeMaxResult",
    value: (draft) => draft.knowledgeMaxResult,
    take: (draft, value) => (draft.knowledgeMaxResult = value as number),
  },
  {
    key: "dslCookerTimeout",
    value: (draft) => Math.round(draft.dslCookerTimeoutSeconds * 1000),
    take: (draft, value) => (draft.dslCookerTimeoutSeconds = Math.round((value as number) / 1000)),
  },
  { key: "lang", value: (draft) => draft.lang, take: (draft, value) => (draft.lang = value as string) },
];

/** The screen's one draft, shared with the tab that edits it and the header's Save. */
export type GeneralSettings = ReturnType<typeof useGeneralSettings>;

export const generalSettingsKey: InjectionKey<GeneralSettings> = Symbol("general-settings");

export function useGeneralSettings(options: {
  api: Pick<PlatformApi, "getBusinessConfig" | "saveGeneralConfig">;
  businessConfig: BusinessConfigProps;
  /** Punctuation between a failed setting's name and the service's message. */
  detail: string;
}) {
  const { t } = useI18n();
  const { api, businessConfig, detail } = options;
  const draft = reactive<GeneralDraft>({
    knowledgeMaxResult: 10,
    dslCookerTimeoutSeconds: 300,
    lang: businessConfig.defaultLanguage,
  });
  const loading = ref(false);
  const saving = ref(false);
  const loadError = ref("");
  const loaded = ref(false);
  /** The values as last saved (or read), in the draft's units. */
  const baseline = ref<GeneralDraft>({ ...draft });

  const dirty = computed(() => loaded.value && JSON.stringify(draft) !== JSON.stringify(baseline.value));

  function apply(data: BusinessConfig) {
    draft.knowledgeMaxResult = data.knowledgeMaxResult ?? 10;
    draft.dslCookerTimeoutSeconds = Math.round((data.dslCookerTimeout ?? 300000) / 1000);
    // Only languages this edition ships are selectable; any other stored value shows the default until saved explicitly.
    draft.lang = businessConfig.languageOptions.some(({ value }) => value === data.lang)
      ? data.lang
      : businessConfig.defaultLanguage;
    baseline.value = { ...draft };
    loaded.value = true;
  }

  async function load() {
    loading.value = true;
    loadError.value = "";
    try {
      const res = await api.getBusinessConfig();
      if (res?.success) apply(res.data as BusinessConfig);
      else loadError.value = res?.message || t("admin.loadConfigFailed");
    } catch (e: any) {
      loadError.value = e.message || t("admin.loadConfigFailed");
    } finally {
      loading.value = false;
    }
  }

  /** Posts the settings that differ from the saved ones, in the engine's order; returns whether every one was stored. */
  async function save() {
    if (!dirty.value) return true;
    saving.value = true;
    let failure: { key: GeneralConfigKey; message: string } | null = null;
    for (const field of fields) {
      const value = field.value(draft);
      if (JSON.stringify(value) === JSON.stringify(field.value(baseline.value))) continue;
      try {
        const res = await api.saveGeneralConfig(field.key, value);
        if (!res?.success) throw new Error(res?.message || t("admin.saveFailed"));
        field.take(baseline.value, value);
      } catch (e: any) {
        failure = { key: field.key, message: e?.message || t("admin.saveFailed") };
        break;
      }
    }
    saving.value = false;
    if (failure) {
      ElMessage.error(`${t(`admin.generalSettingNames.${failure.key}`)}${detail}${failure.message}`);
      return false;
    }
    ElMessage.success(t("admin.configSaveSuccess"));
    return true;
  }

  const settings = { draft, loading, saving, loadError, loaded, dirty, load, save };
  provide(generalSettingsKey, settings);
  return settings;
}

/** The general screen's draft as the tab reads it (the page provides it; a tab outside the page is a mistake). */
export function useGeneralDraft(): GeneralSettings {
  const settings = inject(generalSettingsKey);
  if (!settings) throw new Error("The general settings tab must be mounted inside the system settings page");
  return settings;
}
