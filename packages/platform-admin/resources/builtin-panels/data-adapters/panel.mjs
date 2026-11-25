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

    const configured = usePanelOutput("sandboxCapability", "configured");
    const sandboxSupported = usePanelOutput("sandboxCapability", "sandboxSupported");

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

    const routingValues = computed(() => (
      routingFormDraft.value && typeof routingFormDraft.value === "object" && !Array.isArray(routingFormDraft.value)
        ? routingFormDraft.value
        : {}
    ));

    function relationshipRow(index) {
      const rows = routingValues.value.relationshipRoutes;
      return Array.isArray(rows) && typeof index === "number" ? rows[index] ?? null : null;
    }

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
        const routing = routingHandle.values.value;
        if (!routing || typeof routing !== "object") return;
        if (
          routing.classRoutes !== undefined
          && JSON.stringify(routing.classRoutes) !== JSON.stringify(adapterHandle.values.value?.classRoutes)
        ) {
          adapterHandle.set("/classRoutes", routing.classRoutes);
        }
        if (
          routing.relationshipRoutes !== undefined
          && JSON.stringify(routing.relationshipRoutes) !== JSON.stringify(adapterHandle.values.value?.relationshipRoutes)
        ) {
          adapterHandle.set("/relationshipRoutes", routing.relationshipRoutes);
        }
      },
      { flush: "post" },
    );

    // Single-source inline connection test report; cleared whenever mode or connection fields change.
    const singleTestOutcome = ref(null);
    let singleTestRevision = 0;
    let singleTestTriggerRevision = 0;

    const singleTestDisabled = computed(() => !formValues.value.adapterMode || isMultiMode.value);
    const singleTestSignature = computed(() => JSON.stringify({
      adapterMode: formValues.value.adapterMode ?? "",
      connection: formValues.value.connection ?? null,
    }));

    watch(singleTestSignature, (next, prev) => {
      if (next !== prev) {
        singleTestRevision += 1;
        singleTestOutcome.value = null;
      }
    });

    function onSingleTestTrigger() {
      if (singleTestDisabled.value) return;
      singleTestTriggerRevision = singleTestRevision;
      instance.state.set("testSourceId", "");
    }

    function onSingleTestRead(result) {
      if (singleTestTriggerRevision !== singleTestRevision) return;
      singleTestOutcome.value = { result, error: null };
    }

    function onSingleTestError(error) {
      if (singleTestTriggerRevision !== singleTestRevision) return;
      singleTestOutcome.value = { result: null, error };
    }

    // Multi-source per-card test reports keyed by row key so cards never overwrite each other.
    const cardTestOutcomes = ref({});
    const pendingCardSignatures = new Map();

    function sourceIdOf(item) {
      return item && typeof item === "object" && typeof item.id === "string"
        ? item.id.trim()
        : "";
    }

    function cardSignature(item) {
      if (!item || typeof item !== "object") return "";
      return JSON.stringify({
        id: sourceIdOf(item),
        adapter: item.adapter ?? null,
      });
    }

    function cardTestOutcome(key) {
      return cardTestOutcomes.value[key] ?? null;
    }

    function onCardTestTrigger(item, key) {
      const id = sourceIdOf(item);
      if (!id) return;
      pendingCardSignatures.set(key, cardSignature(item));
      instance.state.set("testSourceId", id);
    }

    function onCardTestRead(item, key, result) {
      const signature = cardSignature(item);
      const expected = pendingCardSignatures.get(key);
      if (expected !== undefined && expected !== signature) return;
      cardTestOutcomes.value = {
        ...cardTestOutcomes.value,
        [key]: { result, error: null, signature },
      };
    }

    function onCardTestError(item, key, error) {
      const signature = cardSignature(item);
      const expected = pendingCardSignatures.get(key);
      if (expected !== undefined && expected !== signature) return;
      cardTestOutcomes.value = {
        ...cardTestOutcomes.value,
        [key]: { result: null, error, signature },
      };
    }

    function clearAllTestOutcomes() {
      singleTestRevision += 1;
      singleTestOutcome.value = null;
      cardTestOutcomes.value = {};
      pendingCardSignatures.clear();
    }

    // Prune removed cards and clear stale outcomes only for cards whose id/adapter changed.
    watch(
      [isMultiMode, () => formValues.value.dataSources],
      ([multi, rows]) => {
        if (!multi || !Array.isArray(rows)) {
          if (Object.keys(cardTestOutcomes.value).length > 0) {
            cardTestOutcomes.value = {};
            pendingCardSignatures.clear();
          }
          return;
        }
        const currentByKey = new Map();
        rows.forEach((row, index) => {
          const sig = cardSignature(row);
          const rawId = row && typeof row === "object" ? row.id : undefined;
          if (typeof rawId === "string" || typeof rawId === "number") {
            currentByKey.set(`key:${rawId}`, sig);
          }
          currentByKey.set(`new:${index}`, sig);
        });
        const existing = cardTestOutcomes.value;
        let changed = false;
        const next = {};
        for (const [key, entry] of Object.entries(existing)) {
          if (currentByKey.has(key) && currentByKey.get(key) === entry.signature) {
            next[key] = entry;
          } else {
            changed = true;
          }
        }
        if (changed) cardTestOutcomes.value = next;
      },
      { deep: true },
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
              const routing = routingHandle.values.value;
              if (routing && typeof routing === "object") {
                if (routing.classRoutes !== undefined) {
                  adapterHandle.set("/classRoutes", routing.classRoutes);
                }
                if (routing.relationshipRoutes !== undefined) {
                  adapterHandle.set("/relationshipRoutes", routing.relationshipRoutes);
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
              if (confirmed) {
                if (routingHandle) await routingHandle.reset({ confirm: false });
                clearAllTestOutcomes();
              }
              return;
            }
            if (routingDirty && routingHandle) {
              const confirmed = await routingHandle.reset({ confirm: true });
              if (confirmed) clearAllTestOutcomes();
            }
          })();
        },
      };
    });

    function notifySaved(outcome) {
      const capability = outcome?.data?.sandboxCapability;
      if (capability?.status === "failed") {
        notify({ kind: "warning", text: t("sandbox.savedFailed", { reason: capability.reason }) });
      } else if (capability?.status === "unsupported") {
        notify({ kind: "info", text: t("sandbox.savedUnsupported") });
      } else {
        notify({ kind: "success", text: t("saved") });
      }
    }

    function onSandboxChecked(outcome) {
      if (outcome.kind !== "success") return;
      instance.refreshObjects();
      const capability = outcome.data.sandboxCapability;
      switch (capability.status) {
        case "passed":
          notify({ kind: "success", text: t("sandbox.passed") });
          break;
        case "failed":
          notify({ kind: "warning", text: t("sandbox.failed", { reason: capability.reason }) });
          break;
        case "unsupported":
          notify({ kind: "info", text: t("sandbox.unsupported") });
          break;
      }
    }

    function onAdapterSaved(outcome) {
      const routingHandle = instance.forms.handle("routingForm");
      if (routingHandle?.dirty.value) {
        void routingHandle.reset({ confirm: false });
      }
      instance.refreshObjects();
      notifySaved(outcome);
    }

    function onRoutingSaved(outcome) {
      instance.refreshObjects();
      notifySaved(outcome);
    }

    return {
      t,
      pageDraft,
      configured,
      sandboxSupported,
      onSandboxChecked,
      isMultiMode,
      relationshipRow,
      singleTestOutcome,
      singleTestDisabled,
      onSingleTestTrigger,
      onSingleTestRead,
      onSingleTestError,
      sourceIdOf,
      cardTestOutcome,
      onCardTestTrigger,
      onCardTestRead,
      onCardTestError,
      onAdapterSaved,
      onRoutingSaved,
    };
  },
});
