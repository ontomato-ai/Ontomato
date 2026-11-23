import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  ACTION,
  ONTOLOGY_TYPE,
  ROLE,
  USER,
  WORKFLOW,
  platformOntologyLayers,
} from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges,
  inside,
  installPlatform,
  leaveFrame,
  nothingAt,
  panelFrame,
  panelRecord,
  panelUse,
  registered,
  writePanelDocument,
  type Sent,
} from "./panel-frame";

/*
 * Real host-and-bridge tests for M3/M4 shared controls:
 * 1. ObjectRelations: groups 1-hop neighbors by relation kind, renders direction & solid/dashed semantics, separates
 *    empty / owner-refused / read-failed / unavailable statuses, and writes complete { className, primaryKey } on peer
 *    click while keeping pageContext.selection named with localized type + label + identity.
 * 2. ObjectList dynamic `type` mode: prompts with zero queries when type is unset, queries { objectType, search, page },
 *    resets search & paging on type change, separates refused / failed / unavailable statuses (hiding count & paging),
 *    writes complete { className, primaryKey } to `outputs.selected` without touching `inputs.type`, and matches
 *    selection by full (className, primaryKey) across types sharing a primary key.
 * 3. SegmentedControl: unbound scalar state switcher (no bindsElement in catalogue), reads/writes declared scalar panel
 *    state with panel.t labels and keyboard navigation, making no platform requests.
 */

const current = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
};

const ontologySource = { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } } as const;
const allLayers = [...platformOntologyLayers] as [typeof platformOntologyLayers[number], ...typeof platformOntologyLayers[number][]];
const nodeType = { kind: "object-union" as const, layers: allLayers };

function hostWith(
  projections: readonly ProductProjection[],
  extra?: (request: Sent) => Response | Promise<Response> | undefined,
) {
  const byId = Object.fromEntries(projections.map((item) => [item.id, item]));
  return async (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && byId[match[1]!]) return Response.json({ projection: byId[match[1]!] });
    const handled = await extra?.(request);
    if (handled) return handled;
    return nothingAt(request);
  };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("renders ObjectRelations grouped by relation kind with distinct statuses and writes full identity on peer click", async () => {
  const relProj: ProductProjection = {
    ...current, id: "node-relations", name: "Node Relations", description: "",
    componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: nodeType }, outputs: { selected: nodeType }, config: {},
    data: { neighbors: { source: ontologySource, read: "neighbors", params: { node: { input: "selected" } } } },
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
    },
    members: {
      relations: {
        target: { projectionId: relProj.id },
        inputs: { selected: { state: "selected" } },
        outputs: { selected: { state: "selected" } },
      },
    },
  });
  const panel = panelRecord("panel-node-relations", "Node Relations", manifest);
  panel.content.html = `<div id="app"><Projection slot="relations"></Projection></div>`;
  const use = panelUse("use-node-relations", "node-relations", panel.id, "/ontology/assets/relations");

  const neighborCalls: Array<{ className: string; primaryKey: string }> = [];
  installPlatform(hostWith([relProj], (request) => {
    if (request.path !== "/api/platform-ontology/neighbors") return undefined;
    const { node } = request.body as { node: { className: string; primaryKey: string } };
    neighborCalls.push({ ...node });
    if (node.className === USER && node.primaryKey === "u-1") {
      return Response.json({
        node: { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" },
        neighbors: [
          { className: ROLE, primaryKey: "r-admin", label: "Platform Admin", layer: "governance" },
          { className: ACTION, primaryKey: "act-deploy", label: "Deploy Release", layer: "capability" },
        ],
        edges: [
          {
            id: "e-role",
            relationKind: "user.holds-role",
            from: { className: USER, primaryKey: "u-1" },
            to: { className: ROLE, primaryKey: "r-admin" },
            direction: "outgoing",
            derived: false,
          },
          {
            id: "e-act",
            relationKind: "user.created-action",
            from: { className: USER, primaryKey: "u-1" },
            to: { className: ACTION, primaryKey: "act-deploy" },
            direction: "outgoing",
            derived: true,
          },
        ],
        relations: [
          { relationKind: "user.holds-role", status: "ok", edgeCount: 1 },
          { relationKind: "user.created-action", status: "ok", edgeCount: 1 },
          { relationKind: "user.created-workflow", status: "ok", edgeCount: 0 },
          { relationKind: "role.can-execute-action", status: "refused", edgeCount: 0, reason: "Missing grants:read" },
          { relationKind: "agent.executes-as-user", status: "failed", edgeCount: 0, reason: "Assistant timeout" },
          { relationKind: "user.published-metric-view", status: "unavailable", edgeCount: 0, reason: "Pending M4" },
        ],
      });
    }
    return Response.json({
      node: { className: node.className, primaryKey: node.primaryKey, label: "Deploy Release", layer: "capability" },
      neighbors: [{ className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" }],
      edges: [
        {
          id: "e-back",
          relationKind: "user.created-action",
          from: { className: USER, primaryKey: "u-1" },
          to: { className: ACTION, primaryKey: "act-deploy" },
          direction: "incoming",
          derived: true,
        },
      ],
      relations: [{ relationKind: "user.created-action", status: "ok", edgeCount: 1 }],
    });
  }));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, {});
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // No selection -> prompt shown, zero neighbor reads
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-relations-prompt")).not.toBeNull());
  expect(neighborCalls).toHaveLength(0);

  // Select Alice -> loads grouped relations with all 4 distinct statuses & line/direction semantics
  mounted.context.instance.state.set("selected", { className: USER, primaryKey: "u-1" });
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-relations-group")).toHaveLength(6));

  expect(document.querySelector('[data-relation-kind="user.holds-role"] [data-line="solid"]')).not.toBeNull();
  expect(document.querySelector('[data-relation-kind="user.created-action"] [data-line="dashed"]')).not.toBeNull();
  expect(document.querySelector('[data-relation-kind="user.holds-role"] [data-direction="outgoing"]')).not.toBeNull();

  // Four distinct non-edge statuses never collapsed into one
  expect(document.querySelector('[data-relation-kind="user.created-workflow"]')?.getAttribute("data-status")).toBe("empty");
  expect(document.querySelector('[data-relation-kind="role.can-execute-action"]')?.getAttribute("data-status")).toBe("refused");
  expect(document.querySelector('[data-relation-kind="role.can-execute-action"]')?.textContent).toContain("Missing grants:read");
  expect(document.querySelector('[data-relation-kind="agent.executes-as-user"]')?.getAttribute("data-status")).toBe("failed");
  expect(document.querySelector('[data-relation-kind="agent.executes-as-user"]')?.textContent).toContain("Assistant timeout");
  expect(document.querySelector('[data-relation-kind="user.published-metric-view"]')?.getAttribute("data-status")).toBe("unavailable");
  expect(document.querySelector('[data-relation-kind="user.published-metric-view"]')?.textContent).toContain("Pending M4");

  // Click peer node ("Deploy Release") -> writes complete { className: platform:Action, primaryKey: act-deploy }
  const actionPeerBtn = document.querySelector<HTMLButtonElement>(
    '[data-relation-kind="user.created-action"] .sdk-object-relations-peer',
  )!;
  actionPeerBtn.click();

  await vi.waitFor(() => {
    expect(mounted.context.instance.state.values.value.selected).toEqual({
      className: ACTION,
      primaryKey: "act-deploy",
    });
  });
  await vi.waitFor(() => expect(neighborCalls).toHaveLength(2));
  expect(neighborCalls[1]).toEqual({ className: ACTION, primaryKey: "act-deploy" });
  await vi.waitFor(() => expect(document.querySelector('[data-direction="incoming"]')).not.toBeNull());

  // pageContext.selection names the selected object-union node with localized type + owner label + identity
  expect(mounted.context.instance.pageContext.value.selection).toEqual([
    {
      kind: ACTION,
      id: "act-deploy",
      label: expect.stringContaining(`Deploy Release (${ACTION} act-deploy)`),
    },
  ]);
});

it("supports dynamic type queries, status separation, search/paging reset and full identity selection in ObjectList", async () => {
  const pickerProj: ProductProjection = {
    ...current, id: "type-object-picker", name: "Type Object Picker", description: "",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: { type: { kind: "scalar", type: "string" } },
    outputs: { selected: nodeType },
    config: { pageSize: 2 },
    data: {
      objects: { source: ontologySource, read: "objects", params: { type: { input: "type" } } },
    },
  };
  const manifest = definePanel({
    state: {
      selectedType: { type: { kind: "scalar", type: "string" }, deepLink: false },
      start: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
    },
    members: {
      picker: {
        target: { projectionId: pickerProj.id },
        inputs: { type: { state: "selectedType" } },
        outputs: { selected: { state: "start" } },
      },
    },
  });
  const panel = panelRecord("panel-type-picker", "Type Object Picker", manifest);
  panel.content.html = `<div id="app"><Projection slot="picker"></Projection></div>`;
  panel.content.messages = { en: { "picker.selectType": "Choose a type from the graph" } };
  const use = panelUse("use-type-picker", "type-picker", panel.id, "/ontology/assets/picker");

  const queries: Array<{ objectType?: string; search?: string; offset?: number; limit?: number }> = [];
  installPlatform(hostWith([pickerProj], (request) => {
    if (request.path !== "/api/platform-ontology/objects") return undefined;
    const body = request.body as { type: string; keyword?: string; page?: number; pageSize?: number };
    const pageSize = body.pageSize ?? 20;
    const page = body.page ?? 1;
    const offset = (page - 1) * pageSize;
    queries.push({
      objectType: body.type,
      search: body.keyword,
      offset,
      limit: pageSize,
    });
    if (body.type === ROLE) {
      return Response.json({
        type: ROLE,
        layer: "governance",
        status: "refused",
        reason: "No role permission",
        items: [],
        total: 0,
        page,
        pageSize,
      });
    }
    if (body.type === USER) {
      return Response.json({
        type: USER,
        layer: "governance",
        status: "failed",
        reason: "Identity service 503",
        items: [],
        total: 0,
        page,
        pageSize,
      });
    }
    if (body.type === "platform:Definition") {
      return Response.json({
        type: "platform:Definition",
        layer: "capability",
        status: "unavailable",
        reason: "Owner not connected",
        items: [],
        total: 0,
        page,
        pageSize,
      });
    }
    if (body.type === WORKFLOW) {
      // Shares primaryKey "shared-1" with ACTION to verify full (className, primaryKey) selection matching
      return Response.json({
        type: WORKFLOW,
        layer: "capability",
        status: "ok",
        items: [{ node: { className: WORKFLOW, primaryKey: "shared-1" }, label: "Nightly Flow" }],
        total: 1,
        page,
        pageSize,
      });
    }
    const all = [
      { node: { className: ACTION, primaryKey: "shared-1" }, label: "Deploy Action" },
      { node: { className: ACTION, primaryKey: "act-2" }, label: "Rollback Action" },
      { node: { className: ACTION, primaryKey: "act-3" }, label: "Audit Action" },
    ].filter((item) => !body.keyword || item.label.toLowerCase().includes(body.keyword.toLowerCase()));
    return Response.json({
      type: body.type,
      layer: "capability",
      status: "ok",
      items: all.slice(offset, offset + pageSize),
      total: all.length,
      page,
      pageSize,
    });
  }));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, {});
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // 1) No type selected yet -> DataState awaiting shown, zero queries, no count/pagination
  await vi.waitFor(() => {
    const status = document.querySelector('[data-state="awaiting"]');
    expect(status?.textContent).toContain("Select an item first");
  });
  expect(queries).toHaveLength(0);
  expect(document.querySelector(".sdk-object-list-count")).toBeNull();
  expect(document.querySelector(".sdk-object-list-pagination")).toBeNull();

  // 2) Select ACTION -> queries page 1 with objectType, renders 2 items + count + pagination
  mounted.context.instance.state.set("selectedType", ACTION);
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(2));
  expect(queries[0]).toEqual({ objectType: ACTION, search: undefined, offset: 0, limit: 2 });
  expect(document.querySelector(".sdk-object-list-count")?.textContent).toContain("3");
  expect(document.querySelector(".sdk-object-list-pagination")).not.toBeNull();

  // 3) Advance to page 2 -> offset=2
  document.querySelector<HTMLButtonElement>(".sdk-object-list-next")!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-list-item-btn")).toHaveLength(1));
  expect(queries[1]).toEqual({ objectType: ACTION, search: undefined, offset: 2, limit: 2 });

  // 4) Search resets to page 1 and filters by keyword
  const searchInput = document.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
  searchInput.value = "deploy";
  searchInput.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(queries).toHaveLength(3));
  expect(queries[2]).toEqual({ objectType: ACTION, search: "deploy", offset: 0, limit: 2 });
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-list-item-btn")?.textContent).toContain("Deploy Action"));

  // 5) Clicking item writes complete { className: ACTION, primaryKey: shared-1 } to `start`, keeping `selectedType` intact
  document.querySelector<HTMLButtonElement>(".sdk-object-list-item-btn")!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.start).toEqual({
    className: ACTION,
    primaryKey: "shared-1",
  });
  expect(mounted.context.instance.state.values.value.selectedType).toBe(ACTION);
  // pageContext.selection finds object label registered under ACTION (not ONTOLOGY_TYPE)
  expect(mounted.context.instance.pageContext.value.selection).toEqual([
    {
      kind: ACTION,
      id: "shared-1",
      label: expect.stringContaining(`Deploy Action (${ACTION} shared-1)`),
    },
  ]);

  // 6) Switch to WORKFLOW (same primaryKey "shared-1"): resets search & paging, does NOT mis-highlight WORKFLOW/shared-1
  mounted.context.instance.state.set("selectedType", WORKFLOW);
  await vi.waitFor(() => expect(queries).toHaveLength(4));
  expect(queries[3]).toEqual({ objectType: WORKFLOW, search: undefined, offset: 0, limit: 2 });
  expect(searchInput.value).toBe("");
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-list-item-btn")?.textContent).toContain("Nightly Flow"));
  expect(document.querySelector(".sdk-object-list-item-btn")?.getAttribute("aria-selected")).toBe("false");

  // 7) Distinct refused / failed / unavailable statuses hide count & pagination and never collapse to empty
  mounted.context.instance.state.set("selectedType", ROLE);
  await vi.waitFor(() => expect(document.querySelector('[data-status="refused"]')).not.toBeNull());
  expect(document.querySelector('[data-status="refused"]')?.textContent).toContain("No role permission");
  expect(document.querySelector(".sdk-object-list-count")).toBeNull();
  expect(document.querySelector(".sdk-object-list-pagination")).toBeNull();

  mounted.context.instance.state.set("selectedType", USER);
  await vi.waitFor(() => expect(document.querySelector('[data-status="failed"]')).not.toBeNull());
  expect(document.querySelector('[data-status="failed"]')?.textContent).toContain("Identity service 503");

  mounted.context.instance.state.set("selectedType", "platform:Definition");
  await vi.waitFor(() => expect(document.querySelector('[data-status="unavailable"]')).not.toBeNull());
  expect(document.querySelector('[data-status="unavailable"]')?.textContent).toContain("Owner not connected");
});

it("switches declared scalar panel state with SegmentedControl (unbound in catalogue, keyboard & i18n)", async () => {
  const { components } = await import("../../../../../packages/apps-sdk/src/catalogue");
  const meta = components.find((item) => item.componentId === "SegmentedControl");
  expect(meta).toBeDefined();
  expect(meta?.bindsElement).toBeUndefined();
  expect(meta?.role).toBe("control");
  expect(meta?.outputs).toEqual({ value: { kind: "scalar", type: "string" } });

  const manifest = definePanel({
    state: {
      mode: { type: { kind: "scalar", type: "string" }, deepLink: true },
    },
    members: {},
  });
  const panel = panelRecord("panel-segmented", "Mode Switcher", manifest);
  panel.content.html = `
    <div id="app">
      <segmented-control
        state="mode"
        default-value="type"
        aria-label="Graph mode"
        :options="[
          { value: 'type', labelKey: 'mode.type' },
          { value: 'instance', labelKey: 'mode.instance' },
        ]"
      ></segmented-control>
    </div>
  `;
  panel.content.messages = {
    en: {
      "mode.type": "Type view",
      "mode.instance": "Instance view",
    },
  };
  const use = panelUse("use-segmented", "segmented-test", panel.id, "/ontology/assets/segmented");

  installPlatform(hostWith([]));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, {});
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  await vi.waitFor(() => expect(document.querySelectorAll('[role="radio"]')).toHaveLength(2));
  const radios = document.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  expect(radios[0]!.textContent?.trim()).toBe("Type view");
  expect(radios[1]!.textContent?.trim()).toBe("Instance view");
  expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
  expect(radios[1]!.getAttribute("aria-checked")).toBe("false");

  // Click switches declared scalar state
  radios[1]!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.mode).toBe("instance");
  expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
  expect(radios[0]!.getAttribute("aria-checked")).toBe("false");

  // Keyboard ArrowLeft switches back
  radios[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  await nextTick();
  expect(mounted.context.instance.state.values.value.mode).toBe("type");
  expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
});
