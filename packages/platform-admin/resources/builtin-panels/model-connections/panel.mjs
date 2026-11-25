import { computed, ref, shallowRef, watch } from "vue";
import {
  appIcon,
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const CONNECTION_TYPE = "platform:ModelConnection";
const MODEL_TYPE = "platform:ModelEntry";

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const createConnectionOpen = computed({
      get: () => values.value.creatingConnection === true,
      set: (open) => instance.state.set("creatingConnection", open ? true : null),
    });

    const modelDialogMode = computed(() => (values.value.modelDialog === "edit" || values.value.modelDialog === "create"
      ? values.value.modelDialog
      : ""));
    const modelDialogOpen = computed({
      get: () => Boolean(modelDialogMode.value),
      set: (open) => {
        if (!open) closeModelDialog();
      },
    });
    const editingModelKey = computed(() => values.value.editingModel?.primaryKey ?? "");

    const discoverOpen = computed({
      get: () => values.value.discoverDialog === true,
      set: (open) => instance.state.set("discoverDialog", open ? true : null),
    });

    const connectionDraft = usePanelFormDraft("connectionForm", {
      when: () => Boolean(selectedKey.value),
    });

    const headerModelCountOutput = usePanelOutput("connectionHeader", "modelCount");
    const existingModelIdsOutput = usePanelOutput("connectionHeader", "existingModelIds");
    const listTotalOutput = usePanelOutput("modelsList", "total");
    const listedModelsOutput = usePanelOutput("modelsList", "listed");

    const modelCount = computed(() => {
      if (typeof listTotalOutput.value === "number") return listTotalOutput.value;
      if (typeof headerModelCountOutput.value === "number") return headerModelCountOutput.value;
      return null;
    });

    const existingModelSet = computed(() => {
      const ids = new Set();
      const raw = existingModelIdsOutput.value;
      if (typeof raw === "string" && raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (typeof item === "string" && item) ids.add(item);
            }
          }
        } catch {
          // Ignore malformed output and fall back to listed row keys below.
        }
      }
      if (Array.isArray(listedModelsOutput.value)) {
        for (const item of listedModelsOutput.value) {
          if (item?.primaryKey) ids.add(item.primaryKey);
        }
      }
      return ids;
    });

    const discoverOp = usePanelOperation("discoverModels", "discover");

    function connectionDraftValues() {
      return instance.forms.handle("connectionForm")?.values.value ?? {};
    }

    function discoverPrecheckError() {
      const handle = instance.forms.handle("connectionForm");
      const draft = handle?.values.value ?? {};
      const fields = handle?.fields.value ?? [];
      const apiBaseField = fields.find((field) => field.path === "/apiBase");
      const apiBase = typeof draft.apiBase === "string" ? draft.apiBase.trim() : "";
      if (apiBaseField?.required && !apiBase) {
        return t("discover.apiBaseRequired");
      }
      const errors = handle?.errors.value ?? {};
      const firstError = Object.values(errors).find((msg) => typeof msg === "string" && msg.trim() !== "");
      if (firstError) return firstError;
      return "";
    }

    // ---- Discover models using the live unsaved connection form ----
    const discoverLoading = ref(false);
    const discoverError = ref("");
    const discoverCandidates = shallowRef([]);
    const discoverQuery = ref("");
    let discoverSeq = 0;

    async function runDiscover() {
      const precheck = discoverPrecheckError();
      if (precheck) {
        discoverLoading.value = false;
        discoverError.value = precheck;
        discoverCandidates.value = [];
        return;
      }
      const seq = ++discoverSeq;
      discoverLoading.value = true;
      discoverError.value = "";
      discoverCandidates.value = [];
      try {
        const result = await discoverOp.run({
          draft: connectionDraftValues(),
          parameters: {},
        });
        if (seq !== discoverSeq) return;
        const value = result?.kind === "json" ? result.value : result;
        discoverCandidates.value = Array.isArray(value?.models) ? value.models : [];
      } catch (error) {
        if (seq !== discoverSeq) return;
        const message = error instanceof Error ? error.message : String(error);
        discoverError.value = t("discover.failed", { message });
      } finally {
        if (seq === discoverSeq) discoverLoading.value = false;
      }
    }

    watch(discoverOpen, (open) => {
      if (!open) return;
      discoverQuery.value = "";
      void runDiscover();
    });

    const filteredCandidates = computed(() => {
      const q = discoverQuery.value.trim().toLowerCase();
      if (!q) return discoverCandidates.value;
      return discoverCandidates.value.filter(
        (item) => item.id.toLowerCase().includes(q) || (typeof item.name === "string" && item.name.toLowerCase().includes(q)),
      );
    });

    // ---- Prefill discovered candidate into the createModelForm once mounted ----
    const pendingCandidateId = ref("");
    watch(
      () => ({
        open: modelDialogOpen.value,
        mode: modelDialogMode.value,
        candidate: pendingCandidateId.value,
        fields: instance.forms.handle("createModelForm")?.fields.value.length ?? 0,
      }),
      ({ open, mode, candidate, fields }) => {
        if (!open || mode !== "create" || !candidate || fields === 0) return;
        const handle = instance.forms.handle("createModelForm");
        if (!handle) return;
        handle.set("/model", candidate);
        handle.set("/name", candidate);
        pendingCandidateId.value = "";
      },
    );

    function openCreateConnection() {
      createConnectionOpen.value = true;
    }

    function openAddModel(candidateId = "") {
      pendingCandidateId.value = candidateId;
      instance.state.setState({
        editingModel: null,
        modelDialog: "create",
      });
    }

    function openDiscover() {
      const problem = discoverPrecheckError();
      if (problem) {
        notify({ kind: "warning", text: problem });
        return;
      }
      discoverOpen.value = true;
    }

    function pickDiscoveredModel(id) {
      // Keep the discovery dialog open so multiple discovered models can be added in sequence.
      openAddModel(id);
    }

    function addManuallyFromDiscover() {
      discoverOpen.value = false;
      openAddModel("");
    }

    function closeModelDialog() {
      pendingCandidateId.value = "";
      instance.state.setState({
        modelDialog: null,
        editingModel: null,
      });
    }

    function onConnectionCreated(saved) {
      createConnectionOpen.value = false;
      if (saved?.primaryKey) {
        instance.state.set("selected", { className: CONNECTION_TYPE, primaryKey: saved.primaryKey });
      }
      instance.refreshObjects();
      notify({ kind: "success", text: t("connections.created") });
    }

    function onConnectionSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("connections.saved") });
    }

    function onConnectionDeleted(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("connections.deleted") });
    }

    function onModelSaved() {
      closeModelDialog();
      instance.refreshObjects();
      notify({ kind: "success", text: t("models.saved") });
    }

    function onModelRowAction({ id, ref: rowRef }) {
      const modelName = rowRef?.primaryKey;
      if (!modelName) return;
      if (id === "edit") {
        instance.state.setState({
          editingModel: { className: MODEL_TYPE, primaryKey: modelName },
          modelDialog: "edit",
        });
      }
    }

    function formatModelTestResult(rowRef, state) {
      if (!state || state.running) return null;
      const modelName = rowRef?.primaryKey || "";
      if (state.result && state.result.kind === "json") {
        const value = state.result.value;
        const text = value?.type === "embedding"
          ? t("models.testEmbeddingOk", { name: modelName, dimensions: value.dimensions })
          : t("models.testChatOk", { name: modelName, reply: String(value?.content ?? "").slice(0, 80) || "OK" });
        return { ok: true, text };
      }
      if (state.error) {
        return { ok: false, text: t("models.testFailed", { name: modelName, message: state.error }) };
      }
      return null;
    }

    return {
      t,
      searchIcon: appIcon("search"),
      selectedKey,
      modelCount,
      existingModelSet,
      connectionDraft,
      createConnectionOpen,
      modelDialogOpen,
      modelDialogMode,
      editingModelKey,
      discoverOpen,
      discoverLoading,
      discoverError,
      discoverCandidates,
      discoverQuery,
      filteredCandidates,
      openCreateConnection,
      openAddModel,
      openDiscover,
      runDiscover,
      pickDiscoveredModel,
      addManuallyFromDiscover,
      closeModelDialog,
      onConnectionCreated,
      onConnectionSaved,
      onConnectionDeleted,
      onModelSaved,
      onModelRowAction,
      formatModelTestResult,
    };
  },
});
