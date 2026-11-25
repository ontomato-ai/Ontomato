import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { GraphCanvasEdge, GraphCanvasNode } from "@ontomato/foundation-ui/graph/g6";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { parseCollectionRecords } from "../../../../../packages/apps-sdk/src/base/collection-data";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const canvas = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  emit: null as null | ((event: string, ...args: unknown[]) => void),
};

vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>("@ontomato/foundation-ui/graph/g6");
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true },
      nodes: { type: Array, required: true },
      edges: { type: Array, default: () => [] },
    },
    emits: ["update:selected", "update:selected-edges", "activate", "blank", "connect", "move", "viewport", "progress", "resized"],
    setup(props, { emit, expose }) {
      canvas.emit = (event, ...args) => emit(event as never, ...args);
      expose({
        zoomBy: async () => {},
        zoomTo: async () => {},
        fit: async () => true,
        fitView: async () => true,
        focus: async () => {},
        focusNode: async () => {},
        exportPng: async () => "data:image/png;base64,AA==",
        nodeViewportBox: () => null,
      });
      return () => {
        canvas.nodes = props.nodes as readonly GraphCanvasNode[];
        canvas.edges = props.edges as readonly GraphCanvasEdge[];
        return h("div", { class: "mock-g6-canvas", "data-node-count": String(canvas.nodes.length), "data-edge-count": String(canvas.edges.length) });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const base = {
  domainId: "univ_demo",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

afterEach(() => {
  document.body.innerHTML = "";
  canvas.nodes = [];
  canvas.edges = [];
  canvas.emit = null;
  Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
});

function mountMember(
  projection: DirectProjection,
  manifest: ReturnType<typeof definePanel>,
  read: (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse>,
  initial: Record<string, RuntimeJsonValue> = {},
) {
  const reads: PanelMemberReadRequest[] = [];
  const memberKey = Object.keys(manifest.members)[0]!;
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "p",
    url: () => "/p",
    label: () => "P",
    initial,
    text: createPanelText({}, { value: "en" } as never, "en"),
    ...noOperations,
    readProjection: async () => projection,
    read: async (request) => {
      if (request.operations) return { status: "ready", value: {} as never };
      reads.push(request);
      return read(request);
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: memberKey }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { instance, element, reads };
}

it("parseCollectionRecords normalizes panelRecordList and panelRecordQuery coverage accurately", () => {
  const row = (id: string) => ({ className: "Department", primaryKey: id, label: `Dept ${id}`, fields: {} });
  expect(parseCollectionRecords([row("d-1"), row("d-2")]).coverage).toEqual({
    complete: true, truncated: false, loaded: 2, total: 2, diagnostics: [],
  });
  expect(parseCollectionRecords({ rows: [row("d-1")], total: 1, hasMore: false }).coverage).toEqual({
    complete: true, truncated: false, loaded: 1, total: 1, diagnostics: [],
  });
  expect(parseCollectionRecords({ rows: [row("d-1")], total: 50, diagnostics: ["1 item hidden"] }).coverage).toEqual({
    complete: false, truncated: true, loaded: 1, total: 50, diagnostics: ["1 item hidden"],
  });
  expect(parseCollectionRecords({ rows: [row("d-1")], hasMore: true }).coverage).toEqual({
    complete: false, truncated: true, loaded: 1, total: null, diagnostics: [],
  });
  expect(parseCollectionRecords({ rows: [row("d-1")], nextCursor: "c1" }).coverage).toEqual({
    complete: false, truncated: true, loaded: 1, total: null, diagnostics: [],
  });
  expect(parseCollectionRecords({ rows: [], total: 0 }).coverage).toEqual({
    complete: true, truncated: false, loaded: 0, total: 0, diagnostics: [],
  });
});

it("ObjectTree consumes customer ObjectType.query with single-shot cap 1000, selects object ref, shows truncation notice, and keeps search local", async () => {
  const projection: DirectProjection = {
    ...base,
    id: "dept-tree",
    name: "Departments",
    componentId: "@ontomato/sdk:ObjectTree",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: "Department" }, search: { kind: "scalar", type: "string" } },
    config: { parentField: "parentId", searchable: true },
    data: {
      rows: { source: { type: { kind: "ObjectType", id: "Department" } }, read: "query", params: {} },
    },
  };
  const manifest = definePanel({
    state: {
      dept: { type: { kind: "object", objectType: "Department" } },
      search: { type: { kind: "scalar", type: "string" } },
    },
    members: {
      tree: {
        target: { projectionId: projection.id },
        outputs: { selected: { state: "dept" }, search: { state: "search" } },
      },
    },
  });

  const { instance, element, reads } = mountMember(projection, manifest, async () => ({
    status: "ready",
    value: {
      rows: [
        { className: "Department", primaryKey: "d-root", label: "Engineering", fields: {} },
        { className: "Department", primaryKey: "d-child", label: "Platform", fields: { parentId: "d-root" } },
      ],
      total: 1200,
    } as never,
  }));

  await vi.waitFor(() => {
    expect(element.querySelector("[data-tree-coverage='partial']")?.textContent).toContain("2");
    expect(element.querySelector("[data-tree-coverage='partial']")?.textContent).toContain("1200");
  });

  // Single request at customer cap 1000 without paging loop.
  expect(reads).toHaveLength(1);
  expect(reads[0]!.runtimeParams).toEqual({ page: { number: 1, size: 1000 }, size: 1000 });

  // Clicking a node writes full object reference { className, primaryKey }.
  const childBtn = element.querySelector<HTMLElement>("[role='treeitem'][data-key='d-child'] .fui-path-tree-body");
  expect(childBtn).toBeTruthy();
  childBtn!.click();
  await vi.waitFor(() => {
    expect(instance.state.values.value.dept).toEqual({ className: "Department", primaryKey: "d-child" });
  });

  // Updating local search does NOT send a backend query with search parameter (prevents breaking tree parent chains).
  instance.state.set("search", "Platform");
  await new Promise((r) => setTimeout(r, 20));
  expect(reads).toHaveLength(1);
});

it("ObjectTree respects author-bound size parameter and maps empty panelRecordQuery to empty state", async () => {
  const projection: DirectProjection = {
    ...base,
    id: "dept-tree-paged",
    name: "Departments",
    componentId: "@ontomato/sdk:ObjectTree",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: "Department" } },
    config: { parentField: "parentId" },
    data: {
      rows: {
        source: { type: { kind: "ObjectType", id: "Department" } },
        read: "query",
        params: { size: { literal: 25 } },
      },
    },
  };
  const manifest = definePanel({
    state: { dept: { type: { kind: "object", objectType: "Department" } } },
    members: {
      tree: {
        target: { projectionId: projection.id },
        outputs: { selected: { state: "dept" } },
      },
    },
  });

  const { element, reads } = mountMember(projection, manifest, async () => ({
    status: "ready",
    value: { rows: [], total: 0 } as never,
  }));

  await vi.waitFor(() => {
    expect(reads).toHaveLength(1);
    expect(element.textContent).toContain(publicEn.platform.dataEmpty);
  });
  // Must NOT override author's literal size with runtimeParams.
  expect(reads[0]!.runtimeParams).toBeUndefined();
  expect(element.querySelector("[data-tree-coverage='partial']")).toBeNull();
});

it("ObjectGraph consumes customer ObjectType.query for nodes & edges, omits dangling edges when nodes truncated, and reports partialNotice on highlights", async () => {
  Element.prototype.getBoundingClientRect = () => ({ width: 800, height: 500, top: 0, left: 0, bottom: 500, right: 800, x: 0, y: 0, toJSON: () => ({}) });

  const projection: DirectProjection = {
    ...base,
    id: "course-graph",
    name: "Course Graph",
    componentId: "@ontomato/sdk:ObjectGraph",
    inputs: {
      pathFrom: { kind: "object", objectType: "Course" },
      pathTo: { kind: "object", objectType: "Course" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "Course" },
      selectedEdge: { kind: "object", objectType: "CourseLink" },
    },
    config: { edgeEnds: { source: "/fromId", target: "/toId" } },
    data: {
      nodes: { source: { type: { kind: "ObjectType", id: "Course" } }, read: "query", params: {} },
      edges: { source: { type: { kind: "ObjectType", id: "CourseLink" } }, read: "query", params: {} },
    },
  };
  const manifest = definePanel({
    state: {
      selectedNode: { type: { kind: "object", objectType: "Course" } },
      selectedEdge: { type: { kind: "object", objectType: "CourseLink" } },
      from: { type: { kind: "object", objectType: "Course" } },
      to: { type: { kind: "object", objectType: "Course" } },
    },
    members: {
      graph: {
        target: { projectionId: projection.id },
        inputs: { pathFrom: { state: "from" }, pathTo: { state: "to" } },
        outputs: { selectedNode: { state: "selectedNode" }, selectedEdge: { state: "selectedEdge" } },
      },
    },
  });

  const { instance, element, reads } = mountMember(
    projection,
    manifest,
    async (req) => {
      if (req.dataName === "nodes") {
        return {
          status: "ready",
          value: {
            rows: [
              { className: "Course", primaryKey: "c-1", label: "Math 101", fields: {} },
              { className: "Course", primaryKey: "c-2", label: "Algorithms", fields: {} },
            ],
            total: 1500,
          } as never,
        };
      }
      return {
        status: "ready",
        value: {
          rows: [
            { className: "CourseLink", primaryKey: "e-valid", label: "prereq", fields: { fromId: "c-1", toId: "c-2" } },
            { className: "CourseLink", primaryKey: "e-dangling", label: "prereq", fields: { fromId: "c-2", toId: "c-missing" } },
          ],
          total: 2,
        } as never,
      };
    },
    {
      from: { className: "Course", primaryKey: "c-1" },
      to: { className: "Course", primaryKey: "c-2" },
    },
  );

  await vi.waitFor(() => {
    expect(canvas.nodes).toHaveLength(2);
    expect(element.querySelector("[data-graph-coverage='partial']")).toBeTruthy();
  });

  // Both nodes and edges independently sent cap 1000.
  expect(reads.find((r) => r.dataName === "nodes")?.runtimeParams).toEqual({ page: { number: 1, size: 1000 }, size: 1000 });
  expect(reads.find((r) => r.dataName === "edges")?.runtimeParams).toEqual({ page: { number: 1, size: 1000 }, size: 1000 });

  // Dangling edge to unloaded node c-missing is filtered out when nodes are truncated.
  expect(canvas.edges.map((e) => e.id)).toEqual(["e-valid"]);

  // Agent pageContext highlight carries partialEdges & partialNotice.
  const highlights = instance.pageContext.value.highlights ?? [];
  expect(highlights).toHaveLength(1);
  expect(highlights[0]).toMatchObject({
    kind: "path",
    found: true,
    partialEdges: true,
  });
  expect((highlights[0] as { partialNotice?: string }).partialNotice).toContain("1500");
});

it("GroupedGrid consumes customer ObjectType.query, preserves rowOperations, shows coverage notice, and locks drag editing when truncated", async () => {
  const projection: DirectProjection = {
    ...base,
    id: "room-grid",
    name: "Rooms",
    componentId: "@ontomato/sdk:GroupedGrid",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: "Room" } },
    config: { groupKeyField: "building", editable: true },
    data: {
      rows: { source: { type: { kind: "ObjectType", id: "Room" } }, read: "query", params: {} },
    },
  };
  const manifest = definePanel({
    state: { room: { type: { kind: "object", objectType: "Room" } } },
    members: {
      grid: {
        target: { projectionId: projection.id },
        outputs: { selected: { state: "room" } },
      },
    },
  });

  const { element, reads } = mountMember(projection, manifest, async () => ({
    status: "ready",
    value: {
      rows: [
        { className: "Room", primaryKey: "r-1", label: "Room 101", fields: { building: "North" } },
        { className: "Room", primaryKey: "r-2", label: "Room 201", fields: { building: "South" } },
      ],
      total: 1200,
    } as never,
    rowOperations: {
      "Room:r-1": { delete: { available: true } },
    },
  }));

  await vi.waitFor(() => {
    expect(element.querySelector("[data-grid-coverage='partial']")).toBeTruthy();
  });

  expect(reads).toHaveLength(1);
  expect(reads[0]!.runtimeParams).toEqual({ page: { number: 1, size: 1000 }, size: 1000 });
  expect(element.querySelectorAll("[data-group-id]")).toHaveLength(2);
  // Truncated collection locks grid layout editing to prevent partial order overwriting full collection.
  expect(element.querySelector(".sdk-grouped-grid")?.classList.contains("is-locked")).toBe(true);
});

it("OntologyGraph consumes customer Relationship.neighbors without offset/layers/foreign relationKinds, clamps limit <= 100, shows truncation notice, and hides load-more", async () => {
  const projection: DirectProjection = {
    ...base,
    id: "prereq-graph",
    name: "Prerequisites",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {
      start: { kind: "object", objectType: "Course" },
      selected: { kind: "object", objectType: "Course" },
    },
    outputs: {
      selected: { kind: "object", objectType: "Course" },
      visibleRelationKinds: { kind: "list", items: { kind: "scalar", type: "string" } },
      complete: { kind: "scalar", type: "boolean" },
    },
    config: { neighborPageSize: 200 },
    data: {
      neighbors: { source: { type: { kind: "Relationship", id: "prereqOf" } }, read: "neighbors", params: {} },
    },
  };
  const manifest = definePanel({
    state: {
      course: { type: { kind: "object", objectType: "Course" } },
      kinds: { type: { kind: "list", items: { kind: "scalar", type: "string" } } },
      complete: { type: { kind: "scalar", type: "boolean" } },
    },
    members: {
      graph: {
        target: { projectionId: projection.id },
        inputs: { start: { state: "course" }, selected: { state: "course" } },
        outputs: { selected: { state: "course" }, visibleRelationKinds: { state: "kinds" }, complete: { state: "complete" } },
      },
    },
  });

  const { instance, element, reads } = mountMember(
    projection,
    manifest,
    async () => ({
      status: "ready",
      value: {
        node: { className: "Course", primaryKey: "c-1", label: "Algorithms", layer: "fact" },
        neighbors: [{ className: "Course", primaryKey: "c-2", label: "Data Structures", layer: "fact" }],
        edges: [
          {
            id: "prereqOf:c-1->c-2",
            relationKind: "prereqOf",
            label: "Requires",
            from: { className: "Course", primaryKey: "c-1" },
            to: { className: "Course", primaryKey: "c-2" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [
          { relationKind: "prereqOf", label: "Requires", status: "ok", edgeCount: 1, truncated: true },
        ],
      } as never,
    }),
    {
      course: { className: "Course", primaryKey: "c-1" },
      // Shared state holds both the bound relation and a foreign relation name; foreign relation must NOT be forwarded.
      kinds: ["prereqOf", "otherRelation"],
    },
  );

  await vi.waitFor(() => {
    expect(canvas.nodes).toHaveLength(2);
    expect(element.querySelector("[data-graph-state='neighbors-truncated']")).toBeTruthy();
  });

  expect(reads).toHaveLength(1);
  const sent = reads[0]!.runtimeParams!;
  expect(sent).toEqual({
    node: { className: "Course", primaryKey: "c-1" },
    limit: 100,
    relationKinds: ["prereqOf"],
  });
  expect(sent).not.toHaveProperty("offset");
  expect(sent).not.toHaveProperty("layers");
  expect(sent).not.toHaveProperty("direction");
  expect(sent).not.toHaveProperty("targetClass");
  expect(sent.relationKinds).not.toContain("otherRelation");

  // No continuation support on customer Relationship.neighbors -> no load-more button, complete === false.
  expect(element.querySelector("[data-graph-action='load-more-neighbors']")).toBeNull();
  expect(instance.outputs.graph?.complete).toBe(false);
});
