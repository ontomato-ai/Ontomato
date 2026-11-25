import { computed, ref, shallowRef, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOperation,
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

    const discoverOp = usePanelOperation("discoverModels", "discover");
    const testOp = usePanelOperation("testModel", "test");

    // ---- Test one model row against the live unsaved connection form ----
    const testingModel = ref("");
    const testStatus = shallowRef(null);
    watch(selectedKey, () => {
      testingModel.value = "";
      testStatus.value = null;
    });

    function connectionDraftValues() {
      return instance.forms.handle("connectionForm")?.values.value ?? {};
    }

    async function runTestModel(modelName) {
      if (!modelName || testingModel.value) return;
      testingModel.value = modelName;
      testStatus.value = null;
      try {
        const result = await testOp.run({
          draft: connectionDraftValues(),
          parameters: { modelName },
        });
        const value = result?.kind === "json" ? result.value : result;
        const text = value?.type === "embedding"
          ? t("models.testEmbeddingOk", { name: modelName, dimensions: value.dimensions })
          : t("models.testChatOk", { name: modelName, reply: String(value?.content ?? "").slice(0, 80) || "OK" });
        testStatus.value = { ok: true, text };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        testStatus.value = { ok: false, text: t("models.testFailed", { name: modelName, message }) };
      } finally {
        testingModel.value = "";
      }
    }

    // ---- Discover models using the live unsaved connection form ----
    const discoverLoading = ref(false);
    const discoverError = ref("");
    const discoverCandidates = shallowRef([]);
    const discoverQuery = ref("");
    let discoverSeq = 0;

    async function runDiscover() {
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
      return discoverCandidates.value.filter((item) => item.id.toLowerCase().includes(q));
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
      discoverOpen.value = true;
    }

    function pickDiscoveredModel(id) {
      discoverOpen.value = false;
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
      if (id === "test") {
        void runTestModel(modelName);
      } else if (id === "edit") {
        instance.state.setState({
          editingModel: { className: MODEL_TYPE, primaryKey: modelName },
          modelDialog: "edit",
        });
      }
    }

    return {
      t,
      selectedKey,
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
      testingModel,
      testStatus,
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
    };
  },
});
