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
    const routingDraft = usePanelFormDraft("routingForm", { when: () => isMultiMode.value });
    const routingFormDraft = usePanelOutput("routingForm", "draft");

    const sourceCatalog = computed(() => {
      if (!isMultiMode.value || !Array.isArray(formValues.value.dataSources)) return [];
      return formValues.value.dataSources
        .filter((row) => row && typeof row === "object")
        .map((row) => ({
          id: typeof row.id === "string" ? row.id.trim() : "",
          adapterType: row.adapter && typeof row.adapter === "object" && typeof row.adapter.adapterType === "string"
            ? row.adapter.adapterType.trim()
            : "",
        }));
    });

    // Keep the lazy-loaded routing form's source choices in sync with unsaved data source edits.
    watch(
      [
        isMultiMode,
        sourceCatalog,
        () => Boolean(adapterDraft.value?.dirty),
        () => instance.forms.handle("routingForm")?.fields.value.length ?? 0,
      ],
      ([multi, catalog, adapterDirty, routingFieldCount]) => {
        if (!multi || routingFieldCount === 0) return;
        const routingHandle = instance.forms.handle("routingForm");
        if (!routingHandle) return;
        if (!adapterDirty && !routingHandle.dirty.value) return;
        const current = Array.isArray(routingHandle.values.value?.sourceCatalog)
          ? routingHandle.values.value.sourceCatalog
          : [];
        if (JSON.stringify(catalog) !== JSON.stringify(current)) {
          routingHandle.set("/sourceCatalog", catalog);
        }
      },
      { flush: "post" },
    );

    // Mirror routing edits into adapterForm's hidden fields while adapterForm is dirty so one Save
    // submits data sources and ontology routes atomically.
    watch(
      [isMultiMode, () => Boolean(adapterDraft.value?.dirty), routingFormDraft],
      ([multi, adapterDirty]) => {
        if (!multi || !adapterDirty) return;
        const adapterHandle = instance.forms.handle("adapterForm");
        const routingHandle = instance.forms.handle("routingForm");
        if (!adapterHandle || !routingHandle || routingHandle.fields.value.length === 0) return;
        const routingValues = routingHandle.values.value;
        if (!routingValues || typeof routingValues !== "object") return;
        if (
          routingValues.classRoutes !== undefined
          && JSON.stringify(routingValues.classRoutes) !== JSON.stringify(adapterHandle.values.value?.classRoutes)
        ) {
          adapterHandle.set("/classRoutes", routingValues.classRoutes);
        }
        if (
          routingValues.relationshipRoutes !== undefined
          && JSON.stringify(routingValues.relationshipRoutes) !== JSON.stringify(adapterHandle.values.value?.relationshipRoutes)
        ) {
          adapterHandle.set("/relationshipRoutes", routingValues.relationshipRoutes);
        }
      },
      { flush: "post" },
    );

    const pageDraft = computed(() => {
      const adapter = adapterDraft.value;
      if (!adapter) return null;
      const routing = isMultiMode.value ? routingDraft.value : null;
      const adapterDirty = adapter.dirty;
      const routingDirty = Boolean(routing?.dirty);
      const dirty = adapterDirty || routingDirty;
      const saving = adapter.saving || Boolean(routing?.saving);
      const canSave = !saving && dirty && (
        adapterDirty ? adapter.canSave : Boolean(routing?.canSave)
      );
      return {
        dirty,
        saving,
        canSave,
        save: () => {
          const adapterHandle = instance.forms.handle("adapterForm");
          const routingHandle = isMultiMode.value ? instance.forms.handle("routingForm") : undefined;
          if (adapterDirty) {
            if (isMultiMode.value && adapterHandle && routingHandle && routingHandle.fields.value.length > 0) {
              const routingValues = routingHandle.values.value;
              if (routingValues && typeof routingValues === "object") {
                if (routingValues.classRoutes !== undefined) {
                  adapterHandle.set("/classRoutes", routingValues.classRoutes);
                }
                if (routingValues.relationshipRoutes !== undefined) {
                  adapterHandle.set("/relationshipRoutes", routingValues.relationshipRoutes);
                }
              }
            }
            void adapterHandle?.submit().catch(() => undefined);
            return;
          }
          if (routingDirty) {
            void routingHandle?.submit().catch(() => undefined);
          }
        },
        discard: () => {
          void (async () => {
            const adapterHandle = instance.forms.handle("adapterForm");
            const routingHandle = isMultiMode.value ? instance.forms.handle("routingForm") : undefined;
            if (adapterDirty && adapterHandle) {
              const confirmed = await adapterHandle.reset({ confirm: true });
              if (confirmed && routingHandle) {
                await routingHandle.reset({ confirm: false });
              }
              return;
            }
            if (routingDirty && routingHandle) {
              await routingHandle.reset({ confirm: true });
            }
          })();
        },
      };
    });

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

    function onAdapterSaved() {
      const routingHandle = instance.forms.handle("routingForm");
      if (routingHandle?.dirty.value) {
        void routingHandle.reset({ confirm: false });
      }
      instance.refreshObjects();
      notify({ kind: "success", text: t("saved") });
    }

    function onRoutingSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("saved") });
    }

    return {
      t,
      pageDraft,
      isMultiMode,
      multiSources,
      selectedTestSource,
      testDisabled,
      testResetKey,
      onTestTrigger,
      onTestRead,
      onAdapterSaved,
      onRoutingSaved,
    };
  },
});
