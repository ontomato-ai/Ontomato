import { computed, defineComponent, h, onBeforeUnmount, ref, resolveComponent, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  useListRowSlot,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";

/** Row-scoped Delete button rendered inside ObjectList #row-detail using the row's owner operation availability. */
const RowDeleteButton = defineComponent({
  name: "RowDeleteButton",
  props: {
    disabled: { type: Boolean, default: false },
    label: { type: String, required: true },
  },
  setup(props) {
    const rowSlot = useListRowSlot();
    return () => {
      const op = rowSlot?.operations.value?.delete;
      if (!rowSlot || !op) return null;
      const SdkButton = resolveComponent("sdk-button");
      const icon = h(
        "svg",
        {
          class: "ot-btn-icon",
          viewBox: "0 0 24 24",
          width: "14",
          height: "14",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": "true",
        },
        [
          h("path", { d: "M3 6h18" }),
          h("path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }),
          h("path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }),
          h("line", { x1: "10", x2: "10", y1: "11", y2: "17" }),
          h("line", { x1: "14", x2: "14", y1: "11", y2: "17" }),
        ],
      );
      const children = [
        h(
          SdkButton,
          {
            type: "danger",
            plain: true,
            loading: Boolean(op.running),
            disabled: props.disabled || !op.available || Boolean(op.running),
            title: op.unavailable?.reason || undefined,
            onClick: () => void rowSlot.runOperation("delete"),
          },
          { default: () => [op.running ? null : icon, h("span", props.label)] },
        ),
      ];
      if (op.unavailable?.reason) {
        children.push(h("span", { class: "ot-attr-delete-reason" }, op.unavailable.reason));
      }
      return h("div", { class: "ot-attr-row-delete" }, children);
    };
  },
});

/** Syncs the currently expanded attribute row ref into non-URL `editingAttribute` panel state. */
const RowTargetSync = defineComponent({
  name: "RowTargetSync",
  props: {
    target: { type: Object, required: true },
  },
  setup(props, { slots }) {
    const { instance } = usePanelContext();
    const sync = (refValue) => {
      if (!refValue?.primaryKey) return;
      const current = instance.state.values.value.editingAttribute;
      if (current?.primaryKey === refValue.primaryKey) return;
      instance.state.set("editingAttribute", refValue);
    };
    sync(props.target);
    watch(() => props.target, sync);
    onBeforeUnmount(() => {
      const current = instance.state.values.value.editingAttribute;
      if (current?.primaryKey === props.target?.primaryKey) {
        instance.state.set("editingAttribute", null);
      }
    });
    return () => h("div", slots.default?.());
  },
});

await mountPanel({
  components: { RowDeleteButton, RowTargetSync },
  setup() {
    const { instance, t, navigate, notify } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const dialogWidth = computed(() => (narrow.value ? "94%" : "520px"));

    const state = computed(() => instance.state.values.value);
    const selected = computed(() => state.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
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

    const showDetailBody = computed(() =>
      Boolean(selectedKey.value)
      && detailEverReady.value
      && detailStatus.value !== "forbidden"
      && detailStatus.value !== "empty"
      && detailStatus.value !== "missing",
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
      when: () => showDetailBody.value && !creating.value,
    });

    function openClass(reference) {
      if (!reference) return;
      const primaryKey = typeof reference === "string" ? reference : reference.primaryKey;
      if (!primaryKey) return;
      instance.state.setState({
        selected: { className: OBJECT_TYPE, primaryKey },
        creating: false,
        creatingAttribute: false,
        editingAttribute: null,
        expandedAttributes: [],
      });
    }

    function backToCatalog() {
      instance.state.setState({
        selected: null,
        creating: false,
        creatingAttribute: false,
        editingAttribute: null,
        expandedAttributes: [],
      });
    }

    function startCreate() {
      instance.state.setState({
        selected: null,
        creating: true,
        creatingAttribute: false,
        editingAttribute: null,
        expandedAttributes: [],
      });
    }

    function cancelCreate() {
      instance.state.set("creating", false);
    }

    function startCreateAttribute() {
      if (!selectedKey.value) return;
      instance.state.set("creatingAttribute", true);
    }

    function cancelCreateAttribute() {
      instance.state.set("creatingAttribute", false);
    }

    // Back navigation from detail view to catalog, guarding unsaved objectForm edits.
    const detailBack = usePanelBack(
      () => Boolean(selectedKey.value),
      backToCatalog,
      { pushHistory: true, forms: "objectForm" },
    );

    // Clear create-attribute mode and expanded attribute rows when no class is selected or when switching classes.
    watch(selectedKey, (nextKey, previousKey) => {
      if (!nextKey || (previousKey && nextKey !== previousKey)) {
        const patch = {};
        if (creatingAttribute.value) patch.creatingAttribute = false;
        if ((instance.state.values.value.expandedAttributes?.length ?? 0) > 0) patch.expandedAttributes = [];
        if (Object.keys(patch).length > 0) instance.state.setState(patch);
      }
    }, { immediate: true });

    // Setting `creating: true` while viewing a class clears selection so the create dialog opens
    // instead of keeping `objectForm` bound to the previously selected object type.
    watch(creating, value => {
      if (!value || !creating.value) return;
      if (selected.value || creatingAttribute.value) {
        instance.state.setState({
          selected: null,
          creatingAttribute: false,
        });
      }
    }, { immediate: true });

    // Keep create-attribute mode valid only inside a class detail.
    watch(creatingAttribute, value => {
      if (!value || !creatingAttribute.value) return;
      if (!selected.value) {
        instance.state.set("creatingAttribute", false);
      }
    }, { immediate: true });

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

    function attributeSaved(saved, outcome) {
      const key = saved?.primaryKey || outcome?.primaryKey;
      const patch = {};
      if (creatingAttribute.value) {
        patch.creatingAttribute = false;
      }
      if (key) {
        patch.expandedAttributes = [key];
      }
      if (Object.keys(patch).length > 0) {
        instance.state.setState(patch);
      }
    }

    function onDeleteObjectDone(outcome) {
      if (outcome?.kind !== "success") return;
      backToCatalog();
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
      createObjectDialog,
      createAttributeDialog,
      configureViewDialog,
      objectDraft,
      startCreate,
      cancelCreate,
      openClass,
      goBack: () => void detailBack.back(),
      objectSaved,
      formDiscarded,
      startCreateAttribute,
      cancelCreateAttribute,
      attributeSaved,
      onDeleteObjectDone,
      onDetailPanelSaved,
      onDetailPanelCleared,
      handleConfigureViewClose,
      configureView,
      openPanelsDirectory,
      browseData,
      openRelation,
    };
  },
});
