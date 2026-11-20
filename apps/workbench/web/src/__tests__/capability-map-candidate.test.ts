import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { ACTION, APPLICATION, OBJECT_TYPE, ROLE, USER, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { productPanelInputSchema, productProjectionInputSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import {
  candidateFiles,
  panelInput,
  projectionMaterial,
} from "../../../../../packages/apps-sdk/examples/panels/capability-map/material.mjs";
import {
  currentSdk,
  hostMessageOf,
  inside,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelHostFrame,
  READER,
  writeFrameDocument,
  type Sent,
} from "./panel-frame";

/*
 * End-to-end candidate test of the M3 four-layer capability map panel (`examples/panels/capability-map/`):
 * runs the actual candidate files (`material.mjs`), panel host, app host, bridge, SDK resource loader,
 * `platformOntologyAdapters`, `OntologyGraph`, `ObjectRelations`, `ObjectList` (dynamic type + user picker), and
 * `SegmentedControl` through the platform's preview route.
 */

const WORKSPACE = "9d4e5520-1c8d-49bb-933d-9f4e2a8c2003";
const previewPath = `/app-builder/${WORKSPACE}/panel-preview/working/capability-map`;

const canvasRecorder = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  selected: [] as readonly string[],
  emitSelect: null as ((ids: string[]) => void) | null,
  emitBlank: null as (() => void) | null,
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
      selection: { type: String, default: "single" },
      layout: { type: Object, default: () => ({ type: "grid" }) },
      categories: { type: Array, default: () => [] },
      maxHeight: { type: Number, default: undefined },
    },
    emits: ["update:selected", "blank", "move", "viewport"],
    setup(props, { emit, expose }) {
      canvasRecorder.emitSelect = (ids: string[]) => emit("update:selected", ids);
      canvasRecorder.emitBlank = () => emit("blank");
      expose({
        fit: async () => {},
        relayout: async () => {},
        exportImage: async () => new Blob(["png"], { type: "image/png" }),
        positions: () => new Map<string, GraphCanvasPoint>(),
      });
      return () => {
        canvasRecorder.nodes = props.nodes as readonly GraphCanvasNode[];
        canvasRecorder.edges = props.edges as readonly GraphCanvasEdge[];
        canvasRecorder.selected = props.selected as readonly string[];
        return h("div", { class: "mock-g6-canvas", "aria-label": props.label });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

function candidate(): CandidatePanelSource {
  const files = Object.fromEntries(candidateFiles().map((file) => [file.path, file.content]));
  const { content, ...descriptor } = JSON.parse(files["panel.json"]!);
  return {
    kind: "candidate",
    workspace: { id: WORKSPACE, ref: "working" },
    panel: {
      ...descriptor,
      content: { html: files["panel.html"], module: files["panel.mjs"], recipes: files["recipes.md"], ...content },
    },
    previewContext: { kind: "build-test", test: null },
  };
}

const projections: Record<string, ProductProjection> = Object.fromEntries(
  projectionMaterial().projections.map(({ id, input }) => [
    id,
    {
      ...input,
      id,
      domainId: "domain-1",
      ownerId: "owner-1",
      revision: 1,
      createdAt: "2026-11-19T00:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
      editable: false,
    } as ProductProjection,
  ]),
);

function owners(request: Sent): Response {
  if (request.path === `/api/workspaces/${WORKSPACE}/panel-candidate`) return Response.json(candidate());
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  if (request.path === "/api/product-panels/definition-stream") {
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  }
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected && projections[projected[1]!]) return Response.json({ projection: projections[projected[1]!] });

  if (request.path === "/api/platform-ontology/schema") {
    return Response.json({
      layers: ["fact", "capability", "governance", "product"],
      objectTypes: [
        { id: OBJECT_TYPE, layer: "fact", labelKey: "platformOntology.types.objectType" },
        { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
        { id: WORKFLOW, layer: "capability", labelKey: "platformOntology.types.workflow" },
        { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
        { id: ROLE, layer: "governance", labelKey: "platformOntology.types.role" },
        { id: APPLICATION, layer: "product", labelKey: "platformOntology.types.application" },
      ],
      relationKinds: [
        {
          id: "user.holds-role",
          from: USER,
          to: ROLE,
          labelKey: "platformOntology.relations.user.holds-role",
          derived: false,
          owner: "java-identity",
        },
        {
          id: "role.can-execute-action",
          from: ROLE,
          to: ACTION,
          labelKey: "platformOntology.relations.role.can-execute-action",
          derived: false,
          owner: "java-grants",
        },
        {
          id: "action.targets-object-type",
          from: ACTION,
          to: OBJECT_TYPE,
          labelKey: "platformOntology.relations.action.targets-object-type",
          derived: false,
          owner: "java-action",
        },
      ],
    });
  }

  if (request.path === "/api/platform-ontology/counts") {
    return Response.json({
      counts: [
        { type: OBJECT_TYPE, layer: "fact", status: "ok", count: 8 },
        { type: ACTION, layer: "capability", status: "ok", count: 3 },
        { type: WORKFLOW, layer: "capability", status: "refused", reason: "No workflow permission" },
        { type: USER, layer: "governance", status: "ok", count: 2 },
        { type: ROLE, layer: "governance", status: "ok", count: 1 },
        { type: APPLICATION, layer: "product", status: "unavailable" },
      ],
    });
  }

  if (request.path === "/api/platform-ontology/start") {
    return Response.json({
      node: { className: USER, primaryKey: "u-alice", label: "Alice", layer: "governance" },
    });
  }

  if (request.path === "/api/platform-ontology/neighbors") {
    const { node } = request.body as { node: { className: string; primaryKey: string } };
    if (node.className === USER && node.primaryKey === "u-alice") {
      return Response.json({
        node: { className: USER, primaryKey: "u-alice", label: "Alice", layer: "governance" },
        neighbors: [{ className: ROLE, primaryKey: "r-admin", label: "Admin", layer: "governance" }],
        edges: [
          {
            id: "e-alice-admin",
            relationKind: "user.holds-role",
            from: { className: USER, primaryKey: "u-alice" },
            to: { className: ROLE, primaryKey: "r-admin" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [
          { relationKind: "user.holds-role", status: "ok", edgeCount: 1 },
          { relationKind: "user.created-workflow", status: "refused", edgeCount: 0, reason: "No workflow permission" },
        ],
      });
    }
    if (node.className === ROLE && node.primaryKey === "r-admin") {
      return Response.json({
        node: { className: ROLE, primaryKey: "r-admin", label: "Admin", layer: "governance" },
        neighbors: [{ className: ACTION, primaryKey: "act-approve", label: "Approve Order", layer: "capability" }],
        edges: [
          {
            id: "e-admin-approve",
            relationKind: "role.can-execute-action",
            from: { className: ROLE, primaryKey: "r-admin" },
            to: { className: ACTION, primaryKey: "act-approve" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [{ relationKind: "role.can-execute-action", status: "ok", edgeCount: 1 }],
      });
    }
    if (node.className === USER && node.primaryKey === "u-bob") {
      return Response.json({
        node: { className: USER, primaryKey: "u-bob", label: "Bob", layer: "governance" },
        neighbors: [],
        edges: [],
        relations: [{ relationKind: "user.holds-role", status: "ok", edgeCount: 0 }],
      });
    }
    if (node.className === ACTION && node.primaryKey === "act-refund") {
      return Response.json({
        node: { className: ACTION, primaryKey: "act-refund", label: "Refund Order", layer: "capability" },
        neighbors: [{ className: OBJECT_TYPE, primaryKey: "Order", label: "Order", layer: "fact" }],
        edges: [
          {
            id: "e-refund-order",
            relationKind: "action.targets-object-type",
            from: { className: ACTION, primaryKey: "act-refund" },
            to: { className: OBJECT_TYPE, primaryKey: "Order" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [{ relationKind: "action.targets-object-type", status: "ok", edgeCount: 1 }],
      });
    }
    return Response.json({
      node: { className: node.className, primaryKey: node.primaryKey, label: node.primaryKey, layer: "capability" },
      neighbors: [],
      edges: [],
      relations: [],
    });
  }

  if (request.path === "/api/platform-ontology/objects") {
    const body = request.body as { type: string; keyword?: string; page?: number; pageSize?: number };
    if (body.type === USER) {
      return Response.json({
        type: USER,
        layer: "governance",
        status: "ok",
        items: [
          { node: { className: USER, primaryKey: "u-alice" }, label: "Alice" },
          { node: { className: USER, primaryKey: "u-bob" }, label: "Bob" },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
    }
    if (body.type === ACTION) {
      return Response.json({
        type: ACTION,
        layer: "capability",
        status: "ok",
        items: [
          { node: { className: ACTION, primaryKey: "act-approve" }, label: "Approve Order" },
          { node: { className: ACTION, primaryKey: "act-refund" }, label: "Refund Order" },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
    }
    return Response.json({
      type: body.type,
      layer: "capability",
      status: "refused",
      reason: "No permission",
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  }

  return nothingAt(request);
}

async function preview(state: Record<string, unknown>) {
  const sent = installPlatform(owners);
  const routes = appBuilderPages().map((route) =>
    route.name === "PanelCandidatePreview" ? ({ ...route, component: PanelCandidateRoute } as RouteRecordRaw) : route,
  );
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(panelAddress(previewPath, state));
  const page = mountPlatformPage(() => h(RouterView), router);
  const frame = await panelHostFrame();
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  // @ts-expect-error -- plain JavaScript panel module executed inside the panel frame
  await import("../../../../../packages/apps-sdk/examples/panels/capability-map/panel.mjs");
  return { ...page, router, sent };
}

beforeEach(() => {
  canvasRecorder.nodes = [];
  canvasRecorder.edges = [];
  canvasRecorder.selected = [];
  canvasRecorder.emitSelect = null;
  canvasRecorder.emitBlank = null;
});

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("validates every projection and the capability-map panel input against contracts schemas", () => {
  const { projections: material } = projectionMaterial();
  for (const { input } of material) productProjectionInputSchema.parse(input);
  const panel = productPanelInputSchema.parse(panelInput());
  expect(new Set(material.map(({ id }) => id))).toEqual(
    new Set(
      Object.values(panel.manifest.members).flatMap((member) =>
        "projectionId" in member.target ? [member.target.projectionId] : [],
      ),
    ),
  );
  expect(panel.content).toEqual(candidate().panel.content);
  const enMessages = panel.content.messages?.en ?? {};
  const zhMessages = panel.content.messages?.["zh-CN"] ?? {};
  expect(Object.keys(zhMessages).sort()).toEqual(Object.keys(enMessages).sort());
  for (const event of Object.values(panel.manifest.events)) {
    if (!event.labelKey) continue;
    expect(enMessages[event.labelKey]).toBeTruthy();
    expect(zhMessages[event.labelKey]).toBeTruthy();
  }
});

it("runs instance exploration, relations inspection, user switching, highlight query, and type-to-instance object picking end-to-end", { timeout: 30000 }, async () => {
  const { app, sent } = await preview({});
  try {
    // 1) Opens in instance mode from default signed-in user Alice -> Alice + Admin drawn
    await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(2), { timeout: 5000 });
    const adminCanvasId = canvasRecorder.nodes.find((n) => n.label === "Admin")!.id;

    // 2) Clicking Admin selects it, expands 1 hop to Approve Order, and populates ObjectRelations on the right
    canvasRecorder.emitSelect!([adminCanvasId]);
    await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(3), { timeout: 5000 });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-relation-kind="role.can-execute-action"]')).not.toBeNull();
    });

    // 3) "Set selected as start" promotes Admin to start and shows the "Current user" reset button
    const promoteBtn = document.querySelector<HTMLButtonElement>('[data-cap-action="use-selected-as-start"]')!;
    expect(promoteBtn.disabled).toBe(false);
    promoteBtn.click();
    await vi.waitFor(() => expect(document.querySelector('[data-cap-action="reset-start"]')).not.toBeNull());
    await vi.waitFor(() => expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Admin", "Approve Order"]));

    // 4) Search input highlights drawn nodes without hiding them or querying upstream
    const neighborRequestsBeforeSearch = sent.filter((r) => r.path === "/api/platform-ontology/neighbors").length;
    const searchInput = document.querySelector<HTMLInputElement>(".cap-map-search-input")!;
    searchInput.value = "Approve";
    searchInput.dispatchEvent(new Event("input"));
    await vi.waitFor(() => {
      expect(canvasRecorder.nodes.find((n) => n.label === "Approve Order")?.tone).toBe("accent");
      expect(canvasRecorder.nodes.find((n) => n.label === "Admin")?.tone).toBe("muted");
    });
    expect(canvasRecorder.nodes).toHaveLength(2);
    expect(sent.filter((r) => r.path === "/api/platform-ontology/neighbors")).toHaveLength(neighborRequestsBeforeSearch);

    // 5) "Switch user" opens userPicker; picking Bob updates start to Bob and closes the picker (Bob has no neighbors)
    document.querySelector<HTMLButtonElement>('[data-cap-action="toggle-user-picker"]')!.click();
    await vi.waitFor(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn")];
      expect(buttons.some((b) => b.textContent?.includes("Bob"))).toBe(true);
    });
    const bobBtn = [...document.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn")].find((b) =>
      b.textContent?.includes("Bob"),
    )!;
    bobBtn.click();
    await vi.waitFor(() => expect(document.querySelector('[data-graph-state="no-neighbors"]')).not.toBeNull());
    expect(document.querySelector('[data-cap-action="close-user-picker"]')).toBeNull();

    // 6) Switch to Type mode via SegmentedControl -> clears search, renders 6 declared types with count/status labels
    document.querySelector<HTMLButtonElement>('.sdk-segmented-option[data-value="type"]')!.click();
    await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(6), { timeout: 5000 });
    expect(searchInput.value).toBe("");
    expect(canvasRecorder.nodes.find((n) => n.id === WORKFLOW)?.label).toContain("No permission");

    // 7) Click ACTION in Type mode -> typeObjects lists readable Actions; picking Refund Order switches back to Instance mode centered on Refund Order
    canvasRecorder.emitSelect!([ACTION]);
    await vi.waitFor(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn")];
      expect(buttons.some((b) => b.textContent?.includes("Refund Order"))).toBe(true);
    });
    const refundBtn = [...document.querySelectorAll<HTMLButtonElement>(".sdk-object-list-item-btn")].find((b) =>
      b.textContent?.includes("Refund Order"),
    )!;
    refundBtn.click();
    await vi.waitFor(() => {
      expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Order", "Refund Order"]);
    }, { timeout: 5000 });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-relation-kind="action.targets-object-type"]')).not.toBeNull();
    });

    // 8) All frame requests carried reader credential and zero write requests were ever sent
    const ontologyCalls = sent.filter((r) => r.path.startsWith("/api/platform-ontology/"));
    expect(ontologyCalls.length).toBeGreaterThan(0);
    expect(ontologyCalls.every((r) => r.credential === READER)).toBe(true);
    expect(sent.some((r) => ["PUT", "DELETE", "PATCH"].includes(r.method))).toBe(false);
  } finally {
    app.unmount();
  }
});
