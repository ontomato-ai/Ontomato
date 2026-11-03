import { defineComponent, h, type PropType } from "vue";
import { ElButton, ElOption, ElSelect } from "element-plus";
import { sharedText, type SharedKey } from "@ontomato/ontology-manager/i18n";
import type { ManagerShellPreferences } from "./shell";

/** Message key of each locale's display name, as in the workbench language menu. */
function localeLabelKey(locale: string) {
  return `lang.${locale.replace("-", "")}` as SharedKey;
}

/** The page's own theme and language controls; the language control appears only with more than one locale. */
export const ShellHeaderControls = defineComponent({
  name: "ShellHeaderControls",
  props: {
    preferences: { type: Object as PropType<ManagerShellPreferences>, required: true },
  },
  setup(props) {
    return () => {
      const { preferences } = props;
      const messages = preferences.messages.value;
      const dark = preferences.theme.value === "dark";
      return h("div", { class: "manager-shell-controls" }, [
        preferences.locales.length > 1
          ? h(
              ElSelect,
              {
                class: "manager-shell-locale",
                size: "small",
                modelValue: preferences.locale.value,
                "aria-label": sharedText(messages, "lang.switch"),
                "onUpdate:modelValue": (value: string) => preferences.setLocale(value),
              },
              () =>
                preferences.locales.map((locale) =>
                  h(ElOption, { key: locale, value: locale, label: sharedText(messages, localeLabelKey(locale)) })
                )
            )
          : null,
        h(
          ElButton,
          {
            class: "manager-shell-theme",
            text: true,
            size: "small",
            onClick: () => preferences.setTheme(dark ? "light" : "dark"),
          },
          () => sharedText(messages, dark ? "theme.light" : "theme.dark")
        ),
      ]);
    };
  },
});
