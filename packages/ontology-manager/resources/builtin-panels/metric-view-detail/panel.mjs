import { computed, nextTick, ref, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const CATALOG_PATH = "/ontology/assets/metrics";

/*
 * Metric view detail panel: full-width edit and create entry with a single-row <page-header>, header Save/Discard draft
 * controls, in-place status handling, owner delete OperationButton, and unsaved-draft test dialog.
 *
 * Reads, form validation, read-only rules, deletion availability/impact, and both unsaved-draft trials stay with the
 * MetricView owner behind the declared official projections.
 */
await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance, navigate, t } = panel;
    const state = instance.state.values;

    const selected = computed(() => state.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const isCreateMode = computed(() => !selectedKey.value && state.value.mode === "create");

    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");

    const recordStatus = computed(() => {
      if (!selectedKey.value) return isCreateMode.value ? "create" : "missing";
      return headerStatus.value ?? "loading";
    });

    const detailReady = computed(() => Boolean(selectedKey.value) && recordStatus.value === "ready");
    const formMounted = computed(() => isCreateMode.value || detailReady.value);

    const detailDraft = usePanelFormDraft("definition", { when: formMounted });

    // Route back to the catalog entry so the platform's unified unsaved-changes leave guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
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
    const createTitle = computed(() => {
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

    function onSaved(saved) {
      const patch = {};
      if (state.value.mode) patch.mode = null;
      if (saved?.primaryKey && selectedKey.value !== saved.primaryKey) {
        patch.selected = { className: "platform:MetricView", primaryKey: saved.primaryKey };
      }
      if (Object.keys(patch).length > 0) instance.state.setState(patch);
      panel.notify({ kind: "success", text: t("metricViews.saved") });
    }

    async function onDiscarded() {
      if (!isCreateMode.value) return;
      instance.state.set("mode", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      // Clear selection and wait a tick so any dirty form unmounts before navigating back to the catalog.
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    // ---- Test current unsaved draft via declared OperationButton projections ----

    const testValues = ref({});
    const testErrors = ref({});
    let explicitParams = null;
    let pendingInputParamsJson = null;

    function clearExplicitTestDraft() {
      explicitParams = null;
      testValues.value = {};
      testErrors.value = {};
      pendingInputParamsJson = null;
    }

    function defaultExplicitParams() {
      const defaults = {};
      for (const def of parameterDefs.value) {
        defaults[def.name] = def.value === undefined ? null : cloneJson(def.value);
      }
      return defaults;
    }

    function mergeExplicitDefaults(source) {
      const merged = { ...normalizeParams(source) };
      for (const def of parameterDefs.value) {
        if (!Object.hasOwn(merged, def.name)) {
          merged[def.name] = def.value === undefined ? null : cloneJson(def.value);
        }
      }
      return merged;
    }

    function buildExplicitValues(params, preserveErrors) {
      const nextValues = {};
      for (const def of parameterDefs.value) {
        if (preserveErrors && Object.hasOwn(testErrors.value, def.name) && Object.hasOwn(testValues.value, def.name)) {
          nextValues[def.name] = testValues.value[def.name];
          continue;
        }
        const value = Object.hasOwn(params, def.name)
          ? params[def.name]
          : (def.value === undefined ? null : def.value);
        nextValues[def.name] = JSON.stringify(value);
      }
      return nextValues;
    }

    const testOpen = computed({
      get: () => state.value.testOpen === true,
      set: (next) => instance.state.set("testOpen", Boolean(next)),
    });
    const dialogOpen = computed({
      get: () => formMounted.value && testOpen.value,
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

    watch(
      selectedKey,
      (next, prev) => {
        const patched = new Set(instance.state.lastPatchedKeys);
        const patch = {};
        if (next && state.value.mode) patch.mode = null;
        if (prev !== undefined && prev !== next) {
          clearExplicitTestDraft();
          if (!patched.has("testOpen")) patch.testOpen = false;
          if (!patched.has("testSource")) patch.testSource = "explicit";
          if (!patched.has("testTab")) patch.testTab = "markdown";
          if (!patched.has("testParameters")) patch.testParameters = {};
        }
        if (Object.keys(patch).length > 0) instance.state.setState(patch);
      },
      { immediate: true },
    );

    watch(testOpen, (open, prevOpen) => {
      if (open || prevOpen !== true) return;
      clearExplicitTestDraft();
      const patched = new Set(instance.state.lastPatchedKeys);
      const patch = {};
      if (!patched.has("testSource") && state.value.testSource !== "explicit") patch.testSource = "explicit";
      if (!patched.has("testTab") && state.value.testTab !== "markdown") patch.testTab = "markdown";
      if (!patched.has("testParameters") && Object.keys(normalizeParams(state.value.testParameters)).length > 0) {
        patch.testParameters = {};
      }
      if (Object.keys(patch).length > 0) instance.state.setState(patch);
    });

    watch(formMounted, (mounted, prevMounted) => {
      if (mounted || prevMounted !== true) return;
      clearExplicitTestDraft();
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

    function syncTestState(next, prev) {
      if (!formMounted.value || !testOpen.value) {
        testErrors.value = {};
        return;
      }

      const bindingIndex = parseBindingIndex(testSource.value);
      if (bindingIndex !== null) {
        if (!hasFunctionDraft.value) return;
        const row = bindingRows.value[bindingIndex];
        // Copy parameters from the current draft binding row (never bindingId) so unsaved edits are tested.
        const nextParams = cloneJson(normalizeParams(row?.parameters));
        const nextJson = JSON.stringify(nextParams);
        if (nextJson !== JSON.stringify(testParameters.value)) {
          pendingInputParamsJson = nextJson;
          instance.state.set("testParameters", nextParams);
        }
        return;
      }

      const prevDialogOpen = prev ? (prev[0] && prev[1]) : false;
      const prevSource = prev ? prev[2] : null;
      const sameMetric = prev !== undefined && next[7] === prev[7];
      const paramsChanged = prev !== undefined && next[6] !== prev[6];
      const switchedFromBinding = sameMetric && prevSource !== null && parseBindingIndex(prevSource) !== null;
      const patchedParams = instance.state.lastPatchedKeys.has("testParameters");
      const takeExternalParams =
        (!prevDialogOpen && explicitParams === null)
        || (switchedFromBinding && patchedParams)
        || (!switchedFromBinding && paramsChanged);

      // Keep explicit edits isolated from binding values when toggling back from a binding source.
      const base = takeExternalParams
        ? testParameters.value
        : (switchedFromBinding ? (explicitParams ?? {}) : (explicitParams ?? testParameters.value));
      const merged = mergeExplicitDefaults(base);
      explicitParams = cloneJson(merged);

      const preserveErrors = !takeExternalParams;
      if (!preserveErrors) {
        testErrors.value = {};
      } else {
        const validNames = new Set(parameterDefs.value.map((def) => def.name));
        const keptErrors = {};
        for (const [key, msg] of Object.entries(testErrors.value)) {
          if (validNames.has(key)) keptErrors[key] = msg;
        }
        testErrors.value = keptErrors;
      }
      testValues.value = buildExplicitValues(merged, preserveErrors);

      const mergedJson = JSON.stringify(merged);
      if (mergedJson !== JSON.stringify(testParameters.value)) {
        pendingInputParamsJson = mergedJson;
        instance.state.set("testParameters", merged);
      }
    }

    watch(
      [formMounted, testOpen, testSource, hasFunctionDraft, parameterDefs, bindingRows, testParameters, selectedKey],
      (next, prev) => {
        const onlyParamsChanged =
          prev !== undefined
          && next[0] === prev[0]
          && next[1] === prev[1]
          && next[2] === prev[2]
          && next[3] === prev[3]
          && next[4] === prev[4]
          && next[5] === prev[5]
          && next[7] === prev[7];
        if (onlyParamsChanged && pendingInputParamsJson !== null && JSON.stringify(next[6]) === pendingInputParamsJson) {
          pendingInputParamsJson = null;
          return;
        }
        pendingInputParamsJson = null;
        syncTestState(next, prev);
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
      const nextParams = { ...(explicitParams ?? testParameters.value), [name]: parsed };
      explicitParams = cloneJson(nextParams);
      pendingInputParamsJson = JSON.stringify(nextParams);
      instance.state.set("testParameters", nextParams);
    }

    const hasInvalidTestParams = computed(() => (
      testSource.value === "explicit" && Object.keys(testErrors.value).length > 0
    ));
    const trialDisabled = computed(() => (
      !formMounted.value || !hasFunctionDraft.value || hasInvalidTestParams.value
    ));

    function parameterLabel(parameter) {
      return parameter.type ? `${parameter.name} (${parameter.type})` : parameter.name;
    }

    function bindingLabel(row, index) {
      const name = row?.name ? String(row.name).trim() : "";
      return name ? t("metricViews.testBinding", { name }) : t("metricViews.testBindingUnnamed", { index: index + 1 });
    }

    function openTest() {
      clearExplicitTestDraft();
      instance.state.setState({
        testOpen: true,
        testSource: "explicit",
        testTab: "markdown",
        testParameters: defaultExplicitParams(),
      });
    }

    function onMarkdownRead() {
      testTab.value = "markdown";
    }

    function onJsonRead() {
      testTab.value = "json";
    }

    return {
      selectedKey,
      isCreateMode,
      recordStatus,
      headerError,
      detailReady,
      formMounted,
      detailDraft,
      createTitle,
      hasFunctionDraft,
      parameterDefs,
      bindingRows,
      goBack,
      onSaved,
      onDiscarded,
      onRemoveDone,
      testOpen,
      dialogOpen,
      testSource,
      testTab,
      testValues,
      testErrors,
      trialDisabled,
      bindingSourceValue,
      parameterLabel,
      bindingLabel,
      openTest,
      onParamInput,
      onMarkdownRead,
      onJsonRead,
      refresh: () => instance.refreshObjects(),
    };
  },
});
