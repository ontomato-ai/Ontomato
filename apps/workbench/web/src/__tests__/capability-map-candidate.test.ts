import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { panelAddress } from "@ontomato/contracts/panel-host";
import {
  ACTION,
  APPLICATION,
  BUSINESS_KNOWLEDGE,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  PRODUCT_PROJECTION,
  ROLE,
  USER,
  WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
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
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  READER,
  type Sent,
} from "./panel-frame";

/*
 * End-to-end candidate test of the M3 four-layer capability map panel (`examples/panels/capability-map/`):
 * runs the actual candidate files (`material.mjs`) directly in the platform document through the preview route,
 * panel host, direct module runner, `OntologyGraph`, `ObjectRelations`, `ObjectList` (dynamic type + user picker),
 * and `SegmentedControl`, with every member read answered through Node's `/api/product-panels/read` entry.
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
      ...productProjectionInputSchema.parse(input),
      id,
      domainId: "domain-1",
      ownerId: "owner-1",
      revision: 1,
      createdAt: "2026-11-19T00:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
      editable: false,
    },
  ]),
);

type Read = {
  source: unknown;
  memberPath: [{ member: string }];
  dataName: string;
  inputs: Record<string, unknown>;
  runtimeParams?: Record<string, unknown>;
};

const reads = (sent: Sent[]) =>
  sent.filter((request) => request.path === "/api/product-panels/read").map((request) => request.body as Read);

function memberData({ dataName, inputs, runtimeParams }: Read): unknown {
  if (dataName === "schema") {
    return {
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
        {
          id: "projection.binds-target",
          from: PRODUCT_PROJECTION,
          to: [OBJECT_TYPE, ONTOLOGY_TYPE],
          labelKey: "platformOntology.relations.projection.binds-target",
          derived: false,
          owner: "node-product-panels",
        },
      ],
    };
  }

  if (dataName === "counts") {
    return {
      counts: [
        { type: OBJECT_TYPE, layer: "fact", status: "ok", count: 8 },
        { type: ACTION, layer: "capability", status: "ok", count: 3 },
        { type: WORKFLOW, layer: "capability", status: "refused", reason: "No workflow permission" },
        { type: USER, layer: "governance", status: "ok", count: 2 },
        { type: ROLE, layer: "governance", status: "ok", count: 1 },
        { type: APPLICATION, layer: "product", status: "unavailable" },
      ],
    };
  }

  if (dataName === "start") {
    return {
      node: { className: USER, primaryKey: "u-alice", label: "Alice", layer: "governance" },
    };
  }

  if (dataName === "neighbors") {
    const node = (runtimeParams?.node ?? inputs.node ?? inputs.selected) as { className: string; primaryKey: string };
    if (node.className === USER && node.primaryKey === "u-alice") {
      return {
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
      };
    }
    if (node.className === ROLE && node.primaryKey === "r-admin") {
      return {
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
      };
    }
    if (node.className === USER && node.primaryKey === "u-bob") {
      return {
        node: { className: USER, primaryKey: "u-bob", label: "Bob", layer: "governance" },
        neighbors: [],
        edges: [],
        relations: [{ relationKind: "user.holds-role", status: "ok", edgeCount: 0 }],
      };
    }
    if (node.className === ACTION && node.primaryKey === "act-refund") {
      return {
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
      };
    }
    if (node.className === PRODUCT_PROJECTION && node.primaryKey === "proj-kb") {
      return {
        node: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb", label: "Knowledge List", layer: "product" },
        neighbors: [
          {
            className: ONTOLOGY_TYPE,
            primaryKey: BUSINESS_KNOWLEDGE,
            label: "Business knowledge",
            layer: "capability",
          },
        ],
        edges: [
          {
            id: "e-proj-kb-type",
            relationKind: "projection.binds-target",
            from: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
            to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
            direction: "outgoing",
            derived: false,
            binding: { reads: ["query"] },
          },
        ],
        relations: [{ relationKind: "projection.binds-target", status: "ok", edgeCount: 1 }],
      };
    }
    if (node.className === ONTOLOGY_TYPE && node.primaryKey === BUSINESS_KNOWLEDGE) {
      return {
        node: {
          className: ONTOLOGY_TYPE,
          primaryKey: BUSINESS_KNOWLEDGE,
          label: "Business knowledge",
          layer: "capability",
        },
        neighbors: [{ className: PRODUCT_PROJECTION, primaryKey: "proj-kb", label: "Knowledge List", layer: "product" }],
        edges: [
          {
            id: "e-proj-kb-type",
            relationKind: "projection.binds-target",
            from: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
            to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
            direction: "incoming",
            derived: false,
            binding: { reads: ["query"] },
          },
        ],
        relations: [{ relationKind: "projection.binds-target", status: "ok", edgeCount: 1 }],
      };
    }
    return {
      node: { className: node.className, primaryKey: node.primaryKey, label: node.primaryKey, layer: "capability" },
      neighbors: [],
      edges: [],
      relations: [],
    };
  }

  if (dataName === "objects") {
    const type = (runtimeParams?.type ?? inputs.type) as string;
    if (type === USER) {
      return {
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
      };
    }
    if (type === ACTION) {
      return {
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
      };
    }
    return {
      type,
      layer: "capability",
      status: "refused",
      reason: "No permission",
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    };
  }

  throw new Error(`Unexpected capability-map read datum: ${dataName}`);
}

function owners(request: Sent): Response {
  if (request.path === `/api/workspaces/${WORKSPACE}/panel-candidate`) return Response.json(candidate());
  if (request.path === "/api/product-panels/definition-stream") {
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  }
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected && projections[projected[1]!]) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/product-panels/read") {
    return Response.json({ status: "ready", value: memberData(request.body as Read) });
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
  return { ...page, router, sent };
}

beforeEach(() => {
  canvasRecorder.nodes = [];
  canvasRecorder.edges = [];
  canvasRecorder.selected = [];
  canvasRecorder.emitSelect = null;
  canvasRecorder.emitBlank = null;
});

afterEach(leaveFrame);

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
    // 1) Opens in instance mode from default signed-in user Alice -> Alice + Admin drawn, panel words rendered directly
    await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(2), { timeout: 5000 });
    expect(document.querySelector(".panel-host-coded .sdk-section-group-title")?.textContent).toBe("Node relations");
    expect(document.querySelector('.panel-host-coded [data-cap-action="toggle-user-picker"]')?.textContent?.trim()).toBe("Switch user");
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
    const neighborRequestsBeforeSearch = reads(sent).filter((r) => r.dataName === "neighbors").length;
    const searchInput = document.querySelector<HTMLInputElement>(".panel-host-coded .cap-map-search-input")!;
    searchInput.value = "Approve";
    searchInput.dispatchEvent(new Event("input"));
    await vi.waitFor(() => {
      expect(canvasRecorder.nodes.find((n) => n.label === "Approve Order")?.tone).toBe("accent");
      expect(canvasRecorder.nodes.find((n) => n.label === "Admin")?.tone).toBe("muted");
    });
    expect(canvasRecorder.nodes).toHaveLength(2);
    expect(reads(sent).filter((r) => r.dataName === "neighbors")).toHaveLength(neighborRequestsBeforeSearch);

    // 5) "Switch user" opens userPicker; picking Bob updates start to Bob and closes the picker (Bob has no neighbors)
    document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="toggle-user-picker"]')!.click();
    await vi.waitFor(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-object-list-item-btn")];
      expect(buttons.some((b) => b.textContent?.includes("Bob"))).toBe(true);
    });
    const bobBtn = [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-object-list-item-btn")].find((b) =>
      b.textContent?.includes("Bob"),
    )!;
    bobBtn.click();
    await vi.waitFor(() => expect(document.querySelector('.panel-host-coded [data-graph-state="no-neighbors"]')).not.toBeNull());
    expect(document.querySelector('.panel-host-coded [data-cap-action="close-user-picker"]')).toBeNull();

    // 6) Switch to Type mode via SegmentedControl -> clears search, renders 6 declared types with count/status labels
    document.querySelector<HTMLButtonElement>('.panel-host-coded .sdk-segmented-option[data-value="type"]')!.click();
    await vi.waitFor(() => expect(canvasRecorder.nodes).toHaveLength(6), { timeout: 5000 });
    expect(searchInput.value).toBe("");
    expect(canvasRecorder.nodes.find((n) => n.id === WORKFLOW)?.label).toContain("No permission");

    // 7) Click ACTION in Type mode -> typeObjects lists readable Actions; picking Refund Order switches back to Instance mode centered on Refund Order
    canvasRecorder.emitSelect!([ACTION]);
    await vi.waitFor(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-object-list-item-btn")];
      expect(buttons.some((b) => b.textContent?.includes("Refund Order"))).toBe(true);
    });
    const refundBtn = [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-object-list-item-btn")].find((b) =>
      b.textContent?.includes("Refund Order"),
    )!;
    refundBtn.click();
    await vi.waitFor(() => {
      expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Order", "Refund Order"]);
    }, { timeout: 5000 });
    await vi.waitFor(() => {
      expect(document.querySelector('.panel-host-coded [data-relation-kind="action.targets-object-type"]')).not.toBeNull();
    });

    // 8) Every member read went to Node's read entry with the candidate workspace source and reader credential, with zero writes
    const workspace = JSON.stringify({ kind: "candidate", workspace: { id: WORKSPACE, ref: "working" } });
    const panelReads = reads(sent);
    expect(panelReads.length).toBeGreaterThan(0);
    expect(panelReads.every((r) => JSON.stringify(r.source) === workspace)).toBe(true);
    expect(sent.every((r) => r.credential === READER)).toBe(true);
    expect(sent.some((r) => r.path.startsWith("/api/platform-ontology/"))).toBe(false);
    expect(sent.some((r) => r.path.startsWith("/api/panel-operation") || ["PUT", "DELETE", "PATCH"].includes(r.method))).toBe(false);
  } finally {
    app.unmount();
  }
});

it("selects and promotes a platform:OntologyType node bound by a projection without state rejection", async () => {
  const { app, sent } = await preview({
    mode: "instance",
    start: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
  });
  try {
    await vi.waitFor(() => {
      expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Business knowledge", "Knowledge List"]);
    }, { timeout: 2500 });

    const typeNodeId = canvasRecorder.nodes.find((n) => n.label === "Business knowledge")!.id;
    canvasRecorder.emitSelect!([typeNodeId]);

    await vi.waitFor(() => {
      expect(document.querySelector('.panel-host-coded [data-relation-kind="projection.binds-target"]')).not.toBeNull();
    }, { timeout: 2500 });

    const promoteBtn = document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="use-selected-as-start"]')!;
    expect(promoteBtn.disabled).toBe(false);
    promoteBtn.click();

    await vi.waitFor(() => {
      expect(promoteBtn.disabled).toBe(true);
      expect(
        reads(sent).some((r) => {
          const node = (r.runtimeParams?.node ?? r.inputs.node) as { className?: string; primaryKey?: string } | undefined;
          return r.memberPath[0].member === "graph"
            && r.dataName === "neighbors"
            && node?.className === ONTOLOGY_TYPE
            && node?.primaryKey === BUSINESS_KNOWLEDGE;
        }),
      ).toBe(true);
    }, { timeout: 2500 });
  } finally {
    app.unmount();
  }
});
