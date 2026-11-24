import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
} from "@ontomato/sdk/panel";

const SETTINGS_REF = { className: "platform:GeneralSettings", primaryKey: "general" };

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    if (!instance.state.values.value.settings) {
      instance.state.set("settings", SETTINGS_REF);
    }
    const generalDraft = usePanelFormDraft("generalForm");

    function onSettingsSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("settings.saved") });
    }

    return {
      t,
      generalDraft,
      onSettingsSaved,
    };
  },
});
