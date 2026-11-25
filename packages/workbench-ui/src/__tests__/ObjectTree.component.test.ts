import { computed, nextTick, shallowRef } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import ObjectTree from "../../../apps-sdk/src/base/ObjectTree.vue";
import { panelContextKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import type { MemberDataState } from "../../../apps-sdk/src/panel/direct";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { PlatformObjectRecord } from "../../../apps-sdk/src/panel/platform-objects";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

interface MountTreeOptions {
  datumName: "rows" | "files";
  records: PlatformObjectRecord[];
  outputs?: DirectProjection["outputs"];
  config?: Record<string, unknown>;
  props?: Record<string, unknown>;
  initialSelected?: RuntimeJsonValue | null;
  initialSearch?: string;
}

function mountObjectTree({
  datumName,
  records,
  outputs,
  config,
  props = {},
  initialSelected = null,
  initialSearch = "",
}: MountTreeOptions) {
  const selectedRef = shallowRef<RuntimeJsonValue | null>(initialSelected);
  const searchRef = shallowRef<RuntimeJsonValue | null>(initialSearch);
  const dataState = shallowRef<MemberDataState>(
    records.length > 0
      ? { status: "ready", value: records as unknown as RuntimeJsonValue }
      : { status: "empty" },
  );

  const projection = {
    id: "proj-tree",
    componentId: "@ontomato/sdk:ObjectTree",
    data: {
      [datumName]: {
        source: { type: { kind: "PlatformObjectType", id: "platform:OrgUnit" } },
        read: datumName === "rows" ? "list" : "files",
        params: {},
      },
    },
    inputs: {},
    outputs: outputs ?? {
      selected: { kind: "scalar", type: "string" },
      search: { kind: "scalar", type: "string" },
    },
    operations: {},
    ...(config ? { config } : {}),
  } as unknown as DirectProjection;

  const memberContext: PanelMemberContext = {
    key: "tree",
    projection,
    inputs: computed(() => ({})),
    data: {
      use(name: string) {
        if (name !== datumName) {
          throw new Error(`Unexpected datum read '${name}' when only '${datumName}' is declared`);
        }
        return computed(() => dataState.value);
      },
      async read() {
        return dataState.value;
      },
    },
    operations: computed(() => ({}) as unknown as PanelMemberContext["operations"]["value"]),
    param(name: string) {
      if (name === "selected") {
        return {
          value: computed(() => selectedRef.value),
          set(value: RuntimeJsonValue | null) {
            selectedRef.value = value;
          },
        };
      }
      if (name === "search") {
        return {
          value: computed(() => searchRef.value),
          set(value: RuntimeJsonValue | null) {
            searchRef.value = value;
          },
        };
      }
      const local = shallowRef<RuntimeJsonValue | null>(null);
      return {
        value: computed(() => local.value),
        set(value: RuntimeJsonValue | null) {
          local.value = value;
        },
      };
    },
  };

  const panelContext = {
    t: (key: string) => key,
  } as unknown as PanelContext;

  const wrapper = mount(ObjectTree, {
    props,
    global: {
      plugins: [workbenchI18n()],
      provide: {
        [panelContextKey as symbol]: panelContext,
        [panelMemberKey as symbol]: () => memberContext,
      },
    },
  });

  return { wrapper, selectedRef, searchRef, dataState };
}

describe("ObjectTree", () => {
  const orgRecords: PlatformObjectRecord[] = [
    {
      primaryKey: "org-hq",
      label: "Headquarters",
      subtitle: "HQ",
      fields: {},
    },
    {
      primaryKey: "org-rd",
      label: "R&D Center",
      fields: { parentId: "org-hq" },
    },
    {
      primaryKey: "org-plat",
      label: "Platform Team",
      fields: {
        parentId: { kind: "reference", className: "platform:OrgUnit", primaryKey: "org-rd", label: "R&D Center" },
      },
    },
    {
      primaryKey: "org-ops",
      label: "Operations",
      fields: { parentId: "org-hq" },
    },
  ];

  it("renders a parentField hierarchy from rows, folds without changing selection, and writes object refs", async () => {
    const { wrapper, selectedRef } = mountObjectTree({
      datumName: "rows",
      records: orgRecords,
      outputs: {
        selected: { kind: "object", objectType: "platform:OrgUnit" },
        search: { kind: "scalar", type: "string" },
      },
      config: { parentField: "parentId" },
      initialSelected: { className: "platform:OrgUnit", primaryKey: "org-plat" },
    });

    // Preserves input sibling order (R&D Center before Operations) and expands all nodes by default.
    expect(wrapper.findAll('[role="treeitem"]').map((el) => el.attributes("data-key"))).toEqual([
      "org-hq",
      "org-rd",
      "org-plat",
      "org-ops",
    ]);
    expect(wrapper.find('[data-key="org-plat"]').attributes("aria-selected")).toBe("true");
    expect(wrapper.findAll(".fui-path-tree-icon")).toHaveLength(0);

    // Folding parent via disclosure chevron collapses children without altering selection state.
    await wrapper.find('[data-key="org-rd"] .fui-path-tree-toggle').trigger("click");
    expect(wrapper.find('[data-key="org-rd"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-key="org-plat"]').exists()).toBe(false);
    expect(selectedRef.value).toEqual({ className: "platform:OrgUnit", primaryKey: "org-plat" });

    // Clicking the parent node body selects it and writes an object reference to panel state.
    await wrapper.find('[data-key="org-rd"] .fui-path-tree-body').trigger("click");
    expect(selectedRef.value).toEqual({ className: "platform:OrgUnit", primaryKey: "org-rd" });
    expect(wrapper.find('[data-key="org-rd"]').attributes("aria-selected")).toBe("true");
    expect(wrapper.find('[data-key="org-rd"]').attributes("aria-expanded")).toBe("false");
  });

  it("supports fallbackToFirst in depth-first tree order and searchable filtering in hierarchy mode", async () => {
    const { wrapper, selectedRef, searchRef } = mountObjectTree({
      datumName: "rows",
      records: [
        // Child listed before root to verify depth-first root selection.
        {
          primaryKey: "org-child",
          className: "platform:OrgUnit",
          label: "Child Unit",
          fields: { parentId: "org-root" },
        },
        {
          primaryKey: "org-root",
          className: "platform:OrgUnit",
          label: "Root Unit",
          fields: {},
        },
        {
          primaryKey: "org-sibling",
          className: "platform:OrgUnit",
          label: "Sibling Unit",
          fields: { parentId: "org-root" },
        },
      ],
      outputs: {
        selected: { kind: "object", objectType: "platform:OrgUnit" },
        search: { kind: "scalar", type: "string" },
      },
      props: {
        parentField: "parentId",
        fallbackToFirst: true,
        searchable: true,
      },
    });

    await nextTick();
    // Root node is first in depth-first tree order and written as an object ref.
    expect(selectedRef.value).toEqual({ className: "platform:OrgUnit", primaryKey: "org-root" });

    // Searching filters the hierarchy while keeping matched ancestors visible and updating search state.
    const input = wrapper.get('input[type="search"]');
    await input.setValue("Sibling");
    expect(searchRef.value).toBe("Sibling");
    await nextTick();
    expect(wrapper.findAll('[role="treeitem"]').map((el) => el.attributes("data-key"))).toEqual([
      "org-root",
      "org-sibling",
    ]);
  });

  it("preserves files + pathField scalar selection behavior and supports selectableFolders", async () => {
    const { wrapper, selectedRef } = mountObjectTree({
      datumName: "files",
      records: [
        { primaryKey: "k-readme", label: "README.md", fields: { path: "README.md" } },
        { primaryKey: "k-run", label: "run.py", fields: { path: "scripts/run.py" } },
      ],
      props: {
        pathField: "path",
        fallbackToFirst: true,
      },
    });

    await nextTick();
    // First file in folder-first alphabetical order is scripts/run.py, written as scalar string key.
    expect(selectedRef.value).toBe("k-run");
    expect(wrapper.find('[data-path="scripts/run.py"]').attributes("aria-selected")).toBe("true");

    // Clicking folder toggles collapse without changing selection.
    await wrapper.find('[data-path="scripts"] > button').trigger("click");
    expect(wrapper.find('[data-path="scripts"]').attributes("aria-expanded")).toBe("false");
    expect(selectedRef.value).toBe("k-run");

    // Clicking another file updates scalar string selection.
    await wrapper.find('[data-path="README.md"] > button').trigger("click");
    expect(selectedRef.value).toBe("k-readme");
  });
});
