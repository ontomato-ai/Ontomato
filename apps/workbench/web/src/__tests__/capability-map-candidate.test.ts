import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import { PanelHost } from "@ontomato/platform-shell";
import { candidatePanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import {
  ACTION,
  APPLICATION,
  BUSINESS_KNOWLEDGE,
  FUNCTION,
  OBJECT_TYPE,
  ONTOLOGY_RELATION_KIND,
  ONTOLOGY_TYPE,
  PRODUCT_PROJECTION,
  ROLE,
  SCHEDULED_TASK,
  SDK_COMPONENT,
  USER,
  WORKFLOW,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import {
  builtinProductPanelInputSchema,
  builtinProductProjectionInputSchema,
  productPanelInputSchema,
  productProjectionInputSchema,
  type ProductProjection,
} from "@ontomato/contracts/product-panels";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";
import { components as sdkComponents } from "../../../../../packages/apps-sdk/src/catalogue";
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

describe("builtin capability-map panel (PanelData-free)", () => {
  const BUILTIN_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "ontology-manager",
    "resources",
    "builtin-panels",
    "capability-map",
  );
  const BUILTIN_WORKSPACE = "8a3c4210-4b2e-4f19-a31c-2d7f9b8c1001";
  const builtinPreviewPath = `/app-builder/${BUILTIN_WORKSPACE}/panel-preview/working/capability-map`;

  function loadBuiltinBundle() {
    const rawJson = readFileSync(join(BUILTIN_DIR, "panel.json"), "utf8");
    const html = readFileSync(join(BUILTIN_DIR, "panel.html"), "utf8");
    const module = readFileSync(join(BUILTIN_DIR, "panel.mjs"), "utf8");
    const recipes = readFileSync(join(BUILTIN_DIR, "recipes.md"), "utf8");
    const parsed = JSON.parse(rawJson) as {
      manifest: unknown;
      content?: { messages?: Record<string, Record<string, string>> };
    };
    const manifest = panelAuthoringManifestSchema.parse(parsed.manifest);
    const authoringComponents = sdkComponents.map((component) => ({
      ...component,
      ports: { props: [], events: [], slots: [] },
    })) as unknown as Parameters<typeof expandPanelAuthoringMember>[2]["components"];
    const typeTable = {
      objectTypes: Object.fromEntries(
        Object.entries(platformObjectTypes).map(([id, spec]) => [
          id,
          {
            id,
            labelKey: spec.labelKey,
            layer: spec.layer,
            reads: spec.reads ?? {},
            operations: (spec.operations ?? []).map((opId) => ({
              id: opId,
              kind: "action" as const,
              effect: "write" as const,
              target: { source: "none" as const },
              batch: false,
              inputSchema: {},
            })),
          },
        ]),
      ),
    } as unknown as Parameters<typeof expandPanelAuthoringMember>[2]["typeTable"];

    const expandedProjections: Record<string, ProductProjection> = {};
    const expandedMembers: Record<string, Record<string, unknown>> = {};
    for (const [memberKey, definition] of Object.entries(manifest.members)) {
      if (!("component" in definition)) continue;
      const id = definition.id!;
      const { projection, placement } = expandPanelAuthoringMember(memberKey, definition, {
        state: manifest.state,
        components: authoringComponents,
        typeTable,
      });
      expandedProjections[id] = {
        ...builtinProductProjectionInputSchema.parse({
          ...projection,
          visibility: "platform",
          name: definition.name ?? memberKey,
          description: definition.description ?? memberKey,
        }),
        id,
        domainId: null,
        ownerId: null,
        revision: 1,
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
        editable: false,
      };
      expandedMembers[memberKey] = { ...placement, target: { projectionId: id } };
    }

    const panel = builtinProductPanelInputSchema.parse({
      name: "Capability map",
      description: "Four-layer platform capability map",
      visibility: "platform",
      manifest: {
        state: manifest.state,
        members: expandedMembers,
      },
      content: {
        ...parsed.content,
        html,
        module,
        recipes,
      },
    });

    const source: CandidatePanelSource = {
      kind: "candidate",
      workspace: { id: BUILTIN_WORKSPACE, ref: "working" },
      panel: {
        manifest: panel.manifest,
        content: panel.content,
      },
      previewContext: { kind: "build-test", test: null },
    };

    return { rawJson, html, module, recipes, parsed, manifest, panel, projections: expandedProjections, source };
  }

  function builtinMemberData(read: Read): unknown {
    const member = read.memberPath[0]?.member;
    const { dataName, inputs, runtimeParams } = read;

    if (dataName === "rows" && (member === "typeList" || member === "typePicker")) {
      return [
        {
          className: ONTOLOGY_TYPE,
          primaryKey: OBJECT_TYPE,
          label: "Object type",
          fields: { typeId: OBJECT_TYPE, layer: "Fact", layerId: "fact" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: FUNCTION,
          label: "Function",
          fields: { typeId: FUNCTION, layer: "Capability", layerId: "capability" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: ACTION,
          label: "Action",
          fields: { typeId: ACTION, layer: "Capability", layerId: "capability" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: WORKFLOW,
          label: "Workflow",
          fields: { typeId: WORKFLOW, layer: "Capability", layerId: "capability" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: USER,
          label: "User",
          fields: { typeId: USER, layer: "Governance", layerId: "governance" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: SCHEDULED_TASK,
          label: "Scheduled task",
          fields: { typeId: SCHEDULED_TASK, layer: "Governance", layerId: "governance" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: SDK_COMPONENT,
          label: "SDK component",
          fields: { typeId: SDK_COMPONENT, layer: "Product", layerId: "product" },
        },
      ];
    }

    if (dataName === "supplement" && member === "typeList") {
      return [
        {
          className: ONTOLOGY_TYPE,
          primaryKey: OBJECT_TYPE,
          label: "Object type",
          fields: { countStatus: "ok", countStatusLabel: "Readable", countDisplay: "8", count: 8 },
          tones: { countStatus: "success", countStatusLabel: "success", countDisplay: "success" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: FUNCTION,
          label: "Function",
          fields: { countStatus: "ok", countStatusLabel: "Readable", countDisplay: "0", count: 0 },
          tones: { countStatus: "success", countStatusLabel: "success", countDisplay: "success" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: ACTION,
          label: "Action",
          fields: { countStatus: "ok", countStatusLabel: "Readable", countDisplay: "3", count: 3 },
          tones: { countStatus: "success", countStatusLabel: "success", countDisplay: "success" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: WORKFLOW,
          label: "Workflow",
          fields: {
            countStatus: "refused",
            countStatusLabel: "No permission",
            countDisplay: "No permission",
            countReason: "Missing workflow read grant",
          },
          tones: { countStatus: "warning", countStatusLabel: "warning", countDisplay: "warning" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: USER,
          label: "User",
          fields: {
            countStatus: "failed",
            countStatusLabel: "Read failed",
            countDisplay: "Read failed",
            countReason: "Identity backend timeout",
          },
          tones: { countStatus: "danger", countStatusLabel: "danger", countDisplay: "danger" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: SCHEDULED_TASK,
          label: "Scheduled task",
          fields: {
            countStatus: "unavailable",
            countStatusLabel: "Not connected",
            countDisplay: "Not connected",
            countReason: "Scheduler module disabled",
          },
          tones: { countStatus: "info", countStatusLabel: "info", countDisplay: "info" },
        },
        {
          className: ONTOLOGY_TYPE,
          primaryKey: SDK_COMPONENT,
          label: "SDK component",
          fields: { countStatus: "ok", countStatusLabel: "Readable", countDisplay: "14", count: 14 },
          tones: { countStatus: "success", countStatusLabel: "success", countDisplay: "success" },
        },
      ];
    }

    if (dataName === "rows" && member === "relationKindFilter") {
      return [
        {
          className: ONTOLOGY_RELATION_KIND,
          primaryKey: "projection.binds-target",
          label: "Binds target",
          fields: { id: "projection.binds-target", from: PRODUCT_PROJECTION, to: [OBJECT_TYPE, ONTOLOGY_TYPE], derived: false, owner: "node-product-panels" },
        },
        {
          className: ONTOLOGY_RELATION_KIND,
          primaryKey: "projection.uses-component",
          label: "Uses component",
          fields: { id: "projection.uses-component", from: PRODUCT_PROJECTION, to: SDK_COMPONENT, derived: false, owner: "node-product-panels" },
        },
      ];
    }

    if (dataName === "record" && (member === "typeHeader" || member === "typeSummary")) {
      const target = inputs.target as { primaryKey?: string } | undefined;
      if (target?.primaryKey === SDK_COMPONENT) {
        return {
          className: ONTOLOGY_TYPE,
          primaryKey: SDK_COMPONENT,
          label: "SDK component",
          fields: {
            typeId: SDK_COMPONENT,
            layer: "Product",
            layerId: "product",
            countStatus: "ok",
            countStatusLabel: "Readable",
            countDisplay: "14",
            count: 14,
            definition: "Reusable presentation or control component published by the SDK.",
            rules: "Published with the platform SDK release.",
            directoryPath: "/ontology/components",
            directoryName: "Components",
          },
          fieldLabels: {
            layer: "Layer",
            countDisplay: "Readable instances",
            definition: "Definition",
            rules: "Creation and use rules",
          },
          tones: { countDisplay: "success" },
          outputs: {
            directoryPath: "/ontology/components",
            directoryName: "Components",
          },
        };
      }
      if (target?.primaryKey === ACTION) {
        return {
          className: ONTOLOGY_TYPE,
          primaryKey: ACTION,
          label: "Action",
          fields: {
            typeId: ACTION,
            layer: "Capability",
            layerId: "capability",
            countStatus: "ok",
            countStatusLabel: "Readable",
            countDisplay: "3",
            count: 3,
            definition: "Registered business write capability on an ontology object type.",
            rules: "Governed by role grants.",
          },
          fieldLabels: {
            layer: "Layer",
            countDisplay: "Readable instances",
            definition: "Definition",
            rules: "Creation and use rules",
          },
          tones: { countDisplay: "success" },
        };
      }
      return {
        className: ONTOLOGY_TYPE,
        primaryKey: target?.primaryKey ?? OBJECT_TYPE,
        label: "Object type",
        fields: {
          typeId: target?.primaryKey ?? OBJECT_TYPE,
          layer: "Fact",
          countDisplay: "8",
        },
        tones: { countDisplay: "success" },
      };
    }

    if (dataName === "rows" && member === "typeProperties") {
      return [
        {
          primaryKey: "id",
          label: "id",
          fields: { name: "id", type: "string", optional: false, description: "Stable identifier of the record." },
        },
        {
          primaryKey: "description",
          label: "description",
          fields: { name: "description", type: "string", optional: true, description: "Human-readable explanation." },
        },
      ];
    }

    if (dataName === "rows" && member === "typeRelations") {
      return [
        {
          primaryKey: "outgoing:action.targets-object-type:platform:ObjectType",
          label: "Targets object type",
          fields: {
            direction: "outgoing",
            relationKind: "action.targets-object-type",
            peer: OBJECT_TYPE,
            peerLabel: "Object type",
            derived: false,
          },
        },
      ];
    }

    if (dataName === "rows" && member === "typeReads") {
      return [
        {
          primaryKey: "list",
          label: "list",
          fields: { name: "list", parameters: ["search"], result: "panelRecordList", source: "type" },
        },
      ];
    }

    if (dataName === "rows" && member === "typeOperations") {
      return [
        {
          primaryKey: "platform:Action.save",
          label: "platform:Action.save",
          fields: { id: "platform:Action.save", kind: "form", effect: "write", inputs: ["name", "targetType"], batch: false },
        },
      ];
    }

    if (dataName === "objects" && member === "userPicker") {
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

    if (dataName === "neighbors") {
      const node = (runtimeParams?.node ?? inputs.node ?? inputs.selected) as { className: string; primaryKey: string };
      if (node.className === PRODUCT_PROJECTION && node.primaryKey === "proj-kb") {
        return {
          node: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb", label: "Knowledge List", layer: "product" },
          neighbors: [
            { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE, label: "Business knowledge", layer: "capability" },
            { className: SDK_COMPONENT, primaryKey: "ObjectList", label: "ObjectList", layer: "product" },
          ],
          edges: [
            {
              id: "e-proj-kb-type",
              relationKind: "projection.binds-target",
              from: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
              to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
              direction: "outgoing",
              derived: false,
              binding: { reads: ["query"], operations: ["knowledge.approve"], viaInput: true },
            },
            {
              id: "e-proj-kb-comp",
              relationKind: "projection.uses-component",
              from: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
              to: { className: SDK_COMPONENT, primaryKey: "ObjectList" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [
            { relationKind: "projection.binds-target", status: "ok", edgeCount: 1 },
            { relationKind: "projection.uses-component", status: "ok", edgeCount: 1 },
            { relationKind: "panel.contains-projection", status: "ok", edgeCount: 0 },
            { relationKind: "user.created-workflow", status: "refused", edgeCount: 0, reason: "No workflow permission" },
          ],
        };
      }
      if (node.className === ACTION && (node.primaryKey === "act-refund-1" || node.primaryKey === "act-refund-2")) {
        return {
          node: { className: ACTION, primaryKey: node.primaryKey, label: "Refund Order", layer: "capability" },
          neighbors: [{ className: OBJECT_TYPE, primaryKey: "Order", label: "Order", layer: "fact" }],
          edges: [
            {
              id: `e-${node.primaryKey}-order`,
              relationKind: "action.targets-object-type",
              from: { className: ACTION, primaryKey: node.primaryKey },
              to: { className: OBJECT_TYPE, primaryKey: "Order" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [{ relationKind: "action.targets-object-type", status: "ok", edgeCount: 1 }],
        };
      }
      if (node.className === OBJECT_TYPE && node.primaryKey === "Order") {
        return {
          node: { className: OBJECT_TYPE, primaryKey: "Order", label: "Order", layer: "fact" },
          neighbors: [{ className: ACTION, primaryKey: "act-refund-1", label: "Refund Order", layer: "capability" }],
          edges: [],
          relations: [],
        };
      }
      if (node.className === ONTOLOGY_TYPE && node.primaryKey === BUSINESS_KNOWLEDGE) {
        return {
          node: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE, label: "Business knowledge", layer: "capability" },
          neighbors: [{ className: PRODUCT_PROJECTION, primaryKey: "proj-kb", label: "Knowledge List", layer: "product" }],
          edges: [
            {
              id: "e-kb-proj",
              relationKind: "projection.binds-target",
              from: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
              to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
              direction: "incoming",
              derived: false,
            },
          ],
          relations: [{ relationKind: "projection.binds-target", status: "ok", edgeCount: 1 }],
        };
      }
    }

    return memberData(read);
  }

  async function mountBuiltin(
    state: Record<string, unknown>,
    extraRoutes: RouteRecordRaw[] = [],
    onRead?: (read: Read) => Response | Promise<Response> | undefined,
  ) {
    const bundle = loadBuiltinBundle();
    const routes: RouteRecordRaw[] = [
      ...appBuilderPages().map((route) =>
        route.name === "PanelCandidatePreview" ? ({ ...route, component: PanelCandidateRoute } as RouteRecordRaw) : route,
      ),
      ...extraRoutes,
    ];
    const router = createRouter({ history: createMemoryHistory(), routes });
    const sent = installPlatform((request) => {
      if (request.path === `/api/workspaces/${BUILTIN_WORKSPACE}/panel-candidate`) {
        return Response.json(bundle.source);
      }
      if (request.path === "/api/product-panels/definition-stream") {
        return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      }
      const projected = request.path.match(/^\/api\/product-projections\/([^/]+)$/u);
      if (projected && bundle.projections[projected[1]!]) {
        return Response.json({ projection: bundle.projections[projected[1]!] });
      }
      if (request.path === "/api/product-panels/read") {
        const read = request.body as Read;
        const custom = onRead?.(read);
        if (custom) return custom;
        return Response.json({ status: "ready", value: builtinMemberData(read) });
      }
      return nothingAt(request);
    }, router);
    await router.push(panelAddress(builtinPreviewPath, state));
    const page = mountPlatformPage(() => h(RouterView), router);
    return { ...page, router, sent, bundle };
  }

  async function mountBuiltinWithHost(initialState: Record<string, unknown> = {}) {
    const bundle = loadBuiltinBundle();
    const router = createRouter({ history: createMemoryHistory(), routes: appBuilderPages() });
    const sent = installPlatform((request) => {
      if (request.path === `/api/workspaces/${BUILTIN_WORKSPACE}/panel-candidate`) {
        return Response.json(bundle.source);
      }
      if (request.path === "/api/product-panels/definition-stream") {
        return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      }
      const projected = request.path.match(/^\/api\/product-projections\/([^/]+)$/u);
      if (projected && bundle.projections[projected[1]!]) {
        return Response.json({ projection: bundle.projections[projected[1]!] });
      }
      if (request.path === "/api/product-panels/read") {
        return Response.json({ status: "ready", value: builtinMemberData(request.body as Read) });
      }
      return nothingAt(request);
    }, router);
    await router.push(panelAddress(builtinPreviewPath, initialState));
    const hostRef = ref<InstanceType<typeof PanelHost> | null>(null);
    const port = candidatePanelHost({ id: BUILTIN_WORKSPACE, ref: "working", pageKey: "capability-map" });
    const page = mountPlatformPage(
      () =>
        h(PanelHost, {
          ref: hostRef,
          port,
          label: "Capability map",
          address: router.currentRoute.value.fullPath,
          initial: panelAddressState(router.currentRoute.value.fullPath),
          language: { locale: "en", fallback: "en" },
          labels: {
            notStarted: "Not started",
            failures: { fileUnavailable: "{file}", scriptThrew: "threw", scriptRejected: "rejected" },
            content: { styleOutside: "style" },
            refresh: "Refresh",
          },
          onDisplayAddress: (input: { address: string }) => {
            if (router.currentRoute.value.fullPath !== input.address) void router.replace(input.address);
          },
        }),
      router,
    );
    await vi.waitFor(() => expect(hostRef.value?.direct).toBeTruthy(), { timeout: 5000 });
    return { ...page, router, sent, bundle, host: hostRef.value! };
  }

  it("removes all PanelData and usePanelData references, viewport height/media queries, and script start concatenation while keeping bilingual messages, schemas, and recipes valid", () => {
    const { rawJson, html, module, recipes, parsed, manifest } = loadBuiltinBundle();
    expect(rawJson).not.toContain("PanelData");
    expect(module).not.toContain("usePanelData");
    expect(module).not.toContain("INSTANCE_DIRECTORIES");
    // No script string concatenation of start state fields.
    expect(module).not.toContain("start.value.className");
    expect(module).not.toContain("start.value.primaryKey");
    expect(module).not.toContain("startDisplay");
    // No window media queries, viewport height units, or hidden background canvas mount.
    expect(html).not.toMatch(/@media\b/u);
    expect(html).not.toMatch(/\b\d+d?vh\b/u);
    expect(html).not.toContain("is-behind");
    expect(html).toContain("@container (max-width: 960px)");
    // Enforce English-only source and template text outside zh-CN message entries.
    expect(/[\u4e00-\u9fff]/u.test(html)).toBe(false);
    expect(/[\u4e00-\u9fff]/u.test(module)).toBe(false);
    expect(Object.values(manifest.members).every((m) => !("component" in m) || m.component !== "PanelData")).toBe(true);
    // Recipes document every newly exposed public state and clarify setState null / selected focus semantics.
    for (const field of [
      "visibleLayers",
      "expandedNodes",
      "pickingStart",
      "showUserPicker",
      "typeObjectsSearch",
      "userPickerSearch",
      "relationKindsSearch",
    ]) {
      expect(Object.hasOwn(manifest.state, field)).toBe(true);
      expect(recipes).toContain(`\`${field}\``);
    }
    expect(recipes).toContain("明确传 `null`");
    expect(recipes).toContain("当前子图内");
    const enMessages = parsed.content?.messages?.en ?? {};
    const zhMessages = parsed.content?.messages?.["zh-CN"] ?? {};
    expect(Object.keys(zhMessages).sort()).toEqual(Object.keys(enMessages).sort());
  });

  it("renders four-layer type list with distinct ok/0/refused/failed/unavailable states, class detail sub-tables, URL selectedType compatibility, and directory navigation", { timeout: 30000 }, async () => {
    const { app, router, sent } = await mountBuiltin(
      { mode: "type", view: "list", selectedType: SDK_COMPONENT },
      [{ path: "/ontology/components", name: "OntologyComponents", component: { render: () => h("div", { class: "components-dir" }, "Components Directory") } }],
    );
    try {
      await vi.waitFor(() => {
        const err = document.querySelector(".panel-host-error")?.textContent;
        if (err) throw new Error(`Panel host error: ${err}`);
        const text = document.querySelector(".panel-host-coded .capmap-types")?.textContent ?? "";
        expect(text).toContain("Fact");
        expect(text).toContain("Capability");
        expect(text).toContain("Governance");
        expect(text).toContain("Product");
        expect(text).toContain("Function");
        expect(text).toContain("No permission");
        expect(text).toContain("Missing workflow read grant");
        expect(text).toContain("Read failed");
        expect(text).toContain("Identity backend timeout");
        expect(text).toContain("Not connected");
        expect(text).toContain("Scheduler module disabled");
      }, { timeout: 5000 });

      const countTags = [...document.querySelectorAll(".panel-host-coded .capmap-types .sdk-object-list-tag")];
      expect(countTags.some((el) => el.textContent?.trim() === "0" && el.getAttribute("data-tone") === "success")).toBe(true);
      expect(countTags.some((el) => el.textContent?.trim() === "No permission" && el.getAttribute("data-tone") === "warning")).toBe(true);
      expect(countTags.some((el) => el.textContent?.trim() === "Read failed" && el.getAttribute("data-tone") === "danger")).toBe(true);
      expect(countTags.some((el) => el.textContent?.trim() === "Not connected" && el.getAttribute("data-tone") === "info")).toBe(true);

      // 2) URL selectedType=platform:SDKComponent hydrates selectedTypeRef -> ObjectHeader, ObjectSummary, 4 sub-tables, and directory button.
      await vi.waitFor(() => {
        const detail = document.querySelector(".panel-host-coded .capmap-class-detail")?.textContent ?? "";
        expect(detail).toContain("SDK component");
        expect(detail).toContain("Reusable presentation or control component published by the SDK.");
        expect(detail).toContain("Stable identifier of the record.");
        expect(detail).toContain("Targets object type");
        expect(detail).toContain("panelRecordList");
        expect(detail).toContain("platform:Action.save");
        expect(document.querySelector('.panel-host-coded [data-cap-action="view-instances"]')).not.toBeNull();
      }, { timeout: 5000 });

      expect(
        reads(sent).some((r) => r.memberPath[0].member === "typeProperties" && r.inputs.type === SDK_COMPONENT),
      ).toBe(true);
      expect(
        reads(sent).some((r) => r.memberPath[0].member === "typeRelations" && r.inputs.type === SDK_COMPONENT),
      ).toBe(true);
      expect(
        reads(sent).some((r) => r.memberPath[0].member === "typeReads" && r.inputs.type === SDK_COMPONENT),
      ).toBe(true);
      expect(
        reads(sent).some((r) => r.memberPath[0].member === "typeOperations" && r.inputs.type === SDK_COMPONENT),
      ).toBe(true);
      // Hidden graph projection is unmounted in type/list view and issues zero background reads.
      expect(document.querySelector(".panel-host-coded .capmap-canvas")).toBeNull();
      expect(reads(sent).filter((r) => r.memberPath[0].member === "graph")).toHaveLength(0);

      // 3) Clicking "Action" in typeList updates selectedTypeRef -> syncs URL selectedType -> hides directoryPath button.
      const actionRow = [...document.querySelectorAll<HTMLTableRowElement>(".panel-host-coded .capmap-types tbody tr")].find((row) =>
        row.textContent?.includes("platform:Action"),
      )!;
      actionRow.click();
      await vi.waitFor(() => {
        expect(router.currentRoute.value.query.selectedType).toBe(ACTION);
        expect(document.querySelector(".panel-host-coded .capmap-class-detail")?.textContent).toContain("Registered business write capability");
        expect(document.querySelector('.panel-host-coded [data-cap-action="view-instances"]')).toBeNull();
      }, { timeout: 5000 });

      // 4) Switching back to SDK component restores "View instances" button and navigates to /ontology/components.
      const sdkRow = [...document.querySelectorAll<HTMLTableRowElement>(".panel-host-coded .capmap-types tbody tr")].find((row) =>
        row.textContent?.includes(SDK_COMPONENT),
      )!;
      sdkRow.click();
      await vi.waitFor(() => {
        expect(document.querySelector('.panel-host-coded [data-cap-action="view-instances"]')).not.toBeNull();
      }, { timeout: 5000 });
      document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="view-instances"]')!.click();
      await vi.waitFor(() => {
        expect(router.currentRoute.value.path).toBe("/ontology/components");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });

  it("renders four-layer type names immediately while supplement countRows is loading, allows clicking into class detail, and merges counts in-place without losing selection", { timeout: 30000 }, async () => {
    let resolveSupplement!: (response: Response) => void;
    const supplementDeferred = new Promise<Response>((resolve) => {
      resolveSupplement = resolve;
    });

    const { app, router, sent } = await mountBuiltin(
      { mode: "type", view: "list" },
      [],
      (read) => {
        if (read.memberPath[0]?.member === "typeList" && read.dataName === "supplement") {
          return supplementDeferred;
        }
        return undefined;
      },
    );
    try {
      // 1) Catalogue rows render immediately across all four layers while countRows supplement is still pending.
      await vi.waitFor(() => {
        const container = document.querySelector(".panel-host-coded .capmap-types");
        const text = container?.textContent ?? "";
        expect(text).toContain("Fact");
        expect(text).toContain("Capability");
        expect(text).toContain("Governance");
        expect(text).toContain("Product");
        expect(text).toContain("Object type");
        expect(text).toContain("Action");
        expect(text).toContain("Workflow");
        expect(text).toContain("SDK component");
      }, { timeout: 5000 });

      const pendingCells = [...document.querySelectorAll(".panel-host-coded .capmap-types .sdk-object-list-cell-pending")];
      expect(pendingCells.length).toBeGreaterThanOrEqual(14);
      expect(pendingCells.every((el) => el.textContent === "…" && el.getAttribute("aria-busy") === "true")).toBe(true);
      expect(document.querySelectorAll(".panel-host-coded .capmap-types .sdk-object-list-tag")).toHaveLength(0);
      expect(reads(sent).some((r) => r.memberPath[0].member === "typeList" && r.dataName === "rows")).toBe(true);
      expect(reads(sent).some((r) => r.memberPath[0].member === "typeList" && r.dataName === "supplement")).toBe(true);

      // 2) Clicking a row while counts are still loading immediately selects it and drives right-hand class detail.
      const actionRow = [...document.querySelectorAll<HTMLTableRowElement>(".panel-host-coded .capmap-types tbody tr")].find((row) =>
        row.textContent?.includes("platform:Action"),
      )!;
      actionRow.click();
      await vi.waitFor(() => {
        expect(router.currentRoute.value.query.selectedType).toBe(ACTION);
        expect(actionRow.classList.contains("chosen")).toBe(true);
        expect(document.querySelector(".panel-host-coded .capmap-class-detail")?.textContent).toContain("Registered business write capability");
      }, { timeout: 5000 });

      // 3) Supplement arrives: four count statuses and reasons merge in-place without losing the selected row.
      resolveSupplement(
        Response.json({
          status: "ready",
          value: builtinMemberData({ memberPath: [{ member: "typeList" }], dataName: "supplement", inputs: {} }),
        }),
      );

      await vi.waitFor(() => {
        expect(document.querySelectorAll(".panel-host-coded .capmap-types .sdk-object-list-cell-pending")).toHaveLength(0);
        const text = document.querySelector(".panel-host-coded .capmap-types")?.textContent ?? "";
        expect(text).toContain("No permission");
        expect(text).toContain("Missing workflow read grant");
        expect(text).toContain("Read failed");
        expect(text).toContain("Identity backend timeout");
        expect(text).toContain("Not connected");
        expect(text).toContain("Scheduler module disabled");
      }, { timeout: 5000 });

      const countTags = [...document.querySelectorAll(".panel-host-coded .capmap-types .sdk-object-list-tag")];
      expect(countTags.some((el) => el.textContent?.trim() === "0" && el.getAttribute("data-tone") === "success")).toBe(true);
      expect(countTags.some((el) => el.textContent?.trim() === "No permission" && el.getAttribute("data-tone") === "warning")).toBe(true);
      expect(countTags.some((el) => el.textContent?.trim() === "Read failed" && el.getAttribute("data-tone") === "danger")).toBe(true);
      expect(countTags.some((el) => el.textContent?.trim() === "Not connected" && el.getAttribute("data-tone") === "info")).toBe(true);

      const selectedActionRow = [...document.querySelectorAll<HTMLTableRowElement>(".panel-host-coded .capmap-types tbody tr")].find((row) =>
        row.textContent?.includes("platform:Action"),
      )!;
      expect(selectedActionRow.classList.contains("chosen")).toBe(true);
      expect(router.currentRoute.value.query.selectedType).toBe(ACTION);
    } finally {
      app.unmount();
    }
  });

  it("links ObjectRelations summary, collapsed empty groups, bindings, relation filter, and set-as-start bidirectionally with OntologyGraph", { timeout: 30000 }, async () => {
    const { app, sent } = await mountBuiltin({
      mode: "instance",
      start: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
      selected: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
    });
    try {
      // 1) ObjectRelations renders summary count, refused notice, collapsed empty group count, and edge bindings.
      await vi.waitFor(() => {
        const rel = document.querySelector(".panel-host-coded .sdk-object-relations");
        expect(rel).not.toBeNull();
        expect(rel!.textContent).toContain("Business knowledge");
        expect(rel!.textContent).toContain("ObjectList");
        expect(rel!.querySelector(".sdk-object-relations-summary-count")).not.toBeNull();
        expect(rel!.querySelector('.sdk-object-relations-summary-item[data-status="refused"]')).not.toBeNull();
        expect(rel!.querySelector(".sdk-object-relations-empty-kinds")).not.toBeNull();
        const bindings = rel!.querySelector(".sdk-object-relations-binding")?.textContent ?? "";
        expect(bindings).toContain("query");
        expect(bindings).toContain("knowledge.approve");
      }, { timeout: 5000 });

      // Both edges drawn initially on OntologyGraph.
      await vi.waitFor(() => expect(canvasRecorder.edges).toHaveLength(2), { timeout: 5000 });

      // 2) Filtering relation kinds inside ObjectRelations updates relationKinds state and filters OntologyGraph edges.
      const selectEl = document.querySelector(".panel-host-coded .sdk-object-relations-filter-select");
      expect(selectEl).not.toBeNull();
      // Select only "projection.binds-target" via the rendered option dropdown.
      (selectEl as HTMLElement).click();
      await vi.waitFor(() => {
        const option = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((el) =>
          el.textContent?.includes("Binds target"),
        );
        expect(option).toBeDefined();
        option!.click();
      }, { timeout: 5000 });

      await vi.waitFor(() => {
        expect(canvasRecorder.edges).toHaveLength(1);
        expect(document.querySelector('.panel-host-coded [data-relation-kind="projection.uses-component"]')).toBeNull();
        expect(document.querySelector('.panel-host-coded [data-relation-kind="projection.binds-target"]')).not.toBeNull();
      }, { timeout: 5000 });

      // 3) Clicking "Set as start" inside ObjectRelations promotes Business knowledge as start on OntologyGraph.
      const setStartBtn = document.querySelector<HTMLButtonElement>(
        '.panel-host-coded [data-relation-kind="projection.binds-target"] .sdk-object-relations-set-start',
      )!;
      expect(setStartBtn).not.toBeNull();
      setStartBtn.click();

      await vi.waitFor(() => {
        expect(
          reads(sent).some((r) => {
            const node = (r.runtimeParams?.node ?? r.inputs.node) as { className?: string; primaryKey?: string } | undefined;
            return r.memberPath[0].member === "graph"
              && r.dataName === "neighbors"
              && node?.className === ONTOLOGY_TYPE
              && node?.primaryKey === BUSINESS_KNOWLEDGE;
          }),
        ).toBe(true);
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });

  it("picks a type via standalone ReferencePicker to list objects, promotes a chosen object as start, and surfaces unavailable directory notice", { timeout: 30000 }, async () => {
    const { app, router } = await mountBuiltin({ mode: "instance" });
    router.beforeEach((to) => {
      if (to.path === "/ontology/components") {
        throw new Error("Directory entry is not admitted");
      }
    });
    try {
      // 1) Standalone inline ReferencePicker loads platform:OntologyType.list and syncs selectedType on selection.
      await vi.waitFor(() => {
        expect(document.querySelector(".panel-host-coded .sdk-inline-reference-picker-select")).not.toBeNull();
      }, { timeout: 5000 });
      (document.querySelector(".panel-host-coded .sdk-inline-reference-picker-select") as HTMLElement).click();
      await vi.waitFor(() => {
        const option = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((el) =>
          el.textContent?.trim() === "Action",
        );
        expect(option).toBeDefined();
        option!.click();
      }, { timeout: 5000 });

      await vi.waitFor(() => {
        expect(router.currentRoute.value.query.selectedType).toBe(ACTION);
        const buttons = [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-object-list-item-btn")];
        expect(buttons.some((b) => b.textContent?.includes("Refund Order"))).toBe(true);
      }, { timeout: 5000 });

      // 2) Choosing an object from typeObjects sets start and expands its one-hop relations.
      const refundBtn = [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-object-list-item-btn")].find((b) =>
        b.textContent?.includes("Refund Order"),
      )!;
      refundBtn.click();
      await vi.waitFor(() => {
        expect(canvasRecorder.nodes.map((n) => n.label).sort()).toEqual(["Order", "Refund Order"]);
      }, { timeout: 5000 });

      // 3) Switching to Type mode with SDKComponent when /ontology/components route is absent shows a dismissible notice naming "Components".
      document.querySelector<HTMLButtonElement>('.panel-host-coded .sdk-segmented-option[data-value="type"]')!.click();
      await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBeGreaterThan(0), { timeout: 5000 });
      document.querySelector<HTMLButtonElement>('.panel-host-coded .sdk-segmented-option[data-value="list"]')!.click();
      await vi.waitFor(() => {
        const sdkRow = [...document.querySelectorAll<HTMLTableRowElement>(".panel-host-coded .capmap-types tbody tr")].find((row) =>
          row.textContent?.includes(SDK_COMPONENT),
        );
        expect(sdkRow).toBeDefined();
        sdkRow!.click();
      }, { timeout: 5000 });
      await vi.waitFor(() => {
        expect(document.querySelector('.panel-host-coded [data-cap-action="view-instances"]')).not.toBeNull();
      }, { timeout: 5000 });
      document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="view-instances"]')!.click();
      await vi.waitFor(() => {
        const noticeText = document.querySelector(".panel-host-coded .capmap-notice")?.textContent ?? "";
        expect(noticeText).toContain("Components");
      }, { timeout: 5000 });
      document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="dismiss-notice"]')!.click();
      await vi.waitFor(() => {
        expect(document.querySelector(".panel-host-coded .capmap-notice")).toBeNull();
      }, { timeout: 2500 });
    } finally {
      app.unmount();
    }
  });

  it("preserves simultaneous start+selected, re-selects same start via relations Set as start, renders start outputs distinguishing same-name objects, and groups typePicker by layer", { timeout: 30000 }, async () => {
    const { app, host } = await mountBuiltinWithHost({
      mode: "instance",
      start: { className: PRODUCT_PROJECTION, primaryKey: "proj-kb" },
      selected: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
    });
    try {
      // 1) Setting start and selected together never overwrites selected to start.
      await vi.waitFor(() => {
        const subject = document.querySelector(".panel-host-coded .sdk-object-relations-subject")?.textContent?.trim();
        expect(subject).toBe("Business knowledge");
        expect(document.querySelector(".panel-host-coded [data-cap-start-label]")?.textContent?.trim()).toBe("Knowledge List");
        expect(document.querySelector(".panel-host-coded [data-cap-start-detail]")?.textContent?.trim()).toBe("Projection · proj-kb");
      }, { timeout: 5000 });

      // 2) Clicking "Set as start" on the peer that is ALREADY start moves selected back to that start node.
      const setStartBackBtn = document.querySelector<HTMLButtonElement>(
        '.panel-host-coded [data-relation-kind="projection.binds-target"] .sdk-object-relations-set-start',
      )!;
      expect(setStartBackBtn).not.toBeNull();
      setStartBackBtn.click();

      await vi.waitFor(() => {
        const subject = document.querySelector(".panel-host-coded .sdk-object-relations-subject")?.textContent?.trim();
        expect(subject).toBe("Knowledge List");
      }, { timeout: 5000 });

      // 3) Agent setting start+selected live on an already-mounted panel also preserves selected.
      host.applyState({
        start: { className: ACTION, primaryKey: "act-refund-1" },
        selected: { className: OBJECT_TYPE, primaryKey: "Order" },
      });
      await vi.waitFor(() => {
        expect(document.querySelector(".panel-host-coded .sdk-object-relations-subject")?.textContent?.trim()).toBe("Order");
        expect(document.querySelector(".panel-host-coded [data-cap-start-label]")?.textContent?.trim()).toBe("Refund Order");
        expect(document.querySelector(".panel-host-coded [data-cap-start-detail]")?.textContent?.trim()).toBe("Action · act-refund-1");
      }, { timeout: 5000 });

      // 4) Switching to a second same-name start object keeps them distinguishable via startDetail even when selected === start.
      host.applyState({
        start: { className: ACTION, primaryKey: "act-refund-2" },
        selected: { className: ACTION, primaryKey: "act-refund-2" },
      });
      await vi.waitFor(() => {
        expect(document.querySelector(".panel-host-coded [data-cap-start-label]")?.textContent?.trim()).toBe("Refund Order");
        expect(document.querySelector(".panel-host-coded [data-cap-start-detail]")?.textContent?.trim()).toBe("Action · act-refund-2");
      }, { timeout: 5000 });

      // 5) typePicker renders four layer option groups via generic groupBy="layer".
      (document.querySelector(".panel-host-coded .sdk-inline-reference-picker-select") as HTMLElement).click();
      await vi.waitFor(() => {
        const titles = [...document.querySelectorAll<HTMLElement>(".el-select-group__title")].map((el) =>
          el.textContent?.trim(),
        );
        expect(titles).toEqual(["Fact", "Capability", "Governance", "Product"]);
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });

  it("exposes visibleLayers, expandedNodes, pickingStart, showUserPicker, search states, and collapsed relation-kind tags with inline clear", { timeout: 30000 }, async () => {
    const { app, host, sent } = await mountBuiltinWithHost({ mode: "type", view: "graph" });
    try {
      await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBeGreaterThan(0), { timeout: 5000 });

      // 1) Collapsed relation-kind filter shows localized selected kind tags from graph.visibleRelationKindLabels and inline clear.
      host.applyState({
        relationKinds: [{ className: ONTOLOGY_RELATION_KIND, primaryKey: "action.targets-object-type" }],
      });
      await vi.waitFor(() => {
        const labels = [...document.querySelectorAll<HTMLElement>(".panel-host-coded [data-cap-relation-kind-label]")].map((el) =>
          el.textContent?.trim(),
        );
        expect(labels).toEqual(["Targets object type"]);
        expect(document.querySelector('.panel-host-coded [data-cap-action="clear-relation-kinds-inline"]')).not.toBeNull();
      }, { timeout: 5000 });

      document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="clear-relation-kinds-inline"]')!.click();
      await vi.waitFor(() => {
        expect(document.querySelectorAll(".panel-host-coded [data-cap-relation-kind-label]")).toHaveLength(0);
        expect(document.querySelector('.panel-host-coded [data-cap-action="clear-relation-kinds-inline"]')).toBeNull();
      }, { timeout: 5000 });

      // 2) Agent controls visibleLayers in type mode.
      host.applyState({ visibleLayers: ["fact"] });
      await vi.waitFor(() => {
        expect(canvasRecorder.nodes.every((node) => node.category === "fact")).toBe(true);
      }, { timeout: 5000 });
      host.applyState({ visibleLayers: null });
      await vi.waitFor(() => {
        expect(new Set(canvasRecorder.nodes.map((node) => node.category)).size).toBeGreaterThan(1);
      }, { timeout: 5000 });

      // 3) Agent controls pickingStart and typeObjectsSearch in type mode.
      host.applyState({ pickingStart: true, selectedType: ACTION, typeObjectsSearch: "Refund" });
      await vi.waitFor(() => {
        expect(
          reads(sent).some(
            (r) =>
              r.memberPath[0].member === "typeObjects"
              && r.dataName === "objects"
              && r.inputs.type === ACTION
              && (r.inputs.search === "Refund" || r.runtimeParams?.search === "Refund"),
          ),
        ).toBe(true);
      }, { timeout: 5000 });

      // 4) Agent controls showUserPicker, userPickerSearch, and expandedNodes in instance mode.
      host.applyState({
        mode: "instance",
        start: { className: USER, primaryKey: "u-1" },
        showUserPicker: true,
        userPickerSearch: "Alice",
        expandedNodes: [{ className: ACTION, primaryKey: "act-refund-1" }],
      });
      await vi.waitFor(() => {
        expect(
          reads(sent).some(
            (r) =>
              r.memberPath[0].member === "userPicker"
              && r.dataName === "objects"
              && (r.inputs.search === "Alice" || r.runtimeParams?.search === "Alice"),
          ),
        ).toBe(true);
        expect(canvasRecorder.nodes.map((n) => n.label)).toContain("Order");
      }, { timeout: 5000 });

      // 5) relationKindsSearch filters relationKindFilter via declared public state.
      host.applyState({ mode: "type", view: "graph", relationKindsSearch: "Binds" });
      await vi.waitFor(() => {
        const trigger = document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="relation-kind-filter"]');
        expect(trigger).not.toBeNull();
      }, { timeout: 5000 });
      document.querySelector<HTMLButtonElement>('.panel-host-coded [data-cap-action="relation-kind-filter"]')!.click();
      await vi.waitFor(() => {
        const list = document.querySelector(".capmap-kind-popover-list");
        expect(list?.textContent).toContain("Binds target");
        expect(list?.textContent).not.toContain("Uses component");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });
});
