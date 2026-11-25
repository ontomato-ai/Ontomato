import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { AnnotatedCode } from "@ontomato/contracts/annotated-code";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import { panelObjectListColumnSchema } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { BUSINESS_KNOWLEDGE, FUNCTION, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";

vi.mock("@ontomato/contracts/panel-projection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/contracts/panel-projection")>();
  return {
    ...actual,
    directReadDeclaration(
      projection: Parameters<typeof actual.directReadDeclaration>[0],
      data: Parameters<typeof actual.directReadDeclaration>[1],
    ) {
      if (data.read === "annotatedContent") {
        return { source: "object", parameterMode: "fixed", params: {}, result: "annotatedCode" } as const;
      }
      return actual.directReadDeclaration(projection, data);
    },
  };
});

import {
  createDirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

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

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

let cleanup: (() => void) | null = null;
const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  globalThis.ResizeObserver = originalResizeObserver;
  vi.restoreAllMocks();
});

type MockResizeObserverCallback = ConstructorParameters<typeof ResizeObserver>[0];

function installControllableResizeObserver(initialWidth: number) {
  let width = initialWidth;
  const callbacks = new Set<MockResizeObserverCallback>();
  const targetsByCb = new Map<MockResizeObserverCallback, Set<Element>>();

  class MockResizeObserver implements ResizeObserver {
    private readonly cb: MockResizeObserverCallback;
    constructor(cb: MockResizeObserverCallback) {
      this.cb = cb;
      callbacks.add(cb);
      targetsByCb.set(cb, new Set());
    }
    observe(target: Element) {
      targetsByCb.get(this.cb)?.add(target);
      this.cb(
        [{ target, contentRect: { width, height: 320 } as DOMRectReadOnly } as ResizeObserverEntry],
        this,
      );
    }
    unobserve(target: Element) {
      targetsByCb.get(this.cb)?.delete(target);
    }
    disconnect() {
      callbacks.delete(this.cb);
      targetsByCb.delete(this.cb);
    }
  }

  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  return {
    setWidth(nextWidth: number) {
      width = nextWidth;
      for (const cb of callbacks) {
        const targets = targetsByCb.get(cb);
        if (!targets || targets.size === 0) continue;
        const entries = [...targets].map(
          (target) => ({ target, contentRect: { width, height: 320 } as DOMRectReadOnly }) as ResizeObserverEntry,
        );
        cb(entries, {} as ResizeObserver);
      }
    },
  };
}

function mountPanel(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    messages?: Record<string, Record<string, string>>;
    render?: (instance: ReturnType<typeof createDirectPanelInstance>) => ReturnType<typeof h>;
  } = {},
) {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "group-f-pack-b-test",
    url: () => "/panels/group-f-pack-b",
    label: () => "Group F pack B test",
    initial: options.initial as never,
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => answer(request),
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () =>
      options.render
        ? options.render(instance)
        : h(
            "div",
            Object.keys(manifest.members).map((member) => h(PanelMember, { instance, member, key: member })),
          ),
  })
    .use(
      createI18n({
        legacy: false,
        locale: "en",
        messages: { en: publicEn } as never,
      }),
    )
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element };
}

describe("Task 1 (G1): ObjectList rowActivation='expand', controlled expandedKeys, and dirty-form leave guard", () => {
  const sampleRows = [
    {
      className: SCHEDULED_TASK,
      primaryKey: "prop-1",
      label: "Order ID",
      fields: { name: "Order ID", dataType: "string" },
    },
    {
      className: SCHEDULED_TASK,
      primaryKey: "prop-2",
      label: "Total Amount",
      fields: { name: "Total Amount", dataType: "number" },
    },
  ];

  const baseListProjection: DirectProjection = {
    ...meta,
    id: "prop-list",
    name: "Properties",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {
      expandedKeys: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    outputs: {
      expandedKeys: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    config: {
      layout: "table",
      rowActivation: "expand",
      rowExpandMode: "single",
      columns: [
        { key: "name", labelKey: "col.name" },
        { key: "dataType", labelKey: "col.type" },
      ],
    },
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
        read: "list",
        params: {},
      },
    },
    operations: {},
  };

  it("toggles inline detail on whole-row click and Enter/Space, renders trailing chevron without leading expand column, and ignores interactive child clicks/keys", async () => {
    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "prop-list" } },
      },
    });

    const { element } = mountPanel(
      manifest,
      { "prop-list": baseListProjection },
      () => ready(sampleRows),
      {
        messages: { en: { "col.name": "Name", "col.type": "Type" } },
        render: (instance) =>
          h(
            PanelMember,
            { instance, member: "list" },
            {
              "cell-name": (slotProps: { displayText: string; ref: { primaryKey: string } }) =>
                h("div", { class: "custom-name-cell" }, [
                  h("span", { class: "plain-name" }, slotProps.displayText),
                  h("button", { type: "button", class: "inline-btn" }, "Btn"),
                  h("a", { href: "#doc", class: "inline-link", onClick: (e: Event) => e.preventDefault() }, "Link"),
                  h("input", { type: "text", class: "inline-input", value: "abc" }),
                  h("span", { role: "button", class: "inline-role-btn" }, "RoleBtn"),
                  h("span", { "data-row-action": "quick", class: "inline-row-action" }, "Action"),
                ]),
              "row-detail": (slotProps: { ref: { primaryKey: string } }) =>
                h("div", { class: "inline-detail-panel", "data-detail-pk": slotProps.ref.primaryKey }, `Detail:${slotProps.ref.primaryKey}`),
            },
          ),
      },
    );

    await vi.waitFor(() => expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(2));

    // Leading expand column is omitted; trailing chevron indicator with aria-expanded is rendered.
    expect(element.querySelector(".sdk-object-list-expand-col")).toBeNull();
    const indicators = element.querySelectorAll<HTMLButtonElement>("[data-row-expand-indicator='true']");
    expect(indicators.length).toBe(2);
    expect(indicators[0]!.getAttribute("aria-expanded")).toBe("false");

    const rows = element.querySelectorAll<HTMLTableRowElement>("tr[data-row-item='true']");
    const row0 = rows[0]!;
    const row1 = rows[1]!;

    // Clicking interactive descendants does NOT toggle expansion.
    for (const selector of [".inline-btn", ".inline-link", ".inline-input", ".inline-role-btn", ".inline-row-action"]) {
      row0.querySelector<HTMLElement>(selector)!.click();
      await nextTick();
      expect(element.querySelector("[data-detail-pk='prop-1']")).toBeNull();
    }

    // Pressing Enter or Space inside a nested input does NOT toggle expansion.
    const inlineInput = row0.querySelector<HTMLInputElement>(".inline-input")!;
    inlineInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    inlineInput.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await nextTick();
    expect(element.querySelector("[data-detail-pk='prop-1']")).toBeNull();

    // Whole-row click expands row 0 and updates aria-expanded.
    row0.querySelector<HTMLElement>(".plain-name")!.click();
    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-1']")).not.toBeNull());
    expect(row0.getAttribute("aria-expanded")).toBe("true");
    expect(indicators[0]!.getAttribute("aria-expanded")).toBe("true");

    // Pressing Enter on focused row 0 collapses it.
    row0.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-1']")).toBeNull());
    expect(row0.getAttribute("aria-expanded")).toBe("false");

    // Pressing Space on focused row 1 expands row 1.
    row1.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-2']")).not.toBeNull());
    expect(row1.getAttribute("aria-expanded")).toBe("true");
  });

  it("supports controlled expandedKeys via panel state ports, auto-scrolls newly written keys, and respects rowExpandMode", async () => {
    const manifest = definePanel({
      state: {
        expanded: {
          type: { kind: "list", items: { kind: "scalar", type: "string" } },
          personal: false,
          deepLink: false,
          external: false,
        },
      },
      members: {
        list: {
          target: { projectionId: "prop-list" },
          inputs: { expandedKeys: { state: "expanded" } },
          outputs: { expandedKeys: { state: "expanded" } },
        },
      },
    });

    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    const { instance, element } = mountPanel(
      manifest,
      { "prop-list": baseListProjection },
      () => ready(sampleRows),
      {
        initial: { expanded: [] },
        messages: { en: { "col.name": "Name", "col.type": "Type" } },
        render: (inst) =>
          h(
            PanelMember,
            { instance: inst, member: "list" },
            {
              "row-detail": (slotProps: { ref: { primaryKey: string } }) =>
                h("div", { "data-detail-pk": slotProps.ref.primaryKey }, `Detail:${slotProps.ref.primaryKey}`),
            },
          ),
      },
    );

    await vi.waitFor(() => expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(2));
    expect(element.querySelector("[data-detail-pk]")).toBeNull();

    // External state write (e.g. after creating a property) expands the row and scrolls it into view.
    instance.state.set("expanded", ["prop-2"]);
    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-2']")).not.toBeNull());
    await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalled());

    // Clicking row 0 in single mode updates bound expandedKeys state to ["prop-1"].
    element.querySelectorAll<HTMLTableRowElement>("tr[data-row-item='true']")[0]!.click();
    await vi.waitFor(() => expect(instance.state.values.value.expanded).toEqual(["prop-1"]));
    expect(element.querySelector("[data-detail-pk='prop-1']")).not.toBeNull();
    expect(element.querySelector("[data-detail-pk='prop-2']")).toBeNull();
  });

  it("supports prop-controlled expandedKeys + update:expandedKeys in multiple mode", async () => {
    const multipleProjection: DirectProjection = {
      ...baseListProjection,
      id: "prop-list-multi",
      config: { ...baseListProjection.config, rowExpandMode: "multiple" },
    };
    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "prop-list-multi" } },
      },
    });
    const controlled = ref<string[]>(["prop-1"]);
    const updates: string[][] = [];

    const { element } = mountPanel(
      manifest,
      { "prop-list-multi": multipleProjection },
      () => ready(sampleRows),
      {
        messages: { en: { "col.name": "Name", "col.type": "Type" } },
        render: (inst) =>
          h(
            PanelMember,
            {
              instance: inst,
              member: "list",
              expandedKeys: controlled.value,
              "onUpdate:expandedKeys": (next: string[]) => {
                updates.push(next);
                controlled.value = next;
              },
            },
            {
              "row-detail": (slotProps: { ref: { primaryKey: string } }) =>
                h("div", { "data-detail-pk": slotProps.ref.primaryKey }, `Detail:${slotProps.ref.primaryKey}`),
            },
          ),
      },
    );

    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-1']")).not.toBeNull());

    // Expanding row 2 keeps row 1 open in multiple mode.
    element.querySelectorAll<HTMLTableRowElement>("tr[data-row-item='true']")[1]!.click();
    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-2']")).not.toBeNull());
    expect(element.querySelector("[data-detail-pk='prop-1']")).not.toBeNull();
    expect(updates[updates.length - 1]).toEqual(["prop-1", "prop-2"]);
  });

  it("guards collapsing or switching away from an expanded row with a dirty nested ObjectForm (cancel keeps draft, confirm discards and switches)", async () => {
    const formProjection: DirectProjection = {
      ...meta,
      id: "prop-form",
      name: "Property form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        prop: { kind: "object", objectType: FUNCTION },
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: {},
      data: {
        form: {
          source: { object: { input: "prop" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "prop" } },
      },
    };

    const listProjection: DirectProjection = {
      ...baseListProjection,
      id: "fn-list",
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: FUNCTION } },
          read: "query",
          params: {},
        },
      },
    };

    const fnRows = [
      { className: FUNCTION, primaryKey: "fn-1", label: "Alpha", fields: { name: "Alpha", dataType: "string" } },
      { className: FUNCTION, primaryKey: "fn-2", label: "Beta", fields: { name: "Beta", dataType: "number" } },
    ];

    const manifest = definePanel({
      state: {},
      members: {
        list: { target: { projectionId: "fn-list" } },
        detailForm: { target: { projectionId: "prop-form" } },
      },
    });

    const saveOp = {
      kind: "form.save",
      handlerRef: `${FUNCTION}.save`,
      label: "Save",
      effect: "write",
      target: { source: "input", input: "prop" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
    };

    const { element } = mountPanel(
      manifest,
      { "fn-list": listProjection, "prop-form": formProjection },
      (request) => {
        if (request.operations) return ready({ save: saveOp });
        if (request.dataName === "rows") return ready({ rows: fnRows, total: fnRows.length });
        const propInput = (request.inputs as { prop?: { primaryKey?: string } } | undefined)?.prop;
        const pk = propInput?.primaryKey ?? "fn-1";
        return ready({
          fields: [
            { path: "/title", label: "Title", required: false, readOnly: false, valueSchema: {}, control: { kind: "text" } },
          ],
          values: { title: pk === "fn-1" ? "Alpha title" : "Beta title" },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: `/fn/${pk}`, bodySchema: {} },
        });
      },
      {
        messages: { en: { "col.name": "Name", "col.type": "Type" } },
        render: (inst) =>
          h(
            PanelMember,
            { instance: inst, member: "list" },
            {
              "row-detail": (slotProps: { ref: { className: string; primaryKey: string } }) =>
                h("div", { "data-detail-pk": slotProps.ref.primaryKey }, [
                  h(PanelMember, {
                    instance: inst,
                    member: "detailForm",
                    inputs: { prop: slotProps.ref },
                  }),
                ]),
            },
          ),
      },
    );

    await vi.waitFor(() => expect(element.querySelectorAll("tr[data-row-item='true']").length).toBe(2));
    const rows = () => element.querySelectorAll<HTMLTableRowElement>("tr[data-row-item='true']");

    // Expand row 1 and dirty its nested form.
    rows()[0]!.click();
    await vi.waitFor(() => expect(element.querySelector('[data-detail-pk="fn-1"] [data-field="/title"] input')).not.toBeNull());
    const input = element.querySelector<HTMLInputElement>('[data-detail-pk="fn-1"] [data-field="/title"] input')!;
    input.value = "Alpha edited";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(element.querySelector(".sdk-owner-form-unsaved")?.textContent).toContain("1 change"));

    const dialog = () => document.querySelector<HTMLElement>(".el-message-box");
    const clickDialogButton = (label: string) => {
      const btn = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === label,
      );
      expect(btn).toBeTruthy();
      btn!.click();
    };

    // Attempting to collapse row 1 triggers leave confirmation; cancelling keeps row 1 open and draft intact.
    rows()[0]!.click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("Discard"));
    clickDialogButton("Keep editing");
    await vi.waitFor(() => expect(dialog()?.style.display ?? "none").toBe("none"));
    expect(element.querySelector('[data-detail-pk="fn-1"]')).not.toBeNull();
    expect(element.querySelector<HTMLInputElement>('[data-detail-pk="fn-1"] [data-field="/title"] input')!.value).toBe("Alpha edited");

    // Attempting to switch to row 2 in single mode triggers leave confirmation; confirming discards draft and opens row 2.
    rows()[1]!.click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("Discard"));
    clickDialogButton("Discard");
    await vi.waitFor(() => expect(element.querySelector('[data-detail-pk="fn-2"]')).not.toBeNull());
    expect(element.querySelector('[data-detail-pk="fn-1"]')).toBeNull();
    await vi.waitFor(() =>
      expect(element.querySelector<HTMLInputElement>('[data-detail-pk="fn-2"] [data-field="/title"] input')?.value).toBe("Beta title"),
    );
  });

  it("renders trailing expand chevron indicator in accordion layout when rowActivation='expand'", async () => {
    const accordionProjection: DirectProjection = {
      ...baseListProjection,
      id: "prop-accordion",
      config: {
        layout: "accordion",
        rowActivation: "expand",
        rowExpandMode: "single",
      },
    };
    const manifest = definePanel({
      state: {},
      members: { list: { target: { projectionId: "prop-accordion" } } },
    });

    const { element } = mountPanel(
      manifest,
      { "prop-accordion": accordionProjection },
      () => ready(sampleRows),
      {
        render: (inst) =>
          h(
            PanelMember,
            { instance: inst, member: "list" },
            {
              "row-detail": (slotProps: { ref: { primaryKey: string } }) =>
                h("div", { "data-detail-pk": slotProps.ref.primaryKey }, slotProps.ref.primaryKey),
            },
          ),
      },
    );

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-accordion-item").length).toBe(2));
    expect(element.querySelector(".sdk-object-list-accordion-arrow")).toBeNull();
    expect(element.querySelectorAll("[data-row-expand-indicator='true']").length).toBe(2);

    const firstSummary = element.querySelector<HTMLButtonElement>(".sdk-object-list-accordion-summary")!;
    firstSummary.click();
    await vi.waitFor(() => expect(element.querySelector("[data-detail-pk='prop-1']")).not.toBeNull());
    expect(firstSummary.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Task 2 (G2): ObjectList column minContainerWidth responsive hiding", () => {
  it("validates minContainerWidth in panelObjectListColumnSchema", () => {
    expect(panelObjectListColumnSchema.safeParse({ key: "status", minContainerWidth: 640 }).success).toBe(true);
    expect(panelObjectListColumnSchema.safeParse({ key: "status", minContainerWidth: 0 }).success).toBe(false);
    expect(panelObjectListColumnSchema.safeParse({ key: "status", minContainerWidth: -100 }).success).toBe(false);
    expect(panelObjectListColumnSchema.safeParse({ key: "status", minContainerWidth: 420.5 }).success).toBe(false);
  });

  it("hides columns below minContainerWidth, restores them when widened, keeps at least 1 column, and cooperates with showColumnToggle", async () => {
    const observer = installControllableResizeObserver(1000);

    const responsiveProjection: DirectProjection = {
      ...meta,
      id: "responsive-tasks",
      name: "Tasks",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      config: {
        layout: "table",
        showColumnToggle: true,
        columns: [
          { key: "name", labelKey: "col.name", minContainerWidth: 400 },
          { key: "status", labelKey: "col.status", minContainerWidth: 640 },
          { key: "owner", labelKey: "col.owner", minContainerWidth: 900 },
        ],
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
          read: "list",
          params: {},
        },
      },
      operations: {},
    };

    const manifest = definePanel({
      state: {},
      members: { list: { target: { projectionId: "responsive-tasks" } } },
    });

    const { element } = mountPanel(
      manifest,
      { "responsive-tasks": responsiveProjection },
      () =>
        ready([
          {
            className: SCHEDULED_TASK,
            primaryKey: "t-1",
            label: "Daily sync",
            fields: { name: "Daily sync", status: "Active", owner: "Alice" },
          },
        ]),
      { messages: { en: { "col.name": "Name", "col.status": "Status", "col.owner": "Owner" } } },
    );

    const headerTexts = () =>
      [...element.querySelectorAll("thead th")].map((th) => th.textContent?.trim()).filter(Boolean);

    await vi.waitFor(() => expect(headerTexts()).toEqual(["Name", "Status", "Owner"]));

    // Shrink to 700px -> hides Owner (minContainerWidth: 900).
    observer.setWidth(700);
    await vi.waitFor(() => expect(headerTexts()).toEqual(["Name", "Status"]));

    // Manually toggle off Status via showColumnToggle while at 700px.
    const toggleBtn = element.querySelector<HTMLButtonElement>("[data-testid='object-list-column-toggle']")!;
    toggleBtn.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("input[type='checkbox'][data-column-key]").length).toBe(2),
    );
    const statusCheckbox = document.querySelector<HTMLInputElement>(
      "input[type='checkbox'][data-column-key='status']",
    )!;
    statusCheckbox.checked = false;
    statusCheckbox.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(headerTexts()).toEqual(["Name"]));

    // Shrink below every column's minContainerWidth (250px < 400px) -> still preserves at least 1 column (Name).
    observer.setWidth(250);
    await nextTick();
    expect(headerTexts()).toEqual(["Name"]);

    // Widen back to 1000px -> Owner restores automatically while manually hidden Status stays hidden.
    observer.setWidth(1000);
    await vi.waitFor(() => expect(headerTexts()).toEqual(["Name", "Owner"]));
  });
});

describe("Task 3 (G5): AnnotatedCode automatic token-based syntax highlighting", () => {
  const codeProjection: DirectProjection = {
    ...meta,
    id: "annotated-code-view",
    name: "Code",
    componentId: "@ontomato/sdk:AnnotatedCode",
    inputs: {
      object: { kind: "object", objectType: FUNCTION },
      language: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      content: { source: { object: { input: "object" } }, read: "annotatedContent", params: {} },
    },
    operations: {},
  };

  it("highlights Python code including multiline triple-quoted strings safely without v-html and preserves segment linkage", async () => {
    const pythonPayload: AnnotatedCode = {
      code: [
        "def run_action(limit: int) -> str:",
        '    """Compute <img src=x onerror=alert(1)>',
        "    across multiple lines",
        '    """',
        "    count = 42  # total items",
        '    return "ok"',
      ].join("\n"),
      segments: [
        {
          id: "seg-def",
          kind: "HEADER",
          kindLabel: "Header",
          title: "Function signature",
          lineRange: { start: 1, end: 1 },
          tone: "info",
          note: "Entry signature",
        },
        {
          id: "seg-body",
          kind: "RETURN",
          kindLabel: "Return",
          title: "Compute result",
          lineRange: { start: 5, end: 6 },
          tone: "success",
          note: "Returns status",
        },
      ],
    };

    const manifest = definePanel({
      state: {
        target: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: false, external: false },
      },
      members: {
        code: { target: { projectionId: "annotated-code-view" }, inputs: { object: { state: "target" } } },
      },
    });

    const { element } = mountPanel(
      manifest,
      { "annotated-code-view": codeProjection },
      () => ready(pythonPayload),
      {
        initial: { target: { className: FUNCTION, primaryKey: "fn-py" } },
        render: (inst) => h(PanelMember, { instance: inst, member: "code", language: "python" }),
      },
    );

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-line").length).toBe(6));

    // Safe text-node rendering: zero injected <img> tags from payload.
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain("<img src=x onerror=alert(1)>");

    // Syntax token spans exist for Python keywords, functions, multiline strings, numbers, and comments.
    expect(element.querySelector('.sdk-code-tok[data-tok="keyword"]')?.textContent).toBe("def");
    expect(element.querySelector('.sdk-code-tok[data-tok="function"]')?.textContent).toBe("run_action");
    expect(element.querySelector('.sdk-code-tok[data-tok="number"]')?.textContent).toBe("42");
    expect(element.querySelector('.sdk-code-tok[data-tok="comment"]')?.textContent).toBe("# total items");

    const lines = element.querySelectorAll<HTMLElement>(".sdk-annotated-code-line");
    expect(lines[2]!.querySelector('.sdk-code-tok[data-tok="string"]')?.textContent).toContain("across multiple lines");

    // Legend, line numbers, and line <-> segment linkage remain intact.
    expect(element.querySelectorAll(".sdk-annotated-code-legend-item").length).toBe(2);
    expect(lines[0]!.querySelector(".sdk-annotated-code-line-no")?.textContent).toBe("1");
    lines[4]!.click();
    await vi.waitFor(() => expect(lines[4]!.getAttribute("data-hit")).toBe("true"));
    expect(element.querySelector('[data-segment-id="seg-body"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("reads language from props (SQL) and panel input (JSON), and falls back to plain text when omitted or plain", async () => {
    const sqlPayload: AnnotatedCode = {
      code: "SELECT id FROM orders WHERE status = 'open' -- active",
      segments: [],
    };
    const jsonPayload: AnnotatedCode = {
      code: '{ "retries": 3, "enabled": true }',
      segments: [],
    };

    const langProp = ref<string | null>("sql");
    const currentPayload = ref<AnnotatedCode>(sqlPayload);

    const manifest = definePanel({
      state: {
        target: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: false, external: false },
        lang: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
      },
      members: {
        code: {
          target: { projectionId: "annotated-code-view" },
          inputs: { object: { state: "target" }, language: { state: "lang" } },
        },
      },
    });

    const { instance, element } = mountPanel(
      manifest,
      { "annotated-code-view": codeProjection },
      () => ready(currentPayload.value),
      {
        initial: { target: { className: FUNCTION, primaryKey: "fn-1" }, lang: "" },
        render: (inst) => h(PanelMember, { instance: inst, member: "code", language: langProp.value ?? undefined }),
      },
    );

    // 1) props.language = "sql" highlights SQL automatically.
    await vi.waitFor(() => expect(element.querySelector('.sdk-code-tok[data-tok="keyword"]')?.textContent).toBe("SELECT"));
    expect(element.querySelector('.sdk-code-tok[data-tok="string"]')?.textContent).toBe("'open'");
    expect(element.querySelector('.sdk-code-tok[data-tok="comment"]')?.textContent).toBe("-- active");

    // 2) Switch to JSON via panel input `language`.
    langProp.value = null;
    currentPayload.value = jsonPayload;
    instance.state.set("lang", "json");
    instance.state.set("target", { className: FUNCTION, primaryKey: "fn-2" });
    await vi.waitFor(() => expect(element.querySelector('.sdk-code-tok[data-tok="property"]')?.textContent).toBe('"retries"'));
    expect(element.querySelector('.sdk-code-tok[data-tok="number"]')?.textContent).toBe("3");
    expect(element.querySelector('.sdk-code-tok[data-tok="builtin"]')?.textContent).toBe("true");

    // 3) Plain language falls back to plain text without `.sdk-code-tok` spans.
    langProp.value = "plain";
    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-code-tok").length).toBe(0));
    expect(element.querySelector(".sdk-annotated-code-line-text")?.textContent).toBe('{ "retries": 3, "enabled": true }');

    // 4) Omitted language with no datum.language also renders plain text.
    langProp.value = null;
    instance.state.set("lang", "");
    await nextTick();
    expect(element.querySelectorAll(".sdk-code-tok").length).toBe(0);
  });
});
