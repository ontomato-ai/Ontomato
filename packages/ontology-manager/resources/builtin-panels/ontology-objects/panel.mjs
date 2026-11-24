import { computed, ref, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";
const ATTRIBUTE = "platform:Attribute";

/** Extract the owning class API name from an attribute primary key (`["<className>","<name>"]`). */
function attributeClass(reference) {
  try {
    const key = JSON.parse(reference?.primaryKey ?? "");
    return Array.isArray(key) && typeof key[0] === "string" ? key[0] : null;
  } catch {
    return null;
  }
}

await mountPanel({
  setup() {
    const { instance, t, navigate, notify } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const drawerSize = computed(() => (narrow.value ? "100%" : "520px"));
    const dialogWidth = computed(() => (narrow.value ? "94%" : "520px"));

    const state = computed(() => instance.state.values.value);
    const selected = computed(() => state.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const selectedAttribute = computed(() => state.value.selectedAttribute ?? null);
    const selectedAttributeKey = computed(() => selectedAttribute.value?.primaryKey ?? "");
    const creating = computed(() => state.value.creating === true);
    const creatingAttribute = computed(() => state.value.creatingAttribute === true);

    // Public deep-linked keyword forwarded to the catalog ObjectList.
    const search = computed({
      get: () => state.value.search ?? "",
      set: value => instance.state.set("search", value || null),
    });

    // Read-only outputs declared by projection members and owner reads.
    const catalogCount = usePanelOutput("catalog", "filteredCount");
    const detailHeaderStatus = usePanelOutput("detail", "status");
    const detailError = usePanelOutput("detail", "errorMessage");
    const detailStatus = computed(() => (selectedKey.value ? (detailHeaderStatus.value ?? "loading") : "empty"));
    const detailClassName = usePanelOutput("detail", "className");
    const primaryKeyStatus = usePanelOutput("detail", "primaryKeyStatus");
    const primaryKeyName = usePanelOutput("detail", "primaryKeyName");
    const primaryKeyShowName = usePanelOutput("detail", "primaryKeyShowName");
    const primaryKeyCount = usePanelOutput("detail", "primaryKeyCount");
    const attributeCount = usePanelOutput("attributes", "loadedCount");
    const relationCount = usePanelOutput("relations", "loadedCount");
    const attributeDetailHeaderStatus = usePanelOutput("attributeDetail", "status");
    const attributeDetailError = usePanelOutput("attributeDetail", "errorMessage");
    const attributeDetailStatus = computed(() =>
      selectedAttribute.value ? (attributeDetailHeaderStatus.value ?? "loading") : "empty",
    );

    // Keep mounted edit forms alive across background re-read loading or error states once the target has loaded.
    const detailEverReady = ref(false);
    watch(selectedKey, () => {
      detailEverReady.value = false;
    });
    watch([detailStatus, detailClassName], ([status, className]) => {
      if (selectedKey.value && status === "ready" && (!className || className === selectedKey.value)) {
        detailEverReady.value = true;
      }
    }, { immediate: true });

    const attributeDetailEverReady = ref(false);
    watch(selectedAttributeKey, () => {
      attributeDetailEverReady.value = false;
    });
    watch(attributeDetailStatus, status => {
      if (selectedAttributeKey.value && status === "ready") {
        attributeDetailEverReady.value = true;
      }
    }, { immediate: true });

    const editAttributeDrawer = computed(() =>
      Boolean(selectedKey.value && selectedAttribute.value && !creatingAttribute.value),
    );
    const showDetailBody = computed(() =>
      Boolean(selectedKey.value)
      && detailEverReady.value
      && detailStatus.value !== "forbidden"
      && detailStatus.value !== "empty"
      && detailStatus.value !== "missing",
    );
    const showAttributeBody = computed(() =>
      editAttributeDrawer.value
      && attributeDetailEverReady.value
      && attributeDetailStatus.value !== "forbidden"
      && attributeDetailStatus.value !== "empty"
      && attributeDetailStatus.value !== "missing",
    );
    const createObjectDialog = computed({
      get: () => creating.value && !selectedKey.value,
      set: value => {
        if (!value && creating.value) cancelCreate();
      },
    });
    const createAttributeDialog = computed({
      get: () => Boolean(selectedKey.value && creatingAttribute.value),
      set: value => {
        if (!value && creatingAttribute.value) cancelCreateAttribute();
      },
    });

    const objectDraft = usePanelFormDraft("objectForm", {
      when: () => showDetailBody.value,
    });
    const attributeDraft = usePanelFormDraft("attributeForm", {
      when: () => showAttributeBody.value,
    });

    function openClass(target) {
      const primaryKey = typeof target === "string" ? target : target?.primaryKey;
      if (!primaryKey) return;
      instance.state.setState({
        creating: false,
        creatingAttribute: false,
        selected: { className: OBJECT_TYPE, primaryKey },
        selectedAttribute: null,
      });
    }

    function backToCatalog() {
      instance.state.setState({
        selected: null,
        selectedAttribute: null,
        creating: false,
        creatingAttribute: false,
      });
    }

    function startCreate() {
      instance.state.setState({
        creating: true,
        creatingAttribute: false,
        selected: null,
        selectedAttribute: null,
      });
    }

    function cancelCreate() {
      instance.state.setState({
        creating: false,
        creatingAttribute: false,
        selected: null,
        selectedAttribute: null,
      });
    }

    function closeAttribute() {
      if (creatingAttribute.value || selectedAttribute.value) {
        instance.state.setState({ creatingAttribute: false, selectedAttribute: null });
      }
    }

    async function startCreateAttribute() {
      if (editAttributeDrawer.value && !(await attributeBack.back())) return;
      instance.state.setState({ selectedAttribute: null, creatingAttribute: true });
    }

    function cancelCreateAttribute() {
      instance.state.set("creatingAttribute", false);
    }

    // Inner back layer: closing the attribute drawer guards only `attributeForm` and leaves `objectForm` untouched.
    const attributeBack = usePanelBack(
      () => editAttributeDrawer.value,
      closeAttribute,
      { pushHistory: false, forms: "attributeForm" },
    );
    // Outer back layer: returning to the catalog guards all dirty forms on this panel.
    const detailBack = usePanelBack(
      () => Boolean(selectedKey.value),
      backToCatalog,
      { pushHistory: true },
    );

    async function handleAttributeDrawerClose(done) {
      if (await attributeBack.back()) done();
    }

    // Leaving detail clears `creatingAttribute`; entering detail keeps it so atomic present({ selected, creatingAttribute: true }) works.
    watch(selected, value => {
      const className = value?.primaryKey ?? null;
      const patch = {};
      if (selectedAttribute.value && attributeClass(selectedAttribute.value) !== className) {
        patch.selectedAttribute = null;
      }
      if (value && creating.value) patch.creating = false;
      if (!value && creatingAttribute.value) patch.creatingAttribute = false;
      if (Object.keys(patch).length) instance.state.setState(patch);
    }, { immediate: true });

    // Setting `creating: true` while viewing a class clears selection so the create dialog opens
    // instead of keeping `objectForm` bound to the previously selected object type.
    watch(creating, value => {
      if (!value || !creating.value) return;
      if (selected.value || selectedAttribute.value || creatingAttribute.value) {
        instance.state.setState({
          selected: null,
          selectedAttribute: null,
          creatingAttribute: false,
        });
      }
    }, { immediate: true });

    // Keep create-attribute mode mutually exclusive with edit-attribute mode and valid only inside a class detail.
    watch(creatingAttribute, value => {
      if (!value || !creatingAttribute.value) return;
      if (!selected.value) {
        instance.state.set("creatingAttribute", false);
        return;
      }
      if (selectedAttribute.value) {
        instance.state.set("selectedAttribute", null);
      }
    }, { immediate: true });

    watch(selectedAttribute, value => {
      if (value && selectedAttribute.value && creatingAttribute.value) {
        instance.state.set("creatingAttribute", false);
      }
    });

    function objectSaved(object) {
      if (!creating.value) return;
      if (object?.primaryKey) {
        openClass(object.primaryKey);
      } else {
        instance.state.set("creating", false);
      }
    }

    function formDiscarded() {
      if (creating.value) cancelCreate();
    }

    function attributeSaved(object) {
      if (creatingAttribute.value) {
        instance.state.setState({
          creatingAttribute: false,
          selectedAttribute: object?.primaryKey ? { className: ATTRIBUTE, primaryKey: object.primaryKey } : null,
        });
      }
    }

    function onDeleteObjectDone(outcome) {
      if (outcome?.kind !== "success") return;
      backToCatalog();
    }

    function onDeleteAttributeDone(outcome) {
      if (outcome?.kind !== "success") return;
      closeAttribute();
    }

    // Local UI toggle for the in-page presentation configuration dialog (never enters URL).
    const configureViewDialog = ref(false);
    watch(selectedKey, () => {
      configureViewDialog.value = false;
    });

    const configureViewBack = usePanelBack(
      () => configureViewDialog.value,
      () => {
        configureViewDialog.value = false;
      },
      { pushHistory: false, forms: "detailPanelForm" },
    );

    async function handleConfigureViewClose(done) {
      if (await configureViewBack.back()) done();
    }

    const configureView = () => {
      if (!selectedKey.value) return;
      configureViewDialog.value = true;
    };

    function onDetailPanelSaved() {
      configureViewDialog.value = false;
      notify({ kind: "success", text: t("ot.detailPanelSaved") });
      instance.refreshObjects();
    }

    function onDetailPanelCleared(outcome) {
      if (outcome?.kind !== "success") return;
      configureViewDialog.value = false;
      notify({ kind: "success", text: t("ot.detailPanelCleared") });
      instance.refreshObjects();
    }

    const openPanelsDirectory = () => {
      configureViewDialog.value = false;
      void navigate("/ontology/panels").catch(() => undefined);
    };
    const browseData = () =>
      void navigate(`/browser/data/${encodeURIComponent(selectedKey.value)}`).catch(() => undefined);
    const openRelation = reference => {
      if (!reference?.primaryKey) return;
      void navigate(panelAddress("/ontology/relations/detail", { selected: reference.primaryKey })).catch(() => undefined);
    };

    return {
      rootRef,
      drawerSize,
      dialogWidth,
      t,
      search,
      creating,
      selectedKey,
      catalogCount,
      detailStatus,
      detailError,
      detailEverReady,
      detailClassName,
      showDetailBody,
      primaryKeyStatus,
      primaryKeyName,
      primaryKeyShowName,
      primaryKeyCount,
      attributeCount,
      relationCount,
      attributeDetailStatus,
      attributeDetailError,
      attributeDetailEverReady,
      showAttributeBody,
      editAttributeDrawer,
      createObjectDialog,
      createAttributeDialog,
      configureViewDialog,
      objectDraft,
      attributeDraft,
      refresh: () => instance.refreshObjects(),
      startCreate,
      cancelCreate,
      openClass,
      goBack: () => void detailBack.back(),
      objectSaved,
      formDiscarded,
      startCreateAttribute,
      cancelCreateAttribute,
      closeAttribute,
      handleAttributeDrawerClose,
      handleConfigureViewClose,
      attributeSaved,
      onDeleteObjectDone,
      onDeleteAttributeDone,
      onDetailPanelSaved,
      onDetailPanelCleared,
      configureView,
      openPanelsDirectory,
      browseData,
      openRelation,
    };
  },
});
