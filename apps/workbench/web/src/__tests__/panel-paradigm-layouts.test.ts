import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE, EXPORT_SKILL } from "@ontomato/contracts/platform-object-types";
import { randomId } from "@ontomato/contracts/random-id";
import en from "@ontomato/workbench-ui/locales/en";
import TwoPaneLayout from "../../../../../packages/apps-sdk/src/base/TwoPaneLayout.vue";
import WorkbenchLayout from "../../../../../packages/apps-sdk/src/base/WorkbenchLayout.vue";
import ObjectHeader from "../../../../../packages/apps-sdk/src/base/ObjectHeader.vue";
import type { PanelOperationDescriptor } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside,
  installPlatform,
  leaveFrame,
  panelFrame,
  panelRecord,
  panelUse,
  registered,
  writePanelDocument,
  type Sent,
} from "./panel-frame";

type ResizeObserverController = {
  resize(width: number, target?: Element): void;
  restore(): void;
};

type ResizeCallback = ConstructorParameters<typeof ResizeObserver>[0];

function installMockResizeObserver(initialWidth: number): ResizeObserverController {
  const Original = globalThis.ResizeObserver;
  const instances: Array<{ callback: ResizeCallback; targets: Set<Element> }> = [];

  class MockResizeObserver implements ResizeObserver {
    private readonly record: { callback: ResizeCallback; targets: Set<Element> };
    constructor(callback: ResizeCallback) {
      this.record = { callback, targets: new Set() };
      instances.push(this.record);
    }
    observe(target: Element) {
      this.record.targets.add(target);
      this.record.callback(
        [{ target, contentRect: { width: initialWidth, height: 600 } as DOMRectReadOnly } as ResizeObserverEntry],
        this,
      );
    }
    unobserve(target: Element) {
      this.record.targets.delete(target);
    }
    disconnect() {
      this.record.targets.clear();
    }
  }

  globalThis.ResizeObserver = MockResizeObserver;
  return {
    resize(width: number, target?: Element) {
      for (const instance of instances) {
        const matched = target ? [...instance.targets].filter((item) => item === target) : [...instance.targets];
        if (!matched.length) continue;
        instance.callback(
          matched.map(
            (item) => ({ target: item, contentRect: { width, height: 600 } as DOMRectReadOnly } as ResizeObserverEntry),
          ),
          {} as ResizeObserver,
        );
      }
    },
    restore() {
      globalThis.ResizeObserver = Original;
    },
  };
}

function mountWithI18n(root: ReturnType<typeof defineComponent>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });
  const app = createApp(root);
  app.use(i18n);
  app.mount(container);
  return {
    container,
    unmount() {
      app.unmount();
      container.remove();
    },
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.querySelectorAll(".el-message-box__wrapper, .el-overlay").forEach((element) => element.remove());
  leaveFrame();
  vi.resetModules();
});

describe("TwoPaneLayout", () => {
  it("shows empty placeholder in split mode, switches on narrow container, preserves aside DOM, and resets detail scroll on selection change", async () => {
    const observer = installMockResizeObserver(800);
    cleanups.push(() => observer.restore());

    const mode = ref<"split" | "switch">("split");
    const selected = ref(false);
    const creating = ref(false);
    const selectionKey = ref<string | null>(null);
    const backCalls = vi.fn();
    const openChanges: Array<{ open: boolean; overlay: boolean }> = [];

    const mounted = mountWithI18n(
      defineComponent({
        setup: () => () =>
          h(
            TwoPaneLayout,
            {
              mode: mode.value,
              selected: selected.value,
              creating: creating.value,
              selectionKey: selectionKey.value,
              onBack: backCalls,
              onDetailOpenChange: (payload: { open: boolean; overlay: boolean }) => openChanges.push(payload),
            },
            {
              aside: () => h("div", { class: "test-aside" }, [h("input", { class: "aside-filter" })]),
              header: () => h("div", { class: "test-header" }, "Detail header"),
              tabs: () => h("div", { class: "test-tabs" }, "Detail tabs"),
              default: () => h("div", { class: "test-body" }, `Detail ${selectionKey.value ?? "none"}`),
              footer: () => h("div", { class: "test-footer" }, "Detail footer"),
            },
          ),
      }),
    );
    cleanups.push(() => mounted.unmount());
    await nextTick();

    const root = mounted.container.querySelector<HTMLElement>(".sdk-two-pane")!;
    const aside = mounted.container.querySelector<HTMLElement>(".sdk-two-pane-aside")!;
    const main = mounted.container.querySelector<HTMLElement>(".sdk-two-pane-main")!;

    // Wide split mode with nothing selected: both panes shown, default empty placeholder in right pane.
    expect(root.dataset.effectiveMode).toBe("split");
    expect(aside.style.display).not.toBe("none");
    expect(main.style.display).not.toBe("none");
    expect(mounted.container.querySelector(".sdk-two-pane-empty-text")?.textContent).toBe("Select an item to view details");
    expect(mounted.container.querySelector(".sdk-two-pane-back-bar")).toBeNull();

    // Mutate aside DOM state & scrollTop to verify DOM preservation across switch.
    const filterInput = mounted.container.querySelector<HTMLInputElement>(".aside-filter")!;
    filterInput.value = "keep-me";
    aside.scrollTop = 140;

    // Select an item in split mode: detail regions render without back bar.
    selected.value = true;
    selectionKey.value = "item-1";
    await nextTick();
    expect(mounted.container.querySelector(".sdk-two-pane-empty")).toBeNull();
    expect(mounted.container.querySelector(".test-header")?.textContent).toBe("Detail header");
    expect(mounted.container.querySelector(".test-tabs")?.textContent).toBe("Detail tabs");
    expect(mounted.container.querySelector(".test-footer")?.textContent).toBe("Detail footer");
    expect(mounted.container.querySelector(".sdk-two-pane-back-bar")).toBeNull();

    // Scroll detail body down, then switch selectionKey -> detail body resets to 0, aside scroll stays intact.
    const detailBody = mounted.container.querySelector<HTMLElement>(".sdk-two-pane-detail-body")!;
    detailBody.scrollTop = 260;
    selectionKey.value = "item-2";
    await nextTick();
    expect(detailBody.scrollTop).toBe(0);
    expect(aside.scrollTop).toBe(140);

    // Shrink container to <= 680px -> automatically switches to switch mode (aside hidden, back bar visible).
    observer.resize(620, root);
    await nextTick();
    expect(root.dataset.effectiveMode).toBe("switch");
    expect(aside.style.display).toBe("none");
    expect(main.style.display).not.toBe("none");
    const backBtn = mounted.container.querySelector<HTMLButtonElement>(".sdk-two-pane-back-btn")!;
    expect(backBtn.textContent).toContain("Back to list");
    expect(openChanges.at(-1)).toEqual({ open: true, overlay: true });

    // Click back -> emits back; clearing selection returns to aside with preserved DOM & scrollTop.
    backBtn.click();
    expect(backCalls).toHaveBeenCalledTimes(1);
    selected.value = false;
    await nextTick();
    expect(aside.style.display).not.toBe("none");
    expect(main.style.display).toBe("none");
    expect(mounted.container.querySelector<HTMLInputElement>(".aside-filter")).toBe(filterInput);
    expect(mounted.container.querySelector<HTMLInputElement>(".aside-filter")?.value).toBe("keep-me");
    expect(aside.scrollTop).toBe(140);
    expect(openChanges.at(-1)).toEqual({ open: false, overlay: true });

    // Creating in switch mode opens full-width detail with back bar even when selected is false.
    creating.value = true;
    await nextTick();
    expect(aside.style.display).toBe("none");
    expect(main.style.display).not.toBe("none");
    expect(mounted.container.querySelector(".sdk-two-pane-back-btn")).not.toBeNull();

    // Explicit switch mode at wide container (800px) still stays in switch mode.
    mode.value = "switch";
    observer.resize(800, root);
    await nextTick();
    expect(root.dataset.effectiveMode).toBe("switch");
  });

  it("preserves legacy always-visible two-pane behavior when selected is omitted", async () => {
    const observer = installMockResizeObserver(800);
    cleanups.push(() => observer.restore());

    const mounted = mountWithI18n(
      defineComponent({
        setup: () => () =>
          h(TwoPaneLayout, null, {
            aside: () => h("p", { class: "legacy-aside" }, "Aside"),
            default: () => h("p", { class: "legacy-main" }, "Main"),
          }),
      }),
    );
    cleanups.push(() => mounted.unmount());
    await nextTick();

    expect(mounted.container.querySelector(".sdk-two-pane-empty")).toBeNull();
    expect(mounted.container.querySelector(".sdk-two-pane-back-bar")).toBeNull();
    expect(mounted.container.querySelector(".legacy-aside")?.textContent).toBe("Aside");
    expect(mounted.container.querySelector(".legacy-main")?.textContent).toBe("Main");
  });
});

describe("WorkbenchLayout", () => {
  it("supports three panes, collapsible aside, detail open/close with scroll reset, and mutually exclusive overlays below 880px", async () => {
    const observer = installMockResizeObserver(960);
    cleanups.push(() => observer.restore());

    const asideOpen = ref(true);
    const detailOpen = ref(false);
    const selectionKey = ref<string | null>(null);
    const closeDetail = vi.fn(() => {
      detailOpen.value = false;
    });

    const mounted = mountWithI18n(
      defineComponent({
        setup: () => () =>
          h(
            WorkbenchLayout,
            {
              asideOpen: asideOpen.value,
              detailOpen: detailOpen.value,
              selectionKey: selectionKey.value,
              "onUpdate:asideOpen": (next: boolean) => {
                asideOpen.value = next;
              },
              onCloseDetail: closeDetail,
            },
            {
              aside: () => h("div", { class: "wb-aside-content" }, "Browse tree"),
              default: () => h("div", { class: "wb-canvas-content" }, "Graph canvas"),
              "detail-header": () => h("div", { class: "wb-detail-header" }, "Node header"),
              "detail-tabs": () => h("div", { class: "wb-detail-tabs" }, "Node tabs"),
              detail: () => h("div", { class: "wb-detail-body" }, `Node ${selectionKey.value ?? ""}`),
              "detail-footer": () => h("div", { class: "wb-detail-footer" }, "Node footer"),
            },
          ),
      }),
    );
    cleanups.push(() => mounted.unmount());
    await nextTick();

    const root = mounted.container.querySelector<HTMLElement>(".sdk-workbench")!;
    const aside = mounted.container.querySelector<HTMLElement>(".sdk-workbench-aside")!;
    expect(root.dataset.narrow).toBe("false");
    expect(aside.style.display).not.toBe("none");
    expect(mounted.container.querySelector(".sdk-workbench-detail")).toBeNull();

    // Collapse aside via header button -> hidden via v-show (DOM preserved), expand toggle appears on canvas.
    mounted.container.querySelector<HTMLButtonElement>(".sdk-workbench-aside-bar .sdk-workbench-icon-btn")!.click();
    await nextTick();
    expect(asideOpen.value).toBe(false);
    expect(aside.style.display).toBe("none");
    const expandBtn = mounted.container.querySelector<HTMLButtonElement>(".sdk-workbench-aside-toggle")!;
    expandBtn.click();
    await nextTick();
    expect(asideOpen.value).toBe(true);
    expect(aside.style.display).not.toBe("none");

    // Open detail in wide mode -> all three panes coexist and changing selectionKey resets detail scrollTop.
    detailOpen.value = true;
    selectionKey.value = "node-1";
    await nextTick();
    expect(aside.style.display).not.toBe("none");
    expect(mounted.container.querySelector(".sdk-workbench-detail")).not.toBeNull();
    expect(mounted.container.querySelector(".sdk-workbench-detail")?.classList.contains("is-overlay")).toBe(false);
    const detailBody = mounted.container.querySelector<HTMLElement>(".sdk-workbench-detail-body")!;
    detailBody.scrollTop = 180;
    selectionKey.value = "node-2";
    await nextTick();
    expect(detailBody.scrollTop).toBe(0);

    // Narrow container (< 880px): detail stays open as overlay and auto-closes aside so only one overlay is open.
    observer.resize(800, root);
    await nextTick();
    expect(root.dataset.narrow).toBe("true");
    expect(asideOpen.value).toBe(false);
    expect(aside.style.display).toBe("none");
    expect(mounted.container.querySelector(".sdk-workbench-detail")?.classList.contains("is-overlay")).toBe(true);

    // Expanding aside in narrow mode auto-closes detail (mutually exclusive overlays).
    mounted.container.querySelector<HTMLButtonElement>(".sdk-workbench-aside-toggle")!.click();
    await nextTick();
    expect(asideOpen.value).toBe(true);
    expect(closeDetail).toHaveBeenCalledTimes(1);
    expect(detailOpen.value).toBe(false);
    expect(aside.style.display).not.toBe("none");
    expect(aside.classList.contains("is-overlay")).toBe(true);
    expect(mounted.container.querySelector(".sdk-workbench-detail")).toBeNull();

    // Re-opening detail in narrow mode auto-closes aside again.
    detailOpen.value = true;
    await nextTick();
    expect(asideOpen.value).toBe(false);
    expect(aside.style.display).toBe("none");
    expect(mounted.container.querySelector(".sdk-workbench-detail")?.classList.contains("is-overlay")).toBe(true);
  });
});

describe("ObjectHeader", () => {
  it("renders standalone heading, status tone, and #actions slot outside a projection", async () => {
    const mounted = mountWithI18n(
      defineComponent({
        setup: () => () =>
          h(
            ObjectHeader,
            {
              title: "New Relation Type",
              subtitle: "relation.new",
              status: "Draft",
              statusTone: "warning",
            },
            {
              actions: () => h("button", { class: "custom-action", type: "button" }, "Cancel"),
            },
          ),
      }),
    );
    cleanups.push(() => mounted.unmount());
    await nextTick();

    expect(mounted.container.querySelector(".sdk-object-header-title")?.textContent).toBe("New Relation Type");
    expect(mounted.container.querySelector(".sdk-object-header-subtitle")?.textContent).toBe("relation.new");
    const status = mounted.container.querySelector<HTMLElement>(".sdk-object-header-status")!;
    expect(status.textContent?.trim()).toBe("Draft");
    expect(status.dataset.tone).toBe("warning");
    expect(mounted.container.querySelector(".custom-action")?.textContent).toBe("Cancel");
  });

  it("reads bound record fields/tones, exposes at most 2 normal operations inline, puts overflow + delete last in More, and dispatches via platform coordinator", async () => {
    const APPLICATION = "app-header-test";
    const entryType = { kind: "object", objectType: BUSINESS_KNOWLEDGE } as const;
    const headerProjection: ProductProjection = {
      domainId: "domain-1",
      ownerId: "owner-1",
      revision: 1,
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      editable: false,
      visibility: "domain",
      id: "knowledge-header",
      name: "Knowledge header",
      description: "",
      componentId: "@ontomato/sdk:ObjectHeader",
      inputs: { entry: entryType },
      outputs: {},
      config: {
        subtitleField: "code",
        statusField: "status",
        primaryOperation: "publish",
        dangerOperations: ["archive"],
      },
      data: {
        record: {
          source: { object: { input: "entry" } },
          read: "record",
          params: {},
        },
      },
      operations: {
        publish: { operation: { kind: "PlatformOperation", id: "knowledge.publish" }, target: { input: "entry" } },
        delete: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE }, target: { input: "entry" } },
        duplicate: { operation: { kind: "PlatformOperation", id: "knowledge.duplicate" }, target: { input: "entry" } },
        export: { operation: { kind: "PlatformOperation", id: EXPORT_SKILL }, target: { input: "entry" } },
        archive: { operation: { kind: "PlatformOperation", id: "knowledge.archive" }, target: { input: "entry" } },
      },
    };

    const manifest = definePanel({
      state: { selected: { type: entryType } },
      members: {
        header: { target: { projectionId: "knowledge-header" }, inputs: { entry: { state: "selected" } } },
      },
      commands: {},
    });
    const panel = panelRecord("panel-object-header", "Object header test", manifest);
    panel.content.html = `<div id="app"><Projection slot="header" /></div>`;
    const use = panelUse("use-header", "object-header", panel.id, `/applications/${APPLICATION}/header`);

    const opDescriptors: Record<string, PanelOperationDescriptor> = {
      publish: {
        kind: "action", handlerRef: "knowledge.publish", label: "Publish", effect: "write",
        target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
      },
      delete: {
        kind: "action", handlerRef: DELETE_KNOWLEDGE, label: "Delete", effect: "write",
        target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
        inspectImpact: { handlerRef: "knowledge.delete.impact" },
      },
      duplicate: {
        kind: "action", handlerRef: "knowledge.duplicate", label: "Duplicate", effect: "write",
        target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
      },
      export: {
        kind: "action", handlerRef: EXPORT_SKILL, label: "Export", effect: "read",
        target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
      },
      archive: {
        kind: "action", handlerRef: "knowledge.archive", label: "Archive", effect: "write",
        target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
      },
    };

    const dispatched: string[] = [];
    const intents = new Map<string, Record<string, unknown>>();
    const hostChanges: unknown[] = [];

    installPlatform((request: Sent): Response => {
      if (request.path === "/api/product-projections/knowledge-header") {
        return Response.json({ projection: headerProjection });
      }
      if (request.method === "POST" && request.path === "/api/product-panels/read") {
        const body = request.body as { operations?: boolean; dataName?: string };
        if (body.operations) return Response.json({ status: "ready", value: opDescriptors });
        if (body.dataName === "record") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: "k-1",
              label: "Shipping Policy",
              fields: { code: "rel.shipping_policy", status: "Active" },
              tones: { status: "success" },
            },
          });
        }
      }
      if (request.method === "POST" && request.path === "/api/panel-operations/intents") {
        const body = request.body as { operationId: string };
        const intentId = randomId();
        const preparation = {
          intentId,
          operationId: body.operationId,
          label: "Delete",
          confirmation: {
            kind: "impact",
            impact: {
              summary: "This removes Shipping Policy.",
              total: 1,
              objects: [{ target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, label: "Shipping Policy" }],
            },
          },
        };
        intents.set(intentId, preparation);
        return Response.json(preparation);
      }
      const readIntent = /^\/api\/panel-operation-intents\/([^/]+)$/.exec(request.path);
      if (readIntent) return Response.json(intents.get(readIntent[1]!));
      const dispatchMatch = /^\/api\/panel-operations\/intents\/(.+)\/dispatch$/.exec(request.path);
      if (request.method === "POST" && dispatchMatch) {
        const saved = intents.get(dispatchMatch[1]!) as { intentId: string; operationId: string };
        dispatched.push(saved.operationId);
        return Response.json({
          kind: "dispatched",
          intentId: saved.intentId,
          outcome: {
            kind: "success",
            message: "Deleted Shipping Policy",
            data: {},
            affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [BUSINESS_KNOWLEDGE] },
          },
        });
      }
      return Response.json({ error: `unexpected ${request.method} ${request.path}` }, { status: 404 });
    });

    const frame = panelFrame();
    const host = platformPanelHost(APPLICATION, use, (change) => hostChanges.push(change));
    host.frame(frame, registered(APPLICATION, use, panel), true);
    writePanelDocument(registered(APPLICATION, use, panel), `/applications/${APPLICATION}/header`, {
      selected: { className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" },
    });
    inside(frame);

    const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
    await mountPanel({});

    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-header-title")?.textContent).toBe("Shipping Policy");
    });
    expect(document.querySelector(".sdk-object-header-subtitle")?.textContent).toBe("rel.shipping_policy");
    const badge = document.querySelector<HTMLElement>(".sdk-object-header-status")!;
    expect(badge.textContent?.trim()).toBe("Active");
    expect(badge.dataset.tone).toBe("success");

    // Inline buttons: at most 2 normal operations (Publish + Duplicate), never Delete/Archive.
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".sdk-object-header-actions .sdk-operation-button button").length).toBe(2);
    });
    const inlineLabels = [...document.querySelectorAll(".sdk-object-header-actions .sdk-operation-button button")]
      .map((btn) => btn.textContent?.trim());
    expect(inlineLabels).toEqual(["Publish", "Duplicate"]);

    // Open More menu: normal overflow ("Export") comes first, separator, then danger items ("Delete", "Archive") last.
    const moreBtn = document.querySelector<HTMLButtonElement>(".sdk-object-header-more-btn")!;
    moreBtn.click();
    await nextTick();
    const menuItems = [...document.querySelectorAll<HTMLButtonElement>(".sdk-object-header-more-item")];
    expect(menuItems.map((el) => el.dataset.operation)).toEqual(["export", "delete", "archive"]);
    expect(menuItems.map((el) => el.dataset.danger)).toEqual([undefined, "true", "true"]);
    expect(document.querySelector(".sdk-object-header-more-divider")).not.toBeNull();

    // Clicking Delete in More triggers the host confirmation dialog & single dispatch upon confirm.
    const deleteItem = menuItems.find((el) => el.dataset.operation === "delete")!;
    deleteItem.click();
    const dialog = await vi.waitFor(() => {
      const box = document.querySelector<HTMLElement>(".el-message-box");
      if (!box) throw new Error("Waiting for confirmation dialog");
      return box;
    });
    expect(dialog.textContent).toContain("This removes Shipping Policy.");
    const confirmBtn = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (btn) => btn.textContent?.trim() === "Delete",
    )!;
    confirmBtn.click();
    await vi.waitFor(() => expect(dispatched).toEqual(["header.delete"]));
    expect(hostChanges).toHaveLength(1);
  });
});
