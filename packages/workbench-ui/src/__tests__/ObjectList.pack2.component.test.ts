import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { BUSINESS_KNOWLEDGE } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../apps-sdk/src/panel/direct";
import PanelMember from "../../../apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../apps-sdk/src/panel/text";
import ObjectListRowActions from "../../../apps-sdk/src/base/ObjectListRowActions.vue";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const unused = () => {
  throw new Error("Unexpected host operation in ObjectList Pack 2C test");
};

const noOperations = {
  operations: { describe: unused, read: unused, upload: unused, prepare: unused },
  confirmOperation: unused,
  expandPageComposer: unused,
  navigate: unused,
  nested: unused,
  readComponentPackage: unused,
};

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function flushUi(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function mountDirectList(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse,
  options: {
    messages?: Record<string, Record<string, string>>;
    memberProps?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "object-list-pack2-test",
    url: () => "/panels/object-list-pack2",
    label: () => "ObjectList Pack 2C",
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => answer(request),
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () =>
      h(
        "div",
        Object.keys(manifest.members).map((member) =>
          h(PanelMember, {
            instance,
            member,
            key: member,
            ...(options.memberProps?.[member] ?? {}),
          }),
        ),
      ),
  })
    .use(workbenchI18n())
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element };
}

function buildListProjection(
  id: string,
  config: Record<string, unknown>,
  outputs: Record<string, unknown> = {},
): DirectProjection {
  return {
    id,
    name: id,
    ...meta,
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {},
    outputs,
    config,
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "query",
        params: {},
      },
    },
  } as unknown as DirectProjection;
}

describe("ObjectList Pack 2C features", () => {
  it("renders value-carried tag tones/icons in kind:tags, resolves per-item valueMap, ignores row.tones on tag arrays, and supports tagEffect='plain'", async () => {
    const manifest = definePanel({
      state: {},
      members: {
        list: {
          target: { projectionId: "list" },
        },
      },
    }) as unknown as DirectPanelManifest;

    const projections: Record<string, DirectProjection> = {
      list: buildListProjection("list", {
        layout: "table",
        columns: [
          { key: "label", labelKey: "col.name" },
          {
            key: "statuses",
            labelKey: "col.statuses",
            kind: "tags",
            tagEffect: "plain",
          },
          {
            key: "envTags",
            labelKey: "col.envs",
            kind: "tags",
            valueMap: {
              prod: { label: "Production", icon: "check-circle" },
              staging: { label: "Staging" },
            },
          },
          {
            key: "primaryBadge",
            labelKey: "col.badge",
            kind: "tag",
            tagEffect: "plain",
          },
        ],
      }),
    };

    const { element } = mountDirectList(
      manifest,
      projections,
      () => ({
        status: "ready",
        value: {
          rows: [
            {
              className: BUSINESS_KNOWLEDGE,
              primaryKey: "wf-1",
              label: "Order Approval",
              fields: {
                statuses: [
                  { kind: "tag", label: "Active", tone: "success", icon: "check-circle" },
                  { kind: "tag", label: "Draft", tone: "warning" },
                ],
                envTags: ["prod", "staging", "sandbox"],
                primaryBadge: { kind: "tag", label: "Verified", tone: "success", icon: "check-circle" },
              },
              // Red line: row.tones must NEVER override kind: "tags" arrays.
              tones: {
                statuses: "danger",
                envTags: "success",
              },
            },
          ],
          total: 1,
          fieldLabels: {},
        } as never,
      }),
      {
        messages: {
          en: {
            "col.name": "Name",
            "col.statuses": "Statuses",
            "col.envs": "Environments",
            "col.badge": "Badge",
          },
        },
      },
    );

    await vi.waitFor(
      () => {
        expect(element.querySelectorAll("tbody tr td").length).toBe(4);
      },
      { timeout: 5000 },
    );

    const rowCells = element.querySelectorAll("tbody tr td");

    // Column 2: value-carried tag items with individual tones, optional icon, and plain effect.
    const statusTags = rowCells[1]!.querySelectorAll(".sdk-object-list-tag");
    expect(statusTags.length).toBe(2);
    expect(statusTags[0]!.textContent?.trim()).toBe("Active");
    expect(statusTags[0]!.getAttribute("data-tone")).toBe("success");
    expect(statusTags[0]!.getAttribute("data-effect")).toBe("plain");
    expect(statusTags[0]!.querySelector(".sdk-object-list-tag-icon")?.getAttribute("data-icon")).toBe("check-circle");

    expect(statusTags[1]!.textContent?.trim()).toBe("Draft");
    expect(statusTags[1]!.getAttribute("data-tone")).toBe("warning");
    expect(statusTags[1]!.getAttribute("data-effect")).toBe("plain");

    // Column 3: per-item valueMap resolves label/icon only; tag tone falls back to "info" (NOT row.tones.envTags = "success").
    const envTags = rowCells[2]!.querySelectorAll(".sdk-object-list-tag");
    expect(envTags.length).toBe(3);
    expect(envTags[0]!.textContent?.trim()).toBe("Production");
    expect(envTags[0]!.getAttribute("data-tone")).toBe("info");
    expect(envTags[0]!.querySelector(".sdk-object-list-tag-icon")?.getAttribute("data-icon")).toBe("check-circle");
    expect(envTags[1]!.textContent?.trim()).toBe("Staging");
    expect(envTags[1]!.getAttribute("data-tone")).toBe("info");
    expect(envTags[2]!.textContent?.trim()).toBe("sandbox");
    expect(envTags[2]!.getAttribute("data-tone")).toBe("info");

    // Column 4: single kind="tag" value-carried tag with icon and plain effect.
    const badgeTag = rowCells[3]!.querySelector(".sdk-object-list-tag")!;
    expect(badgeTag.textContent?.trim()).toBe("Verified");
    expect(badgeTag.getAttribute("data-tone")).toBe("success");
    expect(badgeTag.getAttribute("data-effect")).toBe("plain");
    expect(badgeTag.querySelector(".sdk-object-list-tag-icon")?.getAttribute("data-icon")).toBe("check-circle");
  });

  it("renders headerTooltipKey help trigger beside table column header without bubbling click to the header", async () => {
    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "list" } },
      },
    }) as unknown as DirectPanelManifest;

    const projections: Record<string, DirectProjection> = {
      list: buildListProjection("list", {
        layout: "table",
        columns: [
          { key: "label", labelKey: "col.name" },
          { key: "scope", labelKey: "col.scope", headerTooltipKey: "col.scopeTip" },
        ],
      }),
    };

    const { element } = mountDirectList(
      manifest,
      projections,
      () => ({
        status: "ready",
        value: {
          rows: [
            { className: BUSINESS_KNOWLEDGE, primaryKey: "row-1", label: "Policy A", fields: { scope: "Global" } },
          ],
          total: 1,
          fieldLabels: {},
        } as never,
      }),
      {
        messages: {
          en: {
            "col.name": "Name",
            "col.scope": "Scope",
            "col.scopeTip": "Applies to this unit and all descendant units.",
          },
        },
      },
    );

    await vi.waitFor(
      () => {
        expect(element.querySelectorAll("thead th").length).toBe(2);
      },
      { timeout: 5000 },
    );

    const headers = element.querySelectorAll("thead th");
    expect(headers[0]!.querySelector(".sdk-object-list-th-help")).toBeNull();

    const helpTrigger = headers[1]!.querySelector(".sdk-object-list-th-help") as HTMLElement | null;
    expect(helpTrigger).not.toBeNull();
    expect(helpTrigger!.getAttribute("aria-label")).toBe("Applies to this unit and all descendant units.");

    let headerClicks = 0;
    headers[1]!.addEventListener("click", () => {
      headerClicks += 1;
    });
    helpTrigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushUi(1);
    expect(headerClicks).toBe(0);
  });

  it("disables matching row checkboxes with checkDisabledWhen, blocks toggleChecked, and excludes disabled rows from select-all", async () => {
    const manifest = definePanel({
      state: {
        checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
      },
      members: {
        list: {
          target: { projectionId: "list" },
          outputs: { checked: { state: "checked" } },
        },
      },
    }) as unknown as DirectPanelManifest;

    const projections: Record<string, DirectProjection> = {
      list: buildListProjection(
        "list",
        {
          layout: "table",
          columns: [{ key: "label", labelKey: "col.name" }],
          checkDisabledWhen: { field: "locked", equals: true },
        },
        {
          checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
        },
      ),
    };

    const { instance, element } = mountDirectList(
      manifest,
      projections,
      () => ({
        status: "ready",
        value: {
          rows: [
            { className: BUSINESS_KNOWLEDGE, primaryKey: "m-1", label: "Alice", fields: { locked: true } },
            { className: BUSINESS_KNOWLEDGE, primaryKey: "m-2", label: "Bob", fields: { locked: false } },
            { className: BUSINESS_KNOWLEDGE, primaryKey: "m-3", label: "Carol", fields: { locked: false } },
          ],
          total: 3,
          fieldLabels: {},
        } as never,
      }),
      { messages: { en: { "col.name": "Member" } } },
    );

    await vi.waitFor(
      () => {
        expect(element.querySelectorAll("tbody input[type='checkbox']").length).toBe(3);
      },
      { timeout: 5000 },
    );

    const headerCheck = element.querySelector("thead input[type='checkbox']") as HTMLInputElement;
    const rowChecks = Array.from(element.querySelectorAll("tbody input[type='checkbox']")) as HTMLInputElement[];
    expect(rowChecks[0]!.disabled).toBe(true);
    expect(rowChecks[1]!.disabled).toBe(false);
    expect(rowChecks[2]!.disabled).toBe(false);
    expect(headerCheck.disabled).toBe(false);

    // Attempting to fire change on the disabled row checkbox does not add it to checked state.
    rowChecks[0]!.checked = true;
    rowChecks[0]!.dispatchEvent(new Event("change"));
    await flushUi();
    expect(instance.state.values.value.checked ?? []).toEqual([]);

    // Select-all checks ONLY the selectable (non-disabled) visible rows.
    headerCheck.checked = true;
    headerCheck.dispatchEvent(new Event("change"));
    await flushUi();
    expect(instance.state.values.value.checked).toEqual([
      { className: BUSINESS_KNOWLEDGE, primaryKey: "m-2" },
      { className: BUSINESS_KNOWLEDGE, primaryKey: "m-3" },
    ]);
    expect(headerCheck.checked).toBe(true);

    // Unchecking one selectable row transitions header checkbox to indeterminate.
    rowChecks[1]!.checked = false;
    rowChecks[1]!.dispatchEvent(new Event("change"));
    await flushUi();
    expect(instance.state.values.value.checked).toEqual([
      { className: BUSINESS_KNOWLEDGE, primaryKey: "m-3" },
    ]);
    expect(headerCheck.checked).toBe(false);
    expect(headerCheck.indeterminate).toBe(true);
  });

  it("renders overflow menu item icons and supports rowActionIconVariant='bordered' on icon-only buttons", async () => {
    const wrapper = mount(ObjectListRowActions, {
      props: {
        iconVariant: "bordered",
        maxVisible: 1,
        items: [
          {
            key: "edit",
            kind: "local",
            id: "edit",
            label: "Edit",
            icon: "edit",
            iconOnly: true,
            tone: "default",
            disabled: false,
            busy: false,
          },
          {
            key: "delete",
            kind: "local",
            id: "delete",
            label: "Delete",
            icon: "trash-2",
            tone: "danger",
            disabled: false,
            busy: false,
          },
        ],
      },
      global: {
        plugins: [workbenchI18n(), ElementPlus],
      },
    });

    await flushUi();

    const editBtn = wrapper.get("button.sdk-object-list-action-btn");
    expect(editBtn.classes()).toContain("is-icon-only");
    expect(editBtn.classes()).toContain("is-bordered");

    // Open overflow dropdown and verify item icon is rendered beside label.
    await wrapper.get("button.sdk-object-list-action-more-btn").trigger("click");
    await flushUi();
    const moreIcon = document.body.querySelector(".sdk-object-list-more-icon");
    const moreLabel = document.body.querySelector(".sdk-object-list-more-label");
    expect(moreIcon).not.toBeNull();
    expect(moreLabel?.textContent?.trim()).toBe("Delete");
  });

  it("passes rowActionIconVariant='bordered' from ObjectList through to ObjectListRowActions", async () => {
    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "list" } },
      },
    }) as unknown as DirectPanelManifest;

    const projections: Record<string, DirectProjection> = {
      list: buildListProjection("list", {
        layout: "table",
        columns: [{ key: "label", labelKey: "col.name" }],
        rowActionIconVariant: "bordered",
        rowActions: {
          maxVisible: 2,
          items: [
            { kind: "local", id: "inspect", labelKey: "act.inspect", icon: "eye", iconOnly: true },
          ],
        },
      }),
    };

    const { element } = mountDirectList(
      manifest,
      projections,
      () => ({
        status: "ready",
        value: {
          rows: [
            { className: BUSINESS_KNOWLEDGE, primaryKey: "r-1", label: "Row 1", fields: {} },
          ],
          total: 1,
          fieldLabels: {},
        } as never,
      }),
      { messages: { en: { "col.name": "Name", "act.inspect": "Inspect" } } },
    );

    await vi.waitFor(
      () => {
        expect(element.querySelector("button.sdk-object-list-action-btn")).not.toBeNull();
      },
      { timeout: 5000 },
    );

    const actionBtn = element.querySelector("button.sdk-object-list-action-btn");
    expect(actionBtn!.classList.contains("is-icon-only")).toBe(true);
    expect(actionBtn!.classList.contains("is-bordered")).toBe(true);
  });

  it("renders left subtitle and right-aligned metaField on compact layout='list'", async () => {
    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "list" } },
      },
    }) as unknown as DirectPanelManifest;

    const projections: Record<string, DirectProjection> = {
      list: buildListProjection("list", {
        layout: "list",
        subtitleField: "endpoint",
        metaField: "toolCount",
      }),
    };

    const { element } = mountDirectList(
      manifest,
      projections,
      () => ({
        status: "ready",
        value: {
          rows: [
            {
              className: BUSINESS_KNOWLEDGE,
              primaryKey: "mcp-1",
              label: "Billing MCP",
              fields: {
                endpoint: "https://mcp.example.com/billing",
                toolCount: "12 tools",
              },
              highlights: {
                endpoint: [{ start: 24, end: 31 }],
                toolCount: [{ start: 0, end: 2 }],
              },
            },
          ],
          total: 1,
          fieldLabels: {},
        } as never,
      }),
    );

    await vi.waitFor(
      () => {
        expect(element.querySelector(".sdk-object-list-item-sub-row")).not.toBeNull();
      },
      { timeout: 5000 },
    );

    const subRow = element.querySelector(".sdk-object-list-item-sub-row");

    const subtitle = subRow!.querySelector(".sdk-object-list-item-sub");
    const metaEl = subRow!.querySelector(".sdk-object-list-item-meta");
    expect(subtitle?.textContent?.trim()).toBe("https://mcp.example.com/billing");
    expect(metaEl?.textContent?.trim()).toBe("12 tools");
    expect(subtitle?.querySelector("mark")?.textContent).toBe("billing");
    expect(metaEl?.querySelector("mark")?.textContent).toBe("12");
  });
});
