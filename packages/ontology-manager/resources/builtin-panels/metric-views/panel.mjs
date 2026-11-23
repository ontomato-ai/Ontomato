import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelOperation,
} from "@ontomato/sdk/panel";

/*
 * Metric views panel: full-width catalog switching to a full-width detail view.
 *
 * Reads, form validation, read-only rules, deletion availability/impact, batch publication status and both unsaved-draft
 * trials live with the MetricView owner behind the declared official projections (no raw persisted record reads). This
 * script coordinates only view visibility, guarded back navigation, and the test dialog that reads unsaved form draft
 * values for live trial execution without saving.
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

    watch(selected, (next) => {
      if (next) setCreating(false);
    });

    // Unsaved form input is explicitly permitted for live draft preview and trial execution.
    const form = computed(() => instance.forms.handle("definition") ?? null);
    const formValues = computed(() => form.value?.values.value ?? {});
    const detailTitle = computed(() => {
      const draftName = typeof formValues.value.name === "string" ? formValues.value.name.trim() : "";
      return draftName || t("metricViews.new");
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
