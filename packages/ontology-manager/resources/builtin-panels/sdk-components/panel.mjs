import { computed, ref } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/*
 * 基础组件（platform:SDKComponent，只读目录）。
 *
 * The list is the owner's catalogue read, with the search term in the panel's own deep-linked state, so a refresh or a
 * shared link restores the same search and the same selected component. The detail is the selected component's
 * definition read, drawn as the columns the component itself declares: meaning, the data it requires, its configuration
 * and defaults, its inputs, its outputs and any operation signature it declares. Nothing here is a projection's binding,
 * and nothing here writes: a component changes with an SDK release.
 */

/** The capability map's type mode, opened at the platform's SDK component class. */
const CAPABILITY_MAP = "/ontology/assets/capability-map";
const COMPONENT_CLASS = "platform:SDKComponent";

await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const detail = usePanelData("detail", "definition");
    const navigateError = ref("");

    const record = computed(() => (detail.value.status === "ready" ? detail.value.value : null));
    const selected = computed(() => instance.state.values.value.selected ?? null);
    const search = computed(() => {
      const value = instance.state.values.value.search;
      return typeof value === "string" ? value : "";
    });

    /** One declared port type of this release, in the page's own words. */
    function portTypeText(type) {
      if (!type || typeof type !== "object") return String(type ?? "");
      switch (type.kind) {
        case "object":
          return type.objectType === "@binding"
            ? t("components.port.binding")
            : t("components.port.object", { type: type.objectType });
        case "scalar":
          return t("components.port.scalar", { type: type.type });
        case "object-union": {
          const parts = [
            Array.isArray(type.objectTypes) ? type.objectTypes.join(" / ") : "",
            Array.isArray(type.layers) ? type.layers.join(" + ") : "",
          ].filter(Boolean);
          return t("components.port.union", { parts: parts.join(" · ") });
        }
        case "child-object":
          return t("components.port.childObject", { parent: type.parentType, collection: type.collection });
        case "list":
          return t("components.port.list", { items: portTypeText(type.items) });
        case "placement":
          return t("components.port.placement");
        case "json":
          return t("components.port.json");
        default:
          return String(type.kind);
      }
    }

    /** The release's package name for a module: the owner's list names each component by it. */
    const packageName = computed(() => {
      const module = record.value?.module;
      if (typeof module !== "string" || !module) return "";
      const parts = module.split("/");
      return module.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    });

    const roleText = computed(() => {
      const role = record.value?.role;
      if (role === "presentation") return t("components.role.presentation");
      if (role === "control") return t("components.role.control");
      return String(role ?? "");
    });
    const bindings = computed(() => (Array.isArray(record.value?.bindsElement) ? record.value.bindsElement : []));

    const dataRows = computed(() =>
      Object.entries(record.value?.data ?? {}).map(([name, datum]) => ({
        name: name === "*" ? `${t("components.data.wildcard")} *` : name,
        results: Array.isArray(datum?.results) ? datum.results : [],
        required: datum?.required === true,
        runtimeParams: Array.isArray(datum?.runtimeParams) ? datum.runtimeParams : [],
      })),
    );

    const configRows = computed(() =>
      (Array.isArray(record.value?.config) ? record.value.config : []).map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required === true,
        hasDefault: field.default !== undefined,
        default: field.default,
        description: field.description ?? "",
      })),
    );

    const inputRows = computed(() =>
      Object.entries(record.value?.inputs ?? {}).map(([name, type]) => ({
        name,
        type: portTypeText(type),
        description: "",
      })),
    );

    const slotRows = computed(() =>
      (Array.isArray(record.value?.ports?.slots) ? record.value.ports.slots : []).map((slot) => ({
        name: `#${slot.name}`,
        type: slot.type,
        description: slot.description,
      })),
    );

    const outputRows = computed(() =>
      Object.entries(record.value?.outputs ?? {}).map(([name, type]) => ({
        name,
        type: portTypeText(type),
      })),
    );

    const eventRows = computed(() =>
      (Array.isArray(record.value?.ports?.events) ? record.value.ports.events : []).map((event) => ({
        name: event.name,
        type: event.type,
        description: event.description,
      })),
    );

    /** A component's own declared operations, should a release declare any. */
    const operationRows = computed(() => {
      const operations = record.value?.operations;
      if (!operations) return [];
      const entries = Array.isArray(operations)
        ? operations.map((operation, index) => [String(operation?.id ?? operation?.name ?? index), operation])
        : Object.entries(operations);
      return entries.map(([name, operation]) => ({
        name,
        signature: typeof operation === "string" ? operation : JSON.stringify(operation),
      }));
    });

    async function openComponentClass() {
      navigateError.value = "";
      const state = encodeURIComponent(JSON.stringify({ mode: "type", selectedType: COMPONENT_CLASS }));
      try {
        await navigate(`${CAPABILITY_MAP}?state=${state}`);
      } catch (error) {
        navigateError.value = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      detail,
      record,
      selected,
      search,
      packageName,
      roleText,
      bindings,
      dataRows,
      configRows,
      inputRows,
      slotRows,
      outputRows,
      eventRows,
      operationRows,
      navigateError,
      openComponentClass,
    };
  },
});
