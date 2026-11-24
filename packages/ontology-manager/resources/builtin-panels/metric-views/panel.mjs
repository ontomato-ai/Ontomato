import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

/*
 * Metric views panel: full-width catalog switching to a full-width detail view.
 *
 * Reads, form validation, read-only rules, deletion availability/impact, batch publication status and both unsaved-draft
 * trials live with the MetricView owner behind the declared official projections (no raw persisted record reads). This
 * script coordinates only view visibility, guarded back navigation, and the test dialog's public state synchronization
 * with the form's published `draft` output.
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
      instance.state.setState({
        selected: null,
        creating: false,
        testOpen: false,
        testSource: "explicit",
        testTab: "markdown",
        testParameters: {},
      });
    }

    const detailBack = usePanelBack(() => detailVisible.value, closeDetail, { pushHistory: true });

    function backToCatalog() {
      void detailBack.back();
    }

    function cloneJson(value) {
      return value === undefined ? null : JSON.parse(JSON.stringify(value));
    }

    function normalizeParams(raw) {
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    }

    function bindingSourceValue(index) {
      return `binding:${index}`;
    }

    function parseBindingIndex(source) {
      if (typeof source !== "string" || !source.startsWith("binding:")) return null;
      const index = Number(source.slice("binding:".length));
      return Number.isInteger(index) && index >= 0 ? index : null;
    }

    // Read unsaved form values through the official ObjectForm `draft` output.
    const formDraft = usePanelOutput("definition", "draft");
    const formValues = computed(() => (
      formDraft.value && typeof formDraft.value === "object" && !Array.isArray(formDraft.value)
        ? formDraft.value
        : {}
    ));
    const detailTitle = computed(() => {
      const draftName = typeof formValues.value.name === "string" ? formValues.value.name.trim() : "";
      return draftName || t("metricViews.new");
    });

    const hasFunctionDraft = computed(() => Boolean(
      formValues.value.function
      && typeof formValues.value.function === "object"
      && !Array.isArray(formValues.value.function),
    ));
    const functionRecord = computed(() => (hasFunctionDraft.value ? formValues.value.function : {}));
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

    // ---- Test current unsaved draft via declared OperationButton projections ----

    const testValues = ref({});
    const testErrors = ref({});
    let pendingInputParamsJson = null;

    const testOpen = computed({
      get: () => state.value.testOpen === true,
      set: (next) => instance.state.set("testOpen", Boolean(next)),
    });
    const dialogOpen = computed({
      get: () => detailVisible.value && testOpen.value,
      set: (next) => {
        testOpen.value = Boolean(next);
      },
    });
    const testSource = computed({
      get: () => (typeof state.value.testSource === "string" && state.value.testSource ? state.value.testSource : "explicit"),
      set: (next) => instance.state.set("testSource", typeof next === "string" && next ? next : "explicit"),
    });
    const testTab = computed({
      get: () => (state.value.testTab === "json" ? "json" : "markdown"),
      set: (next) => instance.state.set("testTab", next === "json" ? "json" : "markdown"),
    });
    const testParameters = computed(() => normalizeParams(state.value.testParameters));

    const selectedKey = computed(() => selected.value?.primaryKey ?? null);
    watch(selectedKey, (next, prev) => {
      const patched = new Set(instance.state.lastPatchedKeys);
      const patch = {};
      if (next && creating.value) patch.creating = false;
      if (prev !== next) {
        if (!patched.has("testOpen")) patch.testOpen = false;
        if (!patched.has("testSource")) patch.testSource = "explicit";
        if (!patched.has("testTab")) patch.testTab = "markdown";
        if (!patched.has("testParameters")) patch.testParameters = {};
      }
      if (Object.keys(patch).length > 0) instance.state.setState(patch);
    });

    watch(detailVisible, (visible) => {
      if (visible) return;
      testValues.value = {};
      testErrors.value = {};
      if (
        state.value.testOpen !== false
        || state.value.testSource !== "explicit"
        || state.value.testTab !== "markdown"
        || Object.keys(normalizeParams(state.value.testParameters)).length > 0
      ) {
        instance.state.setState({
          testOpen: false,
          testSource: "explicit",
          testTab: "markdown",
          testParameters: {},
        });
      }
    });

    function syncTestState() {
      if (!detailVisible.value || !testOpen.value) {
        testErrors.value = {};
        return;
      }

      const bindingIndex = parseBindingIndex(testSource.value);
      if (bindingIndex !== null) {
        testErrors.value = {};
        if (!hasFunctionDraft.value) return;
        const row = bindingRows.value[bindingIndex];
        // Copy parameters from the current draft binding row (never bindingId) so unsaved edits are tested.
        const nextParams = cloneJson(normalizeParams(row?.parameters));
        if (JSON.stringify(nextParams) !== JSON.stringify(testParameters.value)) {
          instance.state.set("testParameters", nextParams);
        }
        return;
      }

      const current = testParameters.value;
      let merged = current;
      let changed = false;
      for (const def of parameterDefs.value) {
        if (!Object.hasOwn(current, def.name)) {
          if (!changed) merged = { ...current };
          merged[def.name] = def.value === undefined ? null : cloneJson(def.value);
          changed = true;
        }
      }
      if (changed) {
        instance.state.set("testParameters", merged);
      }

      const nextValues = {};
      for (const def of parameterDefs.value) {
        const value = Object.hasOwn(merged, def.name)
          ? merged[def.name]
          : (def.value === undefined ? null : def.value);
        nextValues[def.name] = JSON.stringify(value);
      }
      testValues.value = nextValues;
      testErrors.value = {};
    }

    watch(
      [detailVisible, testOpen, testSource, hasFunctionDraft, parameterDefs, bindingRows, testParameters],
      (next, prev) => {
        const onlyParamsChanged =
          prev !== undefined
          && next[0] === prev[0]
          && next[1] === prev[1]
          && next[2] === prev[2]
          && next[3] === prev[3]
          && next[4] === prev[4]
          && next[5] === prev[5];
        if (onlyParamsChanged && pendingInputParamsJson !== null && JSON.stringify(next[6]) === pendingInputParamsJson) {
          pendingInputParamsJson = null;
          return;
        }
        pendingInputParamsJson = null;
        syncTestState();
      },
      { immediate: true },
    );

    function onParamInput(name, rawText) {
      const text = typeof rawText === "string" ? rawText : "";
      testValues.value = { ...testValues.value, [name]: text };
      const nextErrors = { ...testErrors.value };
      let parsed;
      if (text.trim() === "") {
        parsed = null;
      } else {
        try {
          parsed = JSON.parse(text);
        } catch {
          nextErrors[name] = t("metricViews.testInvalidValue", { name });
          testErrors.value = nextErrors;
          return;
        }
      }
      delete nextErrors[name];
      testErrors.value = nextErrors;
      const nextParams = { ...testParameters.value, [name]: parsed };
      pendingInputParamsJson = JSON.stringify(nextParams);
      instance.state.set("testParameters", nextParams);
    }

    const hasInvalidTestParams = computed(() => (
      testSource.value === "explicit" && Object.keys(testErrors.value).length > 0
    ));
    const trialDisabled = computed(() => (
      !detailVisible.value || !hasFunctionDraft.value || hasInvalidTestParams.value
    ));

    function parameterLabel(parameter) {
      return parameter.type ? `${parameter.name} (${parameter.type})` : parameter.name;
    }

    function bindingLabel(row, index) {
      const name = row?.name ? String(row.name).trim() : "";
      return name ? t("metricViews.testBinding", { name }) : t("metricViews.testBindingUnnamed", { index: index + 1 });
    }

    function openTest() {
      testOpen.value = true;
    }

    function onMarkdownRead() {
      testTab.value = "markdown";
    }

    function onJsonRead() {
      testTab.value = "json";
    }

    return {
      selected,
      creating,
      detailVisible,
      detailTitle,
      hasFunctionDraft,
      batchStatus,
      parameterDefs,
      bindingRows,
      backToCatalog,
      onSaved,
      onDiscarded,
      onRemoveDone,
      testOpen,
      dialogOpen,
      testSource,
      testTab,
      testValues,
      testErrors,
      hasInvalidTestParams,
      trialDisabled,
      bindingSourceValue,
      parameterLabel,
      bindingLabel,
      openTest,
      onParamInput,
      onMarkdownRead,
      onJsonRead,
      startCreate: () => instance.state.setState({ selected: null, creating: true }),
      refresh: () => instance.refreshObjects(),
    };
  },
});
