import { computed, onBeforeUnmount, ref, watch } from "vue";
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
const RELATIONSHIP = "platform:Relationship";

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
    const { instance, t, navigate } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const drawerSize = computed(() => (narrow.value ? "100%" : "520px"));
    const dialogWidth = computed(() => (narrow.value ? "94%" : "520px"));

    const state = computed(() => instance.state.values.value);
    const selected = computed(() => state.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const selectedAttribute = computed(() => state.value.selectedAttribute ?? null);
    const creating = computed(() => state.value.creating === true);
    const creatingAttribute = ref(false);

    // Public deep-linked keyword forwarded to the catalog ObjectList.
    const search = computed({
      get: () => state.value.search ?? "",
      set: value => instance.state.set("search", value || null),
    });

    // Read-only outputs declared by projection members and owner reads.
    const catalogCount = usePanelOutput("catalog", "filteredCount");
    const detailHeaderStatus = usePanelOutput("detail", "status");
    const detailStatus = computed(() => (selectedKey.value ? (detailHeaderStatus.value ?? "loading") : "empty"));
    const primaryKeyStatus = usePanelOutput("detail", "primaryKeyStatus");
    const primaryKeyName = usePanelOutput("detail", "primaryKeyName");
    const attributeCount = usePanelOutput("attributes", "loadedCount");
    const relationCount = usePanelOutput("relations", "loadedCount");
    const attributeDetailHeaderStatus = usePanelOutput("attributeDetail", "status");
    const attributeDetailStatus = computed(() =>
      selectedAttribute.value ? (attributeDetailHeaderStatus.value ?? "loading") : "empty",
    );
    const isPrimaryKey = usePanelOutput("attributeDetail", "isPrimaryKey");

    const editAttributeDrawer = computed(() =>
      Boolean(selectedKey.value && selectedAttribute.value && !creatingAttribute.value),
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
      when: () => Boolean(selectedKey.value) && detailStatus.value === "ready",
    });
    const attributeDraft = usePanelFormDraft("attributeForm", {
      when: () => editAttributeDrawer.value && attributeDetailStatus.value === "ready",
    });

    function openClass(target) {
      const primaryKey = typeof target === "string" ? target : target?.primaryKey;
      if (!primaryKey) return;
      creatingAttribute.value = false;
      instance.state.setState({
        creating: false,
        selected: { className: OBJECT_TYPE, primaryKey },
        className: primaryKey,
        selectedAttribute: null,
      });
    }

    function backToCatalog() {
      creatingAttribute.value = false;
      instance.state.setState({
        selected: null,
        className: null,
        selectedAttribute: null,
        creating: false,
      });
    }

    function startCreate() {
      creatingAttribute.value = false;
      instance.state.setState({
        creating: true,
        selected: null,
        className: null,
        selectedAttribute: null,
      });
    }

    function cancelCreate() {
      instance.state.setState({
        creating: false,
        selected: null,
        className: null,
        selectedAttribute: null,
      });
    }

    function closeAttribute() {
      creatingAttribute.value = false;
      if (selectedAttribute.value) instance.state.set("selectedAttribute", null);
    }

    async function startCreateAttribute() {
      if (editAttributeDrawer.value && !(await attributeBack.back())) return;
      instance.state.set("selectedAttribute", null);
      creatingAttribute.value = true;
    }

    function cancelCreateAttribute() {
      creatingAttribute.value = false;
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

    // Keep `className` synchronized with `selected` for attribute and relationship list reads.
    watch(selected, value => {
      const className = value?.primaryKey ?? null;
      const patch = {};
      if ((state.value.className ?? null) !== className) patch.className = className;
      if (selectedAttribute.value && attributeClass(selectedAttribute.value) !== className) {
        patch.selectedAttribute = null;
      }
      if (value && creating.value) patch.creating = false;
      if (Object.keys(patch).length) instance.state.setState(patch);
      if (!value) creatingAttribute.value = false;
    }, { immediate: true });

    // Re-read the selected object type's summary metrics and primary-key status when child attributes or relationships change.
    onBeforeUnmount(instance.onObjectChanged(object => {
      if (object && (object.objectType === ATTRIBUTE || object.objectType === RELATIONSHIP) && selectedKey.value) {
        instance.refreshObjects();
      }
    }));

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
      const wasCreating = creatingAttribute.value;
      creatingAttribute.value = false;
      if (wasCreating && object?.primaryKey) {
        instance.state.set("selectedAttribute", { className: ATTRIBUTE, primaryKey: object.primaryKey });
      }
      instance.refreshObjects();
    }

    function onDeleteObjectDone(outcome) {
      if (outcome?.kind !== "success") return;
      backToCatalog();
    }

    function onSetPrimaryKeyDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
    }

    function onDeleteAttributeDone(outcome) {
      if (outcome?.kind !== "success") return;
      closeAttribute();
      instance.refreshObjects();
    }

    const configureView = () =>
      void navigate(`/ontology/objects/${encodeURIComponent(selectedKey.value)}/view`).catch(() => undefined);
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
      primaryKeyStatus,
      primaryKeyName,
      attributeCount,
      relationCount,
      attributeDetailStatus,
      isPrimaryKey,
      editAttributeDrawer,
      createObjectDialog,
      createAttributeDialog,
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
      attributeSaved,
      onDeleteObjectDone,
      onSetPrimaryKeyDone,
      onDeleteAttributeDone,
      configureView,
      browseData,
      openRelation,
    };
  },
});
