import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData, usePanelOperation } from "@ontomato/sdk/panel";

/*
 * Metric views panel: full-width catalog switching to a full-width detail view.
 *
 * Reads, form validation, read-only rules, deletion availability/impact, batch publication status and both unsaved-draft
 * trials live with the MetricView owner behind the declared projections. This script manages only page-local state:
 * catalog/detail visibility, batch status report display, and the test dialog that feeds the form's current draft and
 * parameter values to the two trial operations without saving.
 */
await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance, t } = panel;
    const state = instance.state.values;

    const selected = computed(() => state.value.selected ?? null);
    const checked = computed(() => (Array.isArray(state.value.checked) ? state.value.checked : []));
    const creating = computed(() => state.value.creating === true);
    const detailVisible = computed(() => selected.value !== null || creating.value);
    const setCreating = (value) => instance.state.set("creating", value);

    // Keep the detail view open when an agent draft arrives (including create drafts when nothing is selected).
    watch(instance.draft, (draft) => {
      if (draft && !selected.value) setCreating(true);
    }, { immediate: true });

    watch(selected, (next) => {
      if (next) {
        setCreating(false);
        batchReport.value = null;
      }
    });

    // Track whether the currently selected metric loaded once; if it later disappears (deleted), return to the catalog.
    const recordRead = usePanelData("record", "record");
    let loadedPrimaryKey = null;
    watch([selected, recordRead], ([current, read]) => {
      if (!current) {
        loadedPrimaryKey = null;
        return;
      }
      if (read.status === "ready") {
        loadedPrimaryKey = current.primaryKey;
      } else if (read.status === "error" && loadedPrimaryKey === current.primaryKey) {
        loadedPrimaryKey = null;
        instance.state.setState({ selected: null, creating: false });
      }
    }, { immediate: true });

    const form = computed(() => instance.forms.handle("definition") ?? null);
    const formValues = computed(() => form.value?.values.value ?? {});
    const detailTitle = computed(() => {
      if (formValues.value.name) return String(formValues.value.name);
      if (recordRead.value.status === "ready" && recordRead.value.value?.label) return recordRead.value.value.label;
      if (selected.value) return selected.value.primaryKey;
      return t("metricViews.new");
    });

    const functionRecord = computed(() => formValues.value.function ?? {});
    const parameterDefs = computed(() => {
      const declared = functionRecord.value.queryPackage?.manifest?.parameterDefs ?? functionRecord.value.parameters ?? [];
      return Array.isArray(declared) ? declared.filter((def) => def && def.name && String(def.name).trim() !== "") : [];
    });
    const bindingRows = computed(() => (Array.isArray(formValues.value.bindings) ? formValues.value.bindings : []));

    function backToCatalog() {
      instance.state.setState({ selected: null, creating: false });
    }

    function onSaved() {
      setCreating(false);
      panel.notify({ kind: "success", text: t("metricViews.saved") });
    }

    function onDiscarded() {
      setCreating(false);
    }

    // ---- Batch publication status ----

    const publish = usePanelOperation("publishStatus", "setStatus");
    const publishOperation = computed(() => publish.operation.value);
    const batchStatus = ref("PUBLISHED");
    const batching = ref(false);
    const batchReport = ref(null);

    function errorText(reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }

    function outcomeText(outcome) {
      if (outcome.kind === "success") return outcome.message ?? t("metricViews.result");
      return outcome.message ?? outcome.code ?? outcome.kind;
    }

    async function applyStatus() {
      if (!checked.value.length) return;
      batching.value = true;
      batchReport.value = null;
      try {
        const answer = await publish.run({ status: batchStatus.value });
        if (!answer || answer.decision === "cancel") {
          batchReport.value = { summary: t("metricViews.batchCancelled"), items: [] };
          return;
        }
        const response = answer.response;
        if (response.kind === "not-dispatched") {
          const summary = t("metricViews.batchRefused", { message: response.message });
          batchReport.value = { summary, items: [] };
          panel.notify({ kind: "warning", text: summary });
          return;
        }
        const outcome = response.outcome;
        if (!outcome) {
          const summary = t("metricViews.batchUnknown", { message: "" });
          batchReport.value = { summary, items: [] };
          panel.notify({ kind: "warning", text: summary });
          return;
        }
        const namedLabels = new Map(
          (answer.named ?? []).map((entry) => [entry.target.primaryKey, entry.label]),
        );
        const entries = "items" in outcome ? outcome.items : [{ target: null, outcome }];
        const items = entries.map((item) => {
          const id = item.target ? item.target.primaryKey : "";
          return {
            id,
            label: namedLabels.get(id) ?? id,
            kind: item.outcome.kind,
            message: outcomeText(item.outcome),
          };
        });
        const done = items.filter((item) => item.kind === "success").length;
        const summary = t("metricViews.batchDone", { done, total: items.length });
        batchReport.value = { summary, items };
        panel.notify({ kind: done === items.length ? "success" : "warning", text: summary });
        const changed = new Set(items.filter((item) => item.kind === "success").map((item) => item.id));
        instance.state.set("checked", checked.value.filter((ref) => !changed.has(ref.primaryKey)));
      } catch (error) {
        const summary = t("metricViews.batchUnknown", { message: errorText(error) });
        batchReport.value = { summary, items: [] };
        panel.notify({ kind: "error", text: summary });
      } finally {
        batching.value = false;
      }
    }

    // ---- Test current unsaved draft ----

    const trial = usePanelOperation("trial", "test");
    const trialJson = usePanelOperation("trialJson", "testExecute");

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
      checked,
      creating,
      detailVisible,
      detailTitle,
      parameterDefs,
      bindingRows,
      publishOperation,
      batchStatus,
      batching,
      batchReport,
      backToCatalog,
      onSaved,
      onDiscarded,
      applyStatus,
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
    };
  },
});
