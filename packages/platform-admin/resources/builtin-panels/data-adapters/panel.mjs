import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DATA_ADAPTER_TYPE = "platform:DataAdapterConfig";
const MULTI_MODE = "multi";

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    if (!instance.state.values.value.domain) {
      instance.state.set("domain", { className: DATA_ADAPTER_TYPE, primaryKey: "domain" });
    }

    const adapterDraft = usePanelFormDraft("adapterForm");
    const formDraft = usePanelOutput("adapterForm", "draft");

    const formValues = computed(() => (
      formDraft.value && typeof formDraft.value === "object" && !Array.isArray(formDraft.value)
        ? formDraft.value
        : {}
    ));

    const isMultiMode = computed(() => formValues.value.adapterMode === MULTI_MODE);

    const multiSources = computed(() => {
      if (!isMultiMode.value || !Array.isArray(formValues.value.dataSources)) return [];
      const seen = new Set();
      const options = [];
      for (const row of formValues.value.dataSources) {
        if (!row || typeof row !== "object") continue;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const label = typeof row.label === "string" ? row.label.trim() : "";
        options.push({
          id,
          optionLabel: label && label !== id ? `${label} (${id})` : id,
        });
      }
      return options;
    });

    const selectedTestSource = computed({
      get: () => (typeof instance.state.values.value.testSourceId === "string"
        ? instance.state.values.value.testSourceId
        : ""),
      set: (value) => {
        instance.state.set("testSourceId", typeof value === "string" ? value : "");
      },
    });

    watch(
      [isMultiMode, multiSources],
      ([multi, sources]) => {
        if (!multi) {
          if (selectedTestSource.value) instance.state.set("testSourceId", "");
          return;
        }
        const ids = new Set(sources.map((item) => item.id));
        if (!selectedTestSource.value || !ids.has(selectedTestSource.value)) {
          instance.state.set("testSourceId", sources[0]?.id ?? "");
        }
      },
      { immediate: true },
    );

    const testDisabled = computed(() => {
      if (!formValues.value.adapterMode) return true;
      if (isMultiMode.value) return !selectedTestSource.value;
      return false;
    });

    // Clear any stale connection test result as soon as the tested draft values or selected source change.
    const testResetKey = ref(0);
    const testActivated = ref(false);
    const testedSignature = computed(() => JSON.stringify({
      adapterMode: formValues.value.adapterMode ?? "",
      connection: formValues.value.connection ?? null,
      dataSources: formValues.value.dataSources ?? null,
      testSourceId: selectedTestSource.value,
    }));

    watch(testedSignature, (next, prev) => {
      if (next !== prev && testActivated.value) {
        testActivated.value = false;
        testResetKey.value += 1;
      }
    });

    function onTestTrigger() {
      if (!testDisabled.value) testActivated.value = true;
    }

    function onTestRead() {
      testActivated.value = true;
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("saved") });
    }

    return {
      t,
      adapterDraft,
      isMultiMode,
      multiSources,
      selectedTestSource,
      testDisabled,
      testResetKey,
      onTestTrigger,
      onTestRead,
      onSaved,
    };
  },
});
