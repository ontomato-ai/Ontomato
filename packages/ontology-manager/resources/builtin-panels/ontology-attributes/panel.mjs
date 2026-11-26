import { computed, defineComponent, h, onBeforeUnmount, ref, resolveComponent, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  useListRowSlot,
  usePanelContext,
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
          class: "attrs-btn-icon",
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
        children.push(h("span", { class: "attrs-delete-reason" }, op.unavailable.reason));
      }
      return h("div", { class: "attrs-row-delete" }, children);
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
    const { instance, navigate, t } = usePanelContext();
    const values = instance.state.values;
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);

    const className = computed(() => values.value.className || "");
    const ownerFilterKey = computed(() => values.value.ownerFilter?.primaryKey || "");
    const creating = computed(() => values.value.creating === true);

    const search = computed({
      get: () => values.value.search ?? "",
      set: (value) => instance.state.set("search", value || null),
    });

    // Keep the deep-linkable scalar `className` and ReferencePicker's object `ownerFilter` synchronized.
    watch(
      className,
      (next) => {
        if (next === ownerFilterKey.value) return;
        instance.state.set("ownerFilter", next ? { className: OBJECT_TYPE, primaryKey: next } : null);
      },
      { immediate: true },
    );
    watch(ownerFilterKey, (next) => {
      if (next === className.value) return;
      instance.state.set("className", next || null);
    });

    const filteredCount = usePanelOutput("attributes", "filteredCount");
    const countText = computed(() => (filteredCount.value === null ? "" : t("attr.count", { count: filteredCount.value })));

    function openOwner(reference) {
      const owner = reference?.primaryKey;
      if (!owner) return;
      void navigate(panelAddress("/ontology/objects", { selected: owner })).catch(() => undefined);
    }

    function clearFilters() {
      instance.state.setState({ className: null, ownerFilter: null, search: null });
    }

    function startCreate() {
      instance.state.set("creating", true);
    }

    function cancelCreate() {
      instance.state.set("creating", false);
    }

    const createDialog = computed({
      get: () => creating.value,
      set: (value) => {
        if (!value && creating.value) cancelCreate();
      },
    });

    function onSaved(saved, outcome) {
      const key = saved?.primaryKey || outcome?.primaryKey;
      instance.state.setState({
        creating: false,
        ...(key ? { expandedAttributes: [key] } : {}),
      });
    }

    function onDiscarded() {
      cancelCreate();
    }

    return {
      rootRef,
      narrow,
      search,
      countText,
      creating,
      createDialog,
      openOwner,
      clearFilters,
      startCreate,
      cancelCreate,
      onSaved,
      onDiscarded,
    };
  },
});
