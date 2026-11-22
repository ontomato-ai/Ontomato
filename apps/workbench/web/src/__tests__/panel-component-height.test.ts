/* eslint-disable vue/one-component-per-file -- test doubles define inline stubs and harness shells */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection, ProductProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  BUSINESS_KNOWLEDGE,
  DASHBOARD_CARD,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  RELATIONSHIP,
  SCHEDULED_TASK,
  USER,
} from "@ontomato/contracts/platform-object-types";
import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { panelContextKey, type PanelContext } from "../../../../../packages/apps-sdk/src/panel/context";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import FrameProjection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";
import { components as sdkCatalogue } from "../../../../../packages/apps-sdk/src/catalogue";
import { directRun, noOperations } from "./panel-frame";

/*
 * Regression tests for the official SDK component height convention:
 * - Member containers (<Projection> and <CurrentEntry>) forward placement class/style onto [data-member] without
 *   configuring the drawn component, and pass definite heights through without collapsing auto-height layouts.
 * - Graph components (ObjectGraph/ObjectGraphCanvas, OntologyGraph) fill definite boxes, fall back to a 420px minimum
 *   canvas height when no height is given, and re-fit cleanly on ResizeObserver size updates.
 * - ObjectList, ObjectForm, MetricChart, ObjectTree, ObjectTextReader, ObjectRelations, ObjectSummary and TwoPaneLayout
 *   each fill definite boxes with internal scrolling (or default height for charts) and flow naturally when height is auto.
 */

const graphRecorder = {
  fitCalls: 0,
  emitResized: null as ((width: number, height: number) => void) | null,
};

const chartRecorder = {
  receivedHeight: undefined as string | number | undefined,
};

vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>(
    "@ontomato/foundation-ui/graph/g6",
  );
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true },
      nodes: { type: Array, required: true },
      edges: { type: Array, default: () => [] },
      selected: { type: Array, default: () => [] },
      selectedEdges: { type: Array, default: () => [] },
      selection: { type: String, default: "single" },
      layout: { type: Object, default: () => ({ type: "preset" }) },
      categories: { type: Array, default: () => [] },
      nodeSize: { type: Number, default: undefined },
      labelSize: { type: Number, default: undefined },
      readableLabels: { type: Boolean, default: false },
      editable: { type: Boolean, default: false },
      maxHeight: { type: Number, default: undefined },
    },
    emits: ["update:selected", "update:selectedEdges", "blank", "connect", "move", "viewport", "resized"],
    setup(_props, { emit, expose }) {
      graphRecorder.emitResized = (width, height) => emit("resized", width, height);
      expose({
        fit: async () => {
          graphRecorder.fitCalls += 1;
          return true;
        },
        focus: async () => {},
        zoomBy: async () => {},
        zoomTo: async () => {},
        relayout: async () => {},
        exportImage: async () => new Blob(),
      });
      return () => h("div", { class: "g6-graph-canvas-stub" });
    },
  });
  return { ...actual, G6GraphCanvas };
});

vi.mock("@ontomato/foundation-ui/chart", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/chart")>(
    "@ontomato/foundation-ui/chart",
  );
  const MetricChart = defineComponent({
    name: "MetricChart",
    props: {
      file: { type: [Object, String, Array, Number, Boolean], default: null },
      metric: { type: Object, required: true },
      height: { type: [Number, String], default: undefined },
      undated: { type: String, default: undefined },
      empty: { type: String, default: undefined },
    },
    setup(props) {
      chartRecorder.receivedHeight = props.height;
      return () => h("div", { class: "metric-chart-stub", "data-chart-height": String(props.height ?? "") });
    },
  });
  return { ...actual, MetricChart };
});

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const readRepoFile = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), "utf8");
const meta = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const disposers: (() => void)[] = [];

beforeEach(() => {
  graphRecorder.fitCalls = 0;
  graphRecorder.emitResized = null;
  chartRecorder.receivedHeight = undefined;
});

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mountDirect(
  manifest: DirectPanelManifest,
  projections: Record<string, ProductProjection>,
  read: (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse> | ProductPanelReadResponse,
  template: string,
  extra?: {
    currentEntry?: { place: (target: HTMLElement) => { dispose(): void } };
    setup?: () => Record<string, unknown>;
  },
) {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mountPromise = new Promise<DirectPanelMount>((resolveMount) => {
    mounted = resolveMount;
  });
  const module = panelModuleFor({
    mounted,
    element,
    template,
    install: (app) => {
      app.use(ElementPlus);
      app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }));
    },
    manifest,
    run: directRun({
      pageKey: "height-test",
      url: () => "/height-test",
      label: () => "Height Test",
      initial: {},
      ...(extra?.currentEntry
        ? {
            currentEntry: {
              entry: ref({
                applicationId: "app-1",
                useId: "use-1",
                pageKey: "entry-1",
                panelId: "panel-1",
                path: "/applications/app-1/entry-1",
              }),
              menu: ref({ groups: [], panelUses: [] }),
              place: extra.currentEntry.place,
            },
          }
        : {}),
      failed: (reason) => {
        throw reason;
      },
    }),
    messages: {},
    locale: ref("en"),
    defaultLocale: "en",
    requests: {
      request: async (path: string) => {
        const id = path.replace(/^\/product-projections\//, "");
        const projection = projections[id];
        if (!projection) throw new Error(`No projection ${id}`);
        return Response.json({ projection });
      },
    },
    use: { applicationId: "app-height", useId: "height" },
    expandPageComposer: noOperations.expandPageComposer,
    confirmOperation: noOperations.confirmOperation,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    read: async (request) => {
      if (request.operations) return { status: "ready", value: {} as never };
      return await read(request);
    },
  });
  const mountedPanel = module.mountPanel({ setup: extra?.setup ?? (() => ({})) });
  disposers.push(() => {
    void mountPromise.then((m) => m.dispose());
  });
  return { element, mountPromise, mountedPanel };
}

it("forwards reactive class and style on <Projection> and <CurrentEntry> onto [data-member].sdk-panel-member without leaking non-event attrs", async () => {
  const listProj: DirectProjection = {
    ...meta,
    id: "list-proj",
    name: "Knowledge",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {},
    outputs: {},
    config: {},
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} },
    },
  };
  const manifest = definePanel({
    state: {},
    members: {
      list: { target: { projectionId: listProj.id } },
      content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } },
    },
    commands: {},
  });
  const active = ref(false);
  const nestedEl = document.createElement("div");
  nestedEl.dataset.panelInstance = "nested-1";
  nestedEl.className = "nested-root";

  const { element } = mountDirect(
    manifest,
    { [listProj.id]: listProj },
    () => ({ status: "ready", value: { rows: [{ primaryKey: "k-1", label: "Row 1", fields: {} }], total: 1 } as never }),
    `<div class="shell">
      <Projection slot="list" :class="['pane-list', { 'is-tall': active }]" :style="{ height: active ? '480px' : '100%' }" pageSize="999" />
      <CurrentEntry member="content" class="pane-entry" style="flex: 1; min-height: 0;" />
    </div>`,
    {
      currentEntry: {
        place(target) {
          target.append(nestedEl);
          return { dispose: () => nestedEl.remove() };
        },
      },
      setup: () => ({ active }),
    },
  );

  await vi.waitFor(() => expect(element.querySelector('[data-member="list"] .sdk-object-list')).not.toBeNull(), { timeout: 4000 });
  const listWrap = element.querySelector<HTMLElement>('[data-member="list"]')!;
  expect(listWrap.classList.contains("sdk-panel-member")).toBe(true);
  expect(listWrap.classList.contains("pane-list")).toBe(true);
  expect(listWrap.classList.contains("is-tall")).toBe(false);
  expect(listWrap.style.height).toBe("100%");
  // Non-event authoring attributes do not leak onto the wrapper or drawn component.
  expect(listWrap.getAttribute("pageSize")).toBeNull();
  expect(listWrap.querySelector(".sdk-object-list")?.getAttribute("pageSize")).toBeNull();

  active.value = true;
  await nextTick();
  expect(listWrap.classList.contains("is-tall")).toBe(true);
  expect(listWrap.style.height).toBe("480px");

  await vi.waitFor(() => expect(element.querySelector('[data-member="content"] .sdk-panel-member-nested .sdk-current-entry .nested-root')).not.toBeNull(), { timeout: 4000 });
  const entryWrap = element.querySelector<HTMLElement>('[data-member="content"]')!;
  expect(entryWrap.classList.contains("sdk-panel-member")).toBe(true);
  expect(entryWrap.classList.contains("pane-entry")).toBe(true);
  expect(["0", "0px"]).toContain(entryWrap.style.minHeight);
});

it("wraps frame <Projection> in .sdk-panel-member and forwards class and style", async () => {
  const summaryProj: DirectProjection = {
    ...meta,
    id: "task-summary",
    name: "Task",
    componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
    outputs: {},
    config: {},
    data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  };
  const panel = definePanel({
    state: { selected: { type: { kind: "object", objectType: SCHEDULED_TASK } } },
    members: { summary: { target: { projectionId: summaryProj.id }, inputs: { task: { state: "selected" } } } },
    commands: {},
  });
  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "frame-height",
    url: () => "/frame-height",
    label: () => "Frame Height",
    initial: { selected: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
    operations: noOperations.operations,
    confirmOperation: noOperations.confirmOperation,
    recordDraftCreated: async () => {},
    readProjection: async () => summaryProj as never,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(defineComponent({
    setup: () => {
      provide(panelContextKey, {
        panel: { content: { html: "", module: "" }, manifest: panel },
        manifest: panel,
        instance,
        projection: async () => summaryProj,
        resources: async () => {},
        projectionsChanged: () => () => {},
        t: (key: string) => key,
        expandPageComposer: noOperations.expandPageComposer,
        navigate: noOperations.navigate,
        readPanelData: async (req: PanelMemberReadRequest) =>
          req.operations
            ? { status: "ready", value: {} as never }
            : { status: "ready", value: { primaryKey: "t-1", label: "Nightly", fields: { schedule: "0 2 * * *" } } as never },
      } as unknown as PanelContext);
      return () => h(FrameProjection, { slot: "summary", class: "frame-slot", style: { height: "300px" } });
    },
  }));
  app.use(ElementPlus);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }));
  app.mount(host);
  disposers.push(() => app.unmount());

  await vi.waitFor(() => expect(host.querySelector(".sdk-object-summary")).not.toBeNull(), { timeout: 4000 });
  const wrap = host.querySelector<HTMLElement>('[data-member="summary"]')!;
  expect(wrap.classList.contains("sdk-panel-member")).toBe(true);
  expect(wrap.classList.contains("frame-slot")).toBe(true);
  expect(wrap.style.height).toBe("300px");
});

it("re-measures and re-fits ObjectGraph and OntologyGraph when their container size settles (including from 0x0)", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 0, height: 0 } as DOMRect);

  const objectGraphProj: DirectProjection = {
    ...meta,
    id: "obj-graph",
    name: "Objects",
    componentId: "@ontomato/sdk:ObjectGraph",
    inputs: {},
    outputs: {},
    config: { edgeEnds: { source: "/source", target: "/target" } },
    data: {
      nodes: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
      edges: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} },
    },
  };
  const ontologyGraphProj: DirectProjection = {
    ...meta,
    id: "onto-graph",
    name: "Ontology",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {},
    outputs: {},
    config: { mode: "type" },
    data: {
      schema: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "schema", params: {} },
      counts: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "counts", params: {} },
      neighbors: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "neighbors", params: {} },
    },
  };

  const manifest = definePanel({
    state: {},
    members: {
      obj: { target: { projectionId: objectGraphProj.id } },
      onto: { target: { projectionId: ontologyGraphProj.id } },
    },
    commands: {},
  });

  const { element } = mountDirect(
    manifest,
    { [objectGraphProj.id]: objectGraphProj, [ontologyGraphProj.id]: ontologyGraphProj },
    (req) => {
      if (req.dataName === "nodes") {
        return {
          status: "ready",
          value: [
            { primaryKey: "n1", label: "Order", fields: {} },
            { primaryKey: "n2", label: "Customer", fields: {} },
          ] as never,
        };
      }
      if (req.dataName === "edges") {
        return {
          status: "ready",
          value: [{ primaryKey: "e1", label: "belongsTo", fields: { source: "n1", target: "n2" } }] as never,
        };
      }
      if (req.dataName === "schema") {
        return {
          status: "ready",
          value: {
            objectTypes: [{ className: USER, name: "User", layer: "governance" }],
            relationKinds: [],
          } as never,
        };
      }
      if (req.dataName === "counts") {
        return { status: "ready", value: { counts: [{ className: USER, count: 1, status: "ok" }] } as never };
      }
      return { status: "ready", value: { groups: [] } as never };
    },
    `<div class="graphs">
      <Projection slot="obj" class="definite-box" style="height: 600px" />
      <Projection slot="onto" class="auto-box" />
    </div>`,
  );

  // Flush microtasks for async projection + data loading.
  await vi.waitFor(() => expect(element.querySelector('[data-member="obj"] .g6-graph-canvas-stub')).not.toBeNull(), { timeout: 4000 });
  await vi.waitFor(() => expect(element.querySelector('[data-member="onto"] .g6-graph-canvas-stub')).not.toBeNull(), { timeout: 4000 });

  const initialFits = graphRecorder.fitCalls;
  expect(initialFits).toBeGreaterThanOrEqual(2);

  // Simulate container gaining real dimensions after initial 0x0 mount.
  vi.useFakeTimers();
  graphRecorder.emitResized?.(900, 420);
  await vi.advanceTimersByTimeAsync(250);
  expect(graphRecorder.fitCalls).toBeGreaterThan(initialFits);
});

it("passes height='100%' from SDK MetricChart to the inner chart view instead of viewport units", async () => {
  const card = { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey({ dashboardId: "b", cardId: "c" }) } } };
  const chartProj: ProductProjection = {
    ...meta,
    id: "chart-1",
    name: "Sales",
    componentId: "@ontomato/sdk:MetricChart",
    metricId: "m-sales",
    inputs: {},
    outputs: {},
    config: {},
    data: {
      template: { source: card, read: "chartTemplate", params: {} },
      result: { source: card, read: "result", params: {} },
    },
  };
  const manifest = definePanel({
    state: {},
    members: { chart: { target: { projectionId: chartProj.id } } },
    commands: {},
  });
  const { element } = mountDirect(
    manifest,
    { [chartProj.id]: chartProj },
    (req) =>
      req.dataName === "template"
        ? {
            status: "ready",
            value: {
              chartFile: {
                name: "sales.chart.json",
                content: {
                  dataset: [{ id: "metric", dimensions: ["label", "value"], source: [] }],
                  series: [{ id: "s1", type: "bar", datasetId: "metric", encode: { x: "label", y: "value" } }],
                  ontomato: {},
                },
              },
              parameters: {},
            } as never,
          }
        : {
            status: "ready",
            value: {
              columns: [],
              rows: [],
              truncation: null,
            } as never,
          },
    `<Projection slot="chart" style="height: 480px" />`,
  );

  await vi.waitFor(() => expect(element.querySelector(".metric-chart-stub")).not.toBeNull(), { timeout: 4000 });
  expect(chartRecorder.receivedHeight).toBe("100%");
  expect(element.querySelector(".metric-chart-stub")?.getAttribute("data-chart-height")).toBe("100%");
});

it("renders ObjectForm with a scrollable body and sibling pinned actions bar", async () => {
  const formProj: DirectProjection = {
    ...meta,
    id: "form-proj",
    name: "Task form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
    outputs: {},
    config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: {} } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
  };
  const manifest = definePanel({
    state: { selected: { type: { kind: "object", objectType: SCHEDULED_TASK } } },
    members: { form: { target: { projectionId: formProj.id }, inputs: { task: { state: "selected" } } } },
    commands: {},
  });
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "form-height",
    url: () => "/form-height",
    label: () => "Form Height",
    initial: { selected: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
    text: createPanelText({}, ref("en"), "en"),
    operations: noOperations.operations,
    confirmOperation: noOperations.confirmOperation,
    recordDraftCreated: async () => {},
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    readProjection: async () => formProj,
    readComponentPackage: async () => {
      throw new Error("Unused in test");
    },
    read: async (req) => {
      if (req.operations) {
        return {
          status: "ready",
          value: {
            save: {
              kind: "form.save",
              handlerRef: `${SCHEDULED_TASK}.save`,
              label: "Save",
              effect: "write",
              target: { source: "input", input: "task" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          } as never,
        };
      }
      return {
        status: "ready",
        value: {
          fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false }],
          values: { name: "Nightly" },
          revision: 1,
          errors: [],
          save: { method: "PUT", path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
        } as never,
      };
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(defineComponent({
    setup: () => () => h("div", { class: "sdk-panel-member", style: { height: "360px" } }, [h(PanelMember, { instance, member: "form" })]),
  }));
  app.use(ElementPlus);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }));
  app.mount(host);
  disposers.push(() => app.unmount());

  await vi.waitFor(() => expect(host.querySelector(".sdk-owner-form-body")).not.toBeNull(), { timeout: 4000 });
  const inner = host.querySelector(".sdk-owner-form-inner")!;
  const body = inner.querySelector(".sdk-owner-form-body")!;
  const actions = inner.querySelector(".sdk-owner-form-actions")!;
  expect(body.querySelector('[data-field="/name"]')).not.toBeNull();
  expect(actions.parentElement).toBe(inner);
  expect(body.contains(actions)).toBe(false);
});

it("declares the height-fill and default-height CSS contract across member wrappers, official components, and catalogue descriptions", () => {
  const memberCss = readRepoFile("packages/apps-sdk/src/panel/panel-member.css");
  expect(memberCss).toContain(":where(.sdk-panel-member)");
  expect(memberCss).toContain("display: flex;");
  expect(memberCss).toContain("min-height: 0;");
  expect(memberCss).toContain(":where(.sdk-panel-member-nested)");
  expect(memberCss).toContain(":where(.sdk-panel-member-nested > *)");
  expect(memberCss).toContain(":where(.sdk-current-entry)");

  const objectGraphCss = readRepoFile("packages/apps-sdk/src/base/ObjectGraphCanvas.vue");
  expect(objectGraphCss).toMatch(/\.sdk-object-graph-canvas\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*420px;/s);
  expect(objectGraphCss).toMatch(/\.sdk-object-graph-canvas\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);

  const ontologyGraphCss = readRepoFile("packages/apps-sdk/src/base/OntologyGraph.vue");
  expect(ontologyGraphCss).toMatch(/\.sdk-ontology-graph\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*100%;/s);
  expect(ontologyGraphCss).toMatch(/\.sdk-ontology-graph-frame\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*420px;/s);

  const objectListCss = readRepoFile("packages/apps-sdk/src/base/ObjectList.vue");
  expect(objectListCss).toMatch(/\.sdk-object-list\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*height:\s*100%;/s);
  expect(objectListCss).toMatch(/\.sdk-object-list-table-wrap\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s);
  expect(objectListCss).toMatch(/\.sdk-object-list-items\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  expect(objectListCss).toMatch(/\.sdk-object-list-row\s*\{[^}]*flex:\s*0 0 auto;/s);
  expect(objectListCss).toMatch(/\.sdk-object-list-cards\s*\{[^}]*align-content:\s*start;[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  expect(objectListCss).toMatch(/\.sdk-object-list-pagination\s*\{[^}]*flex:\s*0 0 auto;/s);

  const metricChartCss = readRepoFile("packages/apps-sdk/src/base/MetricChart.vue");
  expect(metricChartCss).toMatch(/\.sdk-metric-chart\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*320px;/s);
  expect(metricChartCss).not.toMatch(/\d+vh\b/);

  const objectFormCss = readRepoFile("packages/apps-sdk/src/base/ObjectForm.vue");
  expect(objectFormCss).toMatch(/\.sdk-owner-form\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
  expect(objectFormCss).toMatch(/\.sdk-owner-form-body\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  expect(objectFormCss).toMatch(/\.sdk-owner-form-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*position:\s*sticky;/s);

  for (const [file, cls] of [
    ["packages/apps-sdk/src/base/ObjectTree.vue", "sdk-object-tree"],
    ["packages/apps-sdk/src/base/ObjectTextReader.vue", "sdk-object-text-reader"],
    ["packages/apps-sdk/src/base/ObjectSummary.vue", "sdk-object-summary"],
  ] as const) {
    const content = readRepoFile(file);
    expect(content).toMatch(new RegExp(`\\.${cls}\\s*\\{[^}]*height:\\s*100%;[^}]*min-height:\\s*0;[^}]*overflow-y:\\s*auto;`, "s"));
  }

  const relationsCss = readRepoFile("packages/apps-sdk/src/base/ObjectRelations.vue");
  expect(relationsCss).toMatch(/\.sdk-object-relations\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
  expect(relationsCss).toMatch(/\.sdk-object-relations-groups\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);

  const twoPaneCss = readRepoFile("packages/apps-sdk/src/base/TwoPaneLayout.vue");
  expect(twoPaneCss).toMatch(/\.sdk-two-pane\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
  expect(twoPaneCss).toMatch(/\.sdk-two-pane-block\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);/s);
  expect(twoPaneCss).toMatch(/@container\s*\(max-width:\s*640px\)\s*\{[^}]*grid-template-rows:\s*auto;/s);

  for (const file of [
    "packages/apps-sdk/src/base/SegmentedControl.vue",
    "packages/apps-sdk/src/base/ConversationEntry.vue",
    "packages/apps-sdk/src/base/FileUploadControl.vue",
  ]) {
    expect(readRepoFile(file)).toContain("align-self: flex-start;");
  }

  const objectGraphMeta = sdkCatalogue.find((entry) => entry.componentId === "ObjectGraph");
  expect(objectGraphMeta?.meaning).not.toContain("nothing is drawn");
  expect(objectGraphMeta?.meaning).toContain("420px");
  const metricChartMeta = sdkCatalogue.find((entry) => entry.componentId === "MetricChart");
  expect(metricChartMeta?.meaning).toContain("320px");
});
