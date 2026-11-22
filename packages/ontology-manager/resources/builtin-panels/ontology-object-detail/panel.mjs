import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelData,
} from "@ontomato/sdk/panel";

const ATTRIBUTE = "platform:Attribute";
const CATALOG_PATH = "/ontology/objects";

/** The class an attribute reference belongs to: its owner keys it as the JSON pair [className, attributeName]. */
function attributeClass(reference) {
  try {
    const key = JSON.parse(reference?.primaryKey ?? "");
    return Array.isArray(key) ? key[0] : null;
  } catch {
    return null;
  }
}

const readyRows = data => (data.value.status === "ready" && Array.isArray(data.value.value) ? data.value.value : []);

await mountPanel({
  setup() {
    const { instance, t, navigate, confirmLeaveUnsaved } = usePanelContext();
    const state = computed(() => instance.state.values.value);
    const selected = computed(() => state.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const selectedAttribute = computed(() => state.value.selectedAttribute ?? null);

    const catalog = usePanelData("catalog", "rows");
    const detail = usePanelData("detail", "record");
    const attributes = usePanelData("attributes", "rows");
    const relations = usePanelData("relations", "rows");

    // Page-local view state: whether the attribute area is collapsed, editing an attribute inline, or creating one.
    const attributeMode = ref("none"); // none | edit | create

    const rows = computed(() => readyRows(catalog));
    const labels = computed(() => Object.fromEntries(rows.value.map(row => [row.primaryKey, row.label])));
    const record = computed(() => (detail.value.status === "ready" ? detail.value.value : null));
    const attributeRows = computed(() => readyRows(attributes));
    const relationRows = computed(() => readyRows(relations));
    const relationCount = computed(() => (relations.value.status === "ready" ? relationRows.value.length : null));
    const primaryKeyAttributes = computed(() => attributeRows.value.filter(row => row.fields.primaryKey === "true"));
    const primaryKeyCount = computed(() => primaryKeyAttributes.value.length);

    // The class's counts and primary-key status come from its catalog row: an attribute write refreshes the object-type
    // catalogue rather than the class record itself.
    const summary = computed(() =>
      rows.value.find(row => row.primaryKey === selectedKey.value)?.fields ?? record.value?.fields ?? null);
    const primaryKeyStatus = computed(() => {
      const status = summary.value?.primaryKey;
      if (!status) return null;
      if (status === "ok") {
        const names = primaryKeyAttributes.value.map(row => row.label).join("、");
        return { type: "success", text: t("ot.pkOk", { name: names || "-" }) };
      }
      if (status === "missing") return { type: "warning", text: t("ot.pkMissing") };
      if (status === "multiple") return { type: "error", text: t("ot.pkMultiple") };
      if (status === "disabled") return { type: "warning", text: t("ot.pkDisabled") };
      return { type: "info", text: t("ot.pkUnknown", { status }) };
    });

    const editingAttribute = computed(() =>
      attributeRows.value.find(row => row.primaryKey === selectedAttribute.value?.primaryKey) ?? null);
    const isPrimaryKey = computed(() => editingAttribute.value?.fields.primaryKey === "true");
    const attributeFormHandle = computed(() => instance.forms.handle("attributeForm"));

    // Keep the attribute/relationship query parameter `className` synchronized with `selected`.
    watch(selected, value => {
      const className = value?.primaryKey ?? null;
      const patch = {};
      if ((state.value.className ?? null) !== className) patch.className = className;
      if (selectedAttribute.value && attributeClass(selectedAttribute.value) !== className) patch.selectedAttribute = null;
      if (Object.keys(patch).length) instance.state.setState(patch);
      if (!selectedAttribute.value || patch.selectedAttribute === null) attributeMode.value = "none";
    }, { immediate: true });

    watch(selectedAttribute, value => {
      if (value) attributeMode.value = "edit";
      else if (attributeMode.value === "edit") attributeMode.value = "none";
    }, { immediate: true });

    // An attribute that is no longer listed (deleted here, by the assistant, or elsewhere) is cleared from selection.
    watch(attributes, value => {
      if (value.status !== "ready" && value.status !== "empty") return;
      if (selectedAttribute.value && attributeMode.value === "edit" && !editingAttribute.value) closeAttribute();
    });

    // If the currently open class was listed and then disappeared (deleted), return to the catalog. A deep link to a
    // class that never existed stays here so the missing-object empty state is shown instead of jumping silently.
    const seen = new Set();
    watch([rows, () => catalog.value.status], ([list, status]) => {
      if (status !== "ready") return;
      for (const row of list) seen.add(row.primaryKey);
      const key = selectedKey.value;
      if (key && seen.has(key) && !list.some(row => row.primaryKey === key)) {
        instance.forms.discardAll();
        void navigate(CATALOG_PATH).catch(() => undefined);
      }
    }, { immediate: true });

    // A draft link opens the attribute form in create or edit mode when targeted there.
    watch(instance.draft, draft => {
      if (!draft) return;
      if (draft.slot === "attributeForm") attributeMode.value = draft.target?.id ? "edit" : "create";
    }, { immediate: true });

    // Pressing Escape (with no modal open) guards unsaved edits and returns to the catalog; browser Back and the
    // platform header's Back button run natively through Vue Router and the host's unsaved-changes guard.
    usePanelBack(
      () => true,
      () => {
        instance.forms.discardAll();
        void navigate(CATALOG_PATH).catch(() => undefined);
      },
      { pushHistory: false },
    );

    async function guardAttributeSwitch() {
      if (attributeMode.value === "edit" && (attributeFormHandle.value?.changed.value.size ?? 0) > 0 && confirmLeaveUnsaved) {
        return await confirmLeaveUnsaved();
      }
      return true;
    }

    async function openAttribute(row) {
      if (attributeMode.value === "edit" && selectedAttribute.value?.primaryKey === row.primaryKey) {
        if (!(await guardAttributeSwitch())) return;
        closeAttribute();
        return;
      }
      if (!(await guardAttributeSwitch())) return;
      instance.state.set("selectedAttribute", { className: ATTRIBUTE, primaryKey: row.primaryKey });
      attributeMode.value = "edit";
    }
    async function startCreateAttribute() {
      if (!(await guardAttributeSwitch())) return;
      instance.state.set("selectedAttribute", null);
      attributeMode.value = "create";
    }
    function closeAttribute() {
      instance.state.set("selectedAttribute", null);
      attributeMode.value = "none";
    }
    const createAttributeDialog = computed({
      get: () => Boolean(record.value) && attributeMode.value === "create",
      set: value => {
        if (!value && attributeMode.value === "create") closeAttribute();
      },
    });
    function attributeSaved(object) {
      if (object?.primaryKey) instance.state.set("selectedAttribute", { className: ATTRIBUTE, primaryKey: object.primaryKey });
      attributeMode.value = "edit";
    }

    function onObjectDeleted(outcome) {
      if (outcome?.kind === "success") {
        instance.forms.discardAll();
        void navigate(CATALOG_PATH).catch(() => undefined);
      }
    }
    function onAttributeDeleted(outcome) {
      if (outcome?.kind === "success") {
        closeAttribute();
      }
    }

    const configureView = () =>
      navigate(`/ontology/objects/${encodeURIComponent(selectedKey.value)}/view`).catch(() => undefined);
    const browseData = () =>
      navigate(`/browser/data/${encodeURIComponent(selectedKey.value)}`).catch(() => undefined);
    const openRelation = row => {
      if (!row?.primaryKey) return;
      const param = JSON.stringify({ selected: { className: "platform:Relationship", primaryKey: row.primaryKey } });
      void navigate(`/ontology/relations?${new globalThis.URLSearchParams({ state: param })}`).catch(() => undefined);
    };

    return {
      t,
      selectedKey,
      selectedAttribute,
      detail,
      record,
      attributes,
      attributeRows,
      relations,
      relationRows,
      relationCount,
      labels,
      summary,
      primaryKeyCount,
      primaryKeyStatus,
      editingAttribute,
      isPrimaryKey,
      attributeMode,
      createAttributeDialog,
      openAttribute,
      startCreateAttribute,
      closeAttribute,
      attributeSaved,
      onObjectDeleted,
      onAttributeDeleted,
      configureView,
      browseData,
      openRelation,
    };
  },
});
