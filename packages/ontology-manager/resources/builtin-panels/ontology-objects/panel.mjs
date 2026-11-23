import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelData,
  usePanelFormDraft,
  usePanelOperation,
} from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";
const ATTRIBUTE = "platform:Attribute";

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
    const { instance, t, navigate, notify, confirmLeaveUnsaved } = usePanelContext();
    const state = computed(() => instance.state.values.value);
    const selected = computed(() => state.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const selectedAttribute = computed(() => state.value.selectedAttribute ?? null);

    const catalog = usePanelData("catalog", "rows");
    const detail = usePanelData("detail", "record");
    const attributes = usePanelData("attributes", "rows");
    const relations = usePanelData("relations", "rows");
    const deleteObjectOp = usePanelOperation("deleteObject", "delete");
    const setPrimaryKeyOp = usePanelOperation("setPrimaryKey", "setPrimaryKey");
    const deleteAttributeOp = usePanelOperation("deleteAttribute", "delete");

    // A new object type is being made: set by the header's "新建对象类型" command, so an address can open the dialog.
    const creating = computed(() => state.value.creating === true);
    const setCreating = value => instance.state.set("creating", value);
    // Page-local view state: what the attribute area shows.
    const attributeMode = ref("none"); // none | edit | create
    const attributeError = ref("");
    const busy = ref("");

    // The search keyword is public, deep-linkable state, so the assistant and the address see the same filter.
    const search = computed({
      get: () => state.value.search ?? "",
      set: value => instance.state.set("search", value || null),
    });
    const rows = computed(() => readyRows(catalog));
    const filteredRows = computed(() => {
      const query = search.value.trim().toLowerCase();
      if (!query) return rows.value;
      return rows.value.filter(row =>
        `${row.fields.showName ?? row.label} ${row.fields.className ?? row.primaryKey} ${row.fields.classDesc ?? ""}`
          .toLowerCase()
          .includes(query));
    });
    // A count waits for the owner's answer: while the list is still being read there is no number to show.
    const catalogCount = computed(() => (catalog.value.status === "ready" ? filteredRows.value.length : null));
    const relationRows = computed(() => readyRows(relations));
    const relationCount = computed(() => (relations.value.status === "ready" ? relationRows.value.length : null));
    const labels = computed(() => Object.fromEntries(rows.value.map(row => [row.primaryKey, row.label])));

    const record = computed(() => (detail.value.status === "ready" ? detail.value.value : null));
    const attributeRows = computed(() => readyRows(attributes));
    const primaryKeyAttributes = computed(() => attributeRows.value.filter(row => row.fields.primaryKey === "true"));
    const primaryKeyCount = computed(() => primaryKeyAttributes.value.length);
    // The class's counts and primary-key status are the owner's, from its catalog row of this class: an attribute
    // write reports the object-type catalogue as changed (it is read again) but not the class record itself.
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
    // Setting the primary key is offered for an attribute that is not already the primary key.
    const isPrimaryKey = computed(() => editingAttribute.value?.fields.primaryKey === "true");

    const objectFormHandle = computed(() => instance.forms.handle("objectForm"));
    const savingObject = computed(() => Boolean(objectFormHandle.value?.busy.value));
    const canSaveObject = computed(() => Boolean(objectFormHandle.value) && !savingObject.value);

    const attributeFormHandle = computed(() => instance.forms.handle("attributeForm"));
    const savingAttribute = computed(() => Boolean(attributeFormHandle.value?.busy.value));
    const canSaveAttribute = computed(() => Boolean(attributeFormHandle.value) && !savingAttribute.value);

    async function saveObject() {
      if (!canSaveObject.value) return;
      if (!objectFormHandle.value?.dirty.value) return;
      try {
        await instance.forms.submit("objectForm");
      } catch {
        // ObjectForm renders the owner's validation or refusal message inline on the form.
      }
    }

    async function saveAttribute() {
      if (!canSaveAttribute.value) return;
      if (!attributeFormHandle.value?.dirty.value) return;
      try {
        await instance.forms.submit("attributeForm");
      } catch {
        // ObjectForm renders the owner's validation or refusal message inline on the form.
      }
    }

    // The attribute and relationship reads take the class's API name; it follows the selected class wherever the
    // selection comes from (a click, the address, or the assistant opening this page at a class).
    watch(selected, value => {
      const className = value?.primaryKey ?? null;
      const patch = {};
      if ((state.value.className ?? null) !== className) patch.className = className;
      if (selectedAttribute.value && attributeClass(selectedAttribute.value) !== className) patch.selectedAttribute = null;
      if (Object.keys(patch).length) instance.state.setState(patch);
      if (value) setCreating(false);
      attributeError.value = "";
      if (!selectedAttribute.value || patch.selectedAttribute === null) attributeMode.value = "none";
    }, { immediate: true });

    watch(selectedAttribute, value => {
      attributeError.value = "";
      if (value) attributeMode.value = "edit";
      else if (attributeMode.value === "edit") attributeMode.value = "none";
    }, { immediate: true });

    // An attribute that is no longer listed (deleted here, by the assistant, or elsewhere) is no longer selected.
    watch(attributes, value => {
      if (value.status !== "ready" && value.status !== "empty") return;
      if (selectedAttribute.value && attributeMode.value === "edit" && !editingAttribute.value) closeAttribute();
    });

    // A class the list showed and no longer does was deleted: go back to the catalog. A class the list never held stays
    // selected so a missing deep link shows the empty state instead of silently jumping back.
    const seen = new Set();
    watch([rows, () => catalog.value.status], ([list, status]) => {
      if (status !== "ready") return;
      for (const row of list) seen.add(row.primaryKey);
      const key = selectedKey.value;
      if (key && seen.has(key) && !list.some(row => row.primaryKey === key)) {
        backToCatalog();
      }
    }, { immediate: true });

    // A draft link opens the form that took the draft.
    watch(instance.draft, draft => {
      if (!draft) return;
      if (draft.slot === "objectForm" && !draft.target?.id) {
        setCreating(true);
        instance.state.set("selected", null);
      }
      if (draft.slot === "attributeForm") attributeMode.value = draft.target?.id ? "edit" : "create";
    }, { immediate: true });

    function openClass(primaryKey) {
      setCreating(false);
      instance.state.setState({
        selected: { className: OBJECT_TYPE, primaryKey },
        className: primaryKey,
        selectedAttribute: null,
      });
    }
    function backToCatalog() {
      attributeMode.value = "none";
      instance.state.setState({ selected: null, className: null, selectedAttribute: null, creating: false });
    }
    function cancelCreate() {
      instance.state.setState({ creating: false, selected: null, className: null, selectedAttribute: null });
    }

    // Unified back/leave handling: header back button, Escape, and browser Back all pass through the unsaved guard.
    const back = usePanelBack(
      () => Boolean(selectedKey.value),
      backToCatalog,
      { pushHistory: true },
    );

    const detailTitle = computed(() => (record.value ? record.value.label : selectedKey.value));
    const objectDraft = usePanelFormDraft("objectForm", {
      when: () => Boolean(selectedKey.value) && Boolean(record.value),
    });
    function startCreate() {
      instance.state.setState({ creating: true, selected: null, selectedAttribute: null });
    }

    function objectSaved(object) {
      if (!creating.value) return;
      setCreating(false);
      if (object?.primaryKey) openClass(object.primaryKey);
    }
    function formDiscarded() {
      if (creating.value) cancelCreate();
    }

    async function guardAttributeSwitch() {
      if (attributeMode.value === "edit" && attributeFormHandle.value?.dirty.value && confirmLeaveUnsaved) {
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
      attributeError.value = "";
      attributeMode.value = "create";
    }
    function closeAttribute() {
      instance.state.set("selectedAttribute", null);
      attributeMode.value = "none";
    }
    const createObjectDialog = computed({
      get: () => creating.value && !selected.value,
      set: value => {
        if (!value && creating.value) cancelCreate();
      },
    });
    const createAttributeDialog = computed({
      get: () => Boolean(selected.value) && attributeMode.value === "create",
      set: value => {
        if (!value && attributeMode.value === "create") closeAttribute();
      },
    });
    function attributeSaved(object) {
      if (object?.primaryKey) instance.state.set("selectedAttribute", { className: ATTRIBUTE, primaryKey: object.primaryKey });
      attributeMode.value = "edit";
    }

    /** What the owner answered a reader's operation: success, or the owner's own reason it did not happen. */
    function outcomeOf(receipt) {
      if (!receipt || receipt.decision === "cancel") return { kind: "cancel" };
      const response = receipt.response ?? receipt;
      if (response?.kind === "not-dispatched") return { kind: "failed", message: response.message };
      const outcome = response?.outcome ?? (Array.isArray(response?.outcomes) ? response.outcomes[0] : null);
      if (outcome?.kind === "success") return { kind: "success" };
      if (outcome?.kind === "refusal" || outcome?.kind === "failure") {
        const fieldErrors = Object.values(outcome.fieldErrors ?? outcome.errors ?? {}).join("；");
        return { kind: "failed", message: [outcome.message, fieldErrors].filter(Boolean).join("：") };
      }
      return { kind: "unknown" };
    }
    async function run(name, handle, onSuccess) {
      busy.value = name;
      attributeError.value = "";
      try {
        const result = outcomeOf(await handle.run());
        if (result.kind === "success") onSuccess();
        else if (result.kind === "failed") {
          const message = result.message || t("ot.deleteFailed");
          if (name !== "deleteObject") attributeError.value = message;
          notify({ kind: "error", text: message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (name !== "deleteObject") attributeError.value = message;
        notify({ kind: "error", text: message });
      } finally {
        busy.value = "";
      }
    }
    const removeObject = () => run("deleteObject", deleteObjectOp, () => {
      notify({ kind: "success", text: t("ot.deleted") });
      backToCatalog();
    });
    const makePrimaryKey = () => run("setPrimaryKey", setPrimaryKeyOp, () => {
      notify({ kind: "success", text: t("ot.done") });
    });
    const removeAttribute = () => run("deleteAttribute", deleteAttributeOp, () => {
      notify({ kind: "success", text: t("ot.deleted") });
      closeAttribute();
    });

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
      creating,
      createObjectDialog,
      createAttributeDialog,
      search,
      catalog,
      filteredRows,
      catalogCount,
      relationCount,
      labels,
      detail,
      detailTitle,
      record,
      attributes,
      attributeRows,
      relations,
      relationRows,
      summary,
      primaryKeyCount,
      primaryKeyStatus,
      selected,
      selectedKey,
      selectedAttribute,
      editingAttribute,
      isPrimaryKey,
      attributeMode,
      attributeError,
      busy,
      savingObject,
      canSaveObject,
      savingAttribute,
      canSaveAttribute,
      objectDraft,
      startCreate,
      refresh: () => instance.refreshObjects(),
      deleteObjectOp,
      setPrimaryKeyOp,
      deleteAttributeOp,
      openClass,
      backToCatalog: () => void back.back(),
      cancelCreate,
      saveObject,
      saveAttribute,
      objectSaved,
      formDiscarded,
      openAttribute,
      startCreateAttribute,
      closeAttribute,
      attributeSaved,
      removeObject,
      makePrimaryKey,
      removeAttribute,
      configureView,
      browseData,
      openRelation,
    };
  },
});
