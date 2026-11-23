import { computed, ref, watch } from "vue";
import {
  draftTarget,
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const TYPE = "platform:MetricView";

/*
 * Metric views panel: full-width catalog switching to a full-width detail view.
 *
 * Reads, form validation, read-only rules, deletion availability/impact, batch publication status and both unsaved-draft
 * trials live with the MetricView owner behind the declared official projections (no raw persisted record reads). This
 * script coordinates only view visibility, guarded back navigation, batch status toast feedback, and the test dialog
 * that reads unsaved form draft values for live trial execution without saving.
 */
await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance, t } = panel;
    const state = instance.state.values;

    const selected = computed(() => state.value.selected ?? null);
    const creating = computed(() => state.value.creating === true);
    const detailVisible = computed(() => selected.value !== null || creating.value);
    const setCreating = (value) => instance.state.set("creating", value);

    const batchStatus = computed({
      get: () => state.value.batchStatus || "PUBLISHED",
      set: (next) => instance.state.set("batchStatus", next || "PUBLISHED"),
    });

    function closeDetail() {
      instance.state.setState({ selected: null, creating: false });
    }

    const detailBack = usePanelBack(() => detailVisible.value, closeDetail, { pushHistory: true });

    function backToCatalog() {
      void detailBack.back();
    }

    // Open the matching metric (or create mode) when an assistant draft arrives.
    watch(instance.draft, (draft) => {
      if (!draft) return;
      const target = draftTarget(draft);
      if (target.kind === "update") {
        if (selected.value?.primaryKey !== target.id) {
          instance.state.setState({
            selected: { className: TYPE, primaryKey: target.id },
            creating: false,
          });
        }
      } else if (!selected.value) {
        setCreating(true);
      }
    }, { immediate: true });

    watch(selected, (next) => {
      if (next) setCreating(false);
    });

    // Track whether the selected metric loaded once via ObjectHeader's declared status output; return to catalog if deleted.
    const headerStatus = usePanelOutput("header", "status");
    const formLabel = usePanelOutput("definition", "label");
    let loadedPrimaryKey = null;
    watch([selected, headerStatus], ([current, status]) => {
      if (!current) {
        loadedPrimaryKey = null;
        return;
      }
      if (status === "ready") {
        loadedPrimaryKey = current.primaryKey;
      } else if ((status === "error" || status === "empty") && loadedPrimaryKey === current.primaryKey) {
        loadedPrimaryKey = null;
        closeDetail();
      }
    }, { immediate: true });

    // Unsaved form input is explicitly permitted for live draft preview and trial execution.
    const form = computed(() => instance.forms.handle("definition") ?? null);
    const formValues = computed(() => form.value?.values.value ?? {});
    const detailTitle = computed(() => {
      if (!selected.value) {
        const draftName = typeof formValues.value.name === "string" ? formValues.value.name.trim() : "";
        return draftName || t("metricViews.new");
      }
      const label = typeof formLabel.value === "string" ? formLabel.value.trim() : "";
      return label || selected.value.primaryKey;
    });

    const functionRecord = computed(() => formValues.value.function ?? {});
    const parameterDefs = computed(() => {
      const declared = functionRecord.value.queryPackage?.manifest?.parameterDefs ?? functionRecord.value.parameters ?? [];
      return Array.isArray(declared) ? declared.filter((def) => def && def.name && String(def.name).trim() !== "") : [];
    });
    const bindingRows = computed(() => (Array.isArray(formValues.value.bindings) ? formValues.value.bindings : []));

    function onSaved() {
      setCreating(false);
      panel.notify({ kind: "success", text: t("metricViews.saved") });
    }

    function onDiscarded() {
      setCreating(false);
    }

    function onRemoveDone(outcome) {
      if (outcome?.kind === "success") closeDetail();
    }

    // ---- Batch publication status notification ----

    function onBatchStatusDone(outcome) {
      if (outcome?.kind !== "batch") return;
      const total = outcome.items.length;
      const done = outcome.items.filter((item) => item.outcome.kind === "success").length;
      panel.notify({
        kind: done === total ? "success" : "warning",
        text: t("metricViews.batchDone", { done, total }),
      });
    }

    // ---- Test current unsaved draft ----

    const trial = usePanelOperation("definition", "test");
    const trialJson = usePanelOperation("definition", "testExecute");
    const trialReady = computed(() => Boolean(trial.operation.value));
    const trialJsonReady = computed(() => Boolean(trialJson.operation.value));

    const testOpen = ref(false);
    const testSource = ref("explicit");
    const testValues = ref({});
    const testTab = ref("markdown");
    const markdownView = ref("preview");
    const testMarkdown = ref("");
    const testJson = ref("");
    const truncation = ref(null);
    const testFailure = ref("");
    const testingMarkdown = ref(false);
    const testingJson = ref(false);

    function errorText(reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }

    function parameterLabel(parameter) {
      return parameter.type ? `${parameter.name} (${parameter.type})` : parameter.name;
    }

    function bindingLabel(row, index) {
      const name = row?.name ? String(row.name).trim() : "";
      return name ? t("metricViews.testBinding", { name }) : t("metricViews.testBindingUnnamed", { index: index + 1 });
    }

    function openTest() {
      testSource.value = "explicit";
      testTab.value = "markdown";
      markdownView.value = "preview";
      testMarkdown.value = "";
      testJson.value = "";
      truncation.value = null;
      testFailure.value = "";
      const initial = {};
      for (const def of parameterDefs.value) {
        initial[def.name] = JSON.stringify(def.value === undefined ? null : def.value);
      }
      testValues.value = initial;
      testOpen.value = true;
    }

    function draftValues() {
      const current = formValues.value;
      if (!current || !current.function) throw new Error(t("metricViews.testNoDraft"));
      return JSON.parse(JSON.stringify(current));
    }

    function typedParameters() {
      const parsed = {};
      for (const def of parameterDefs.value) {
        const text = testValues.value[def.name];
        if (typeof text !== "string" || text.trim() === "") {
          parsed[def.name] = null;
          continue;
        }
        try {
          parsed[def.name] = JSON.parse(text);
        } catch {
          throw new Error(t("metricViews.testInvalidValue", { name: def.name }));
        }
      }
      return parsed;
    }

    function chosenParameters() {
      if (testSource.value === "explicit") return typedParameters();
      const row = bindingRows.value[testSource.value];
      return row?.parameters ? JSON.parse(JSON.stringify(row.parameters)) : {};
    }

    async function runMarkdown() {
      testFailure.value = "";
      testingMarkdown.value = true;
      try {
        const result = await trial.run({
          draft: draftValues(),
          parameters: chosenParameters(),
        });
        testMarkdown.value = (result?.kind === "markdown" && result.markdown) || t("metricViews.testNoResult");
        testTab.value = "markdown";
        markdownView.value = "preview";
      } catch (error) {
        testFailure.value = t("metricViews.testFailed", { message: errorText(error) });
      } finally {
        testingMarkdown.value = false;
      }
    }

    async function runJson() {
      testFailure.value = "";
      testingJson.value = true;
      try {
        // Pass the form's current draft parameters (never bindingId) so unsaved edits to a binding's values are tested.
        const result = await trialJson.run({
          draft: draftValues(),
          parameters: chosenParameters(),
        });
        const value = result?.kind === "json" ? result.value : null;
        testJson.value = JSON.stringify(value && "result" in value ? value.result : value, null, 2);
        truncation.value = value?.truncated
          ? { rowLimit: value.rowLimit ?? null, hint: value.truncationHint ?? null }
          : null;
        testTab.value = "json";
      } catch (error) {
        testFailure.value = t("metricViews.testFailed", { message: errorText(error) });
      } finally {
        testingJson.value = false;
      }
    }

    return {
      selected,
      creating,
      detailVisible,
      headerStatus,
      detailTitle,
      batchStatus,
      parameterDefs,
      bindingRows,
      trialReady,
      trialJsonReady,
      backToCatalog,
      onSaved,
      onDiscarded,
      onRemoveDone,
      onBatchStatusDone,
      testOpen,
      testSource,
      testValues,
      testTab,
      markdownView,
      testMarkdown,
      testJson,
      truncation,
      testFailure,
      testingMarkdown,
      testingJson,
      parameterLabel,
      bindingLabel,
      openTest,
      runMarkdown,
      runJson,
      startCreate: () => instance.state.setState({ selected: null, creating: true }),
      refresh: () => instance.refreshObjects(),
    };
  },
});
