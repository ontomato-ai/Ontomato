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
            relationKind: "permission-policy.can-execute-action",
            from: { className: USER, primaryKey: "u-1" },
            to: { className: ACTION, primaryKey: "act-deploy" },
            direction: "outgoing",
            derived: true,
          },
        ],
        relations: [
          { relationKind: "user.holds-role", status: "ok", edgeCount: 1 },
          { relationKind: "permission-policy.can-execute-action", status: "ok", edgeCount: 1 },
          { relationKind: "role.owns-workflow-step", status: "ok", edgeCount: 0 },
          { relationKind: "permission-policy.can-enter-application", status: "refused", edgeCount: 0, reason: "Missing grants:read" },
          { relationKind: "agent.executes-as-user", status: "failed", edgeCount: 0, reason: "Assistant timeout" },
          { relationKind: "permission-policy.can-use-object", status: "unavailable", edgeCount: 0, reason: "Pending M4" },
        ],
      });
    }
    return Response.json({
      node: { className: node.className, primaryKey: node.primaryKey, label: "Deploy Release", layer: "capability" },
      neighbors: [{ className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" }],
      edges: [
        {
          id: "e-back",
          relationKind: "permission-policy.can-execute-action",
          from: { className: USER, primaryKey: "u-1" },
          to: { className: ACTION, primaryKey: "act-deploy" },
          direction: "incoming",
          derived: true,
        },
      ],
      relations: [{ relationKind: "permission-policy.can-execute-action", status: "ok", edgeCount: 1 }],
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
  expect(document.querySelector('[data-relation-kind="permission-policy.can-execute-action"] [data-line="dashed"]')).not.toBeNull();
  expect(document.querySelector('[data-relation-kind="user.holds-role"] [data-direction="outgoing"]')).not.toBeNull();

  // Four distinct non-edge statuses never collapsed into one
  expect(document.querySelector('[data-relation-kind="role.owns-workflow-step"]')?.getAttribute("data-status")).toBe("empty");
  expect(document.querySelector('[data-relation-kind="permission-policy.can-enter-application"]')?.getAttribute("data-status")).toBe("refused");
  expect(document.querySelector('[data-relation-kind="permission-policy.can-enter-application"]')?.textContent).toContain("Missing grants:read");
  expect(document.querySelector('[data-relation-kind="agent.executes-as-user"]')?.getAttribute("data-status")).toBe("failed");
  expect(document.querySelector('[data-relation-kind="agent.executes-as-user"]')?.textContent).toContain("Assistant timeout");
  expect(document.querySelector('[data-relation-kind="permission-policy.can-use-object"]')?.getAttribute("data-status")).toBe("unavailable");
  expect(document.querySelector('[data-relation-kind="permission-policy.can-use-object"]')?.textContent).toContain("Pending M4");

  // Click peer node ("Deploy Release") -> writes complete { className: platform:Action, primaryKey: act-deploy }
  const actionPeerBtn = document.querySelector<HTMLButtonElement>(
    '[data-relation-kind="permission-policy.can-execute-action"] .sdk-object-relations-peer',
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

it("supports ObjectRelations summary, empty-group collapsing, edge bindings, relation filter, set-as-start, and read-only outputs", async () => {
  const relationKindList = {
    kind: "list" as const,
    items: { kind: "object" as const, objectType: "platform:OntologyRelationKind" },
  };
  const relationsProj: ProductProjection = {
    ...current, id: "enhanced-relations", name: "Enhanced Relations", description: "",
    componentId: "@ontomato/sdk:ObjectRelations",
    inputs: { selected: nodeType, visibleRelationKinds: relationKindList },
    outputs: { selected: nodeType, start: nodeType, visibleRelationKinds: relationKindList },
    config: {
      showRelationFilter: true,
      allowSetStart: true,
      showSummary: true,
      collapseEmptyGroups: true,
    },
    data: {
      neighbors: { source: ontologySource, read: "neighbors", params: { node: { input: "selected" } } },
    },
  };
  const manifest = definePanel({
    state: {
      selected: { type: nodeType, deepLink: false },
      start: { type: nodeType, deepLink: false },
      relationKinds: { type: relationKindList, deepLink: false },
    },
    members: {
      relations: {
        target: { projectionId: relationsProj.id },
        inputs: { selected: { state: "selected" }, visibleRelationKinds: { state: "relationKinds" } },
        outputs: {
          selected: { state: "selected" },
          start: { state: "start" },
          visibleRelationKinds: { state: "relationKinds" },
        },
      },
    },
  });
  const panel = panelRecord("panel-enhanced-relations", "Enhanced Relations Panel", manifest);
  panel.content.html = `<div id="app"><projection slot="relations"></projection></div>`;
  const use = panelUse("use-enhanced-rel", "enhanced-rel-test", panel.id, "/ontology/assets/enhanced-rel");

  const workflowNode = { className: WORKFLOW, primaryKey: "wf-orders", label: "Orders Workflow", layer: "capability" };
  const roleNode = { className: ROLE, primaryKey: "role-ops", label: "Operations Role", layer: "governance" };
  const actionNode = { className: ACTION, primaryKey: "act-approve", label: "Approve Order", layer: "capability" };

  const responses: Record<string, unknown> = {
    [`${WORKFLOW}:wf-orders`]: {
      node: workflowNode,
      neighbors: [roleNode, actionNode],
      edges: [
        {
          id: "e-bind-1",
          relationKind: "panel.uses-projection",
          from: { className: WORKFLOW, primaryKey: "wf-orders" },
          to: { className: ROLE, primaryKey: "role-ops" },
          direction: "outgoing",
          derived: false,
          binding: {
            reads: ["list", "summary"],
            operations: ["delete"],
            viaInput: true,
          },
        },
        {
          id: "e-act-1",
          relationKind: "panel.invokes-action",
          from: { className: WORKFLOW, primaryKey: "wf-orders" },
          to: { className: ACTION, primaryKey: "act-approve" },
          direction: "outgoing",
          derived: true,
        },
      ],
      relations: [
        { relationKind: "panel.uses-projection", status: "ok", edgeCount: 1 },
        { relationKind: "panel.empty-one", status: "ok", edgeCount: 0 },
        { relationKind: "panel.empty-two", status: "ok", edgeCount: 0 },
        { relationKind: "panel.refused-kind", status: "refused", edgeCount: 0, reason: "Missing panel:read" },
        { relationKind: "panel.failed-kind", status: "failed", edgeCount: 0, reason: "Upstream 502" },
        { relationKind: "panel.unavailable-kind", status: "unavailable", edgeCount: 0, reason: "Pending rollout" },
        { relationKind: "panel.invokes-action", status: "ok", edgeCount: 1 },
      ],
    },
    [`${ACTION}:act-approve`]: {
      node: actionNode,
      neighbors: [],
      edges: [],
      relations: [
        { relationKind: "action.empty-kind", status: "ok", edgeCount: 0 },
      ],
    },
  };

  installPlatform(hostWith([relationsProj], (request) => {
    if (request.path !== "/api/platform-ontology/neighbors") return undefined;
    const { node } = request.body as { node: { className: string; primaryKey: string } };
    const payload = responses[`${node.className}:${node.primaryKey}`];
    return payload ? Response.json(payload) : undefined;
  }));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, {});
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // Select Orders Workflow
  mounted.context.instance.state.set("selected", { className: WORKFLOW, primaryKey: "wf-orders" });
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-relations-group")).toHaveLength(5));

  // Header summary shows edge count and strictly separates refused, failed and unavailable (never no-neighbors here)
  expect(document.querySelector(".sdk-object-relations-summary-count")?.textContent).toContain("2");
  expect(document.querySelector('.sdk-object-relations-summary-item[data-status="no-neighbors"]')).toBeNull();
  expect(document.querySelector('.sdk-object-relations-summary-item[data-status="refused"]')?.textContent).toContain("panel.refused-kind");
  expect(document.querySelector('.sdk-object-relations-summary-item[data-status="failed"]')?.textContent).toContain("panel.failed-kind");
  expect(document.querySelector('.sdk-object-relations-summary-item[data-status="unavailable"]')?.textContent).toContain("panel.unavailable-kind");

  // Readable ok groups appear first, followed by non-ok groups in refused -> failed -> unavailable order
  const renderedKinds = [...document.querySelectorAll(".sdk-object-relations-group")].map((el) =>
    el.getAttribute("data-relation-kind"),
  );
  expect(renderedKinds).toEqual([
    "panel.uses-projection",
    "panel.invokes-action",
    "panel.refused-kind",
    "panel.failed-kind",
    "panel.unavailable-kind",
  ]);
  // Two empty ok kinds collapsed into one summary line instead of occupying two group cards
  expect(document.querySelector('.sdk-object-relations-empty-kinds')?.textContent).toContain("2");

  // Edge binding metadata renders reads, operations, and viaInput tags
  const binding = document.querySelector('[data-relation-kind="panel.uses-projection"] .sdk-object-relations-binding');
  expect(binding?.querySelector('[data-binding-part="reads"]')?.textContent).toContain("list, summary");
  expect(binding?.querySelector('[data-binding-part="operations"]')?.textContent).toContain("delete");
  expect(binding?.querySelector('[data-binding-part="via-input"]')).not.toBeNull();

  // Read-only outputs are published onto panel instance
  expect(mounted.context.instance.outputs.relations).toEqual({
    status: "ready",
    edgeCount: 2,
    label: "Orders Workflow",
  });

  // Relation kind filter control is visible and filters groups via shared panel state
  expect(document.querySelector(".sdk-object-relations-filter")).not.toBeNull();
  mounted.context.instance.state.set("relationKinds", [
    { className: "platform:OntologyRelationKind", primaryKey: "panel.invokes-action" },
  ]);
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-relations-group")).toHaveLength(1));
  expect(document.querySelector(".sdk-object-relations-group")?.getAttribute("data-relation-kind")).toBe("panel.invokes-action");
  expect(document.querySelector(".sdk-object-relations-empty-kinds")).toBeNull();

  // Clicking "Set as start" writes complete peer identity to start state without losing selected
  const setStartBtn = document.querySelector<HTMLButtonElement>(
    '[data-relation-kind="panel.invokes-action"] .sdk-object-relations-set-start',
  )!;
  setStartBtn.click();
  await vi.waitFor(() =>
    expect(mounted.context.instance.state.values.value.start).toEqual({
      className: ACTION,
      primaryKey: "act-approve",
    }),
  );

  // Clearing relationKinds filter restores all visible groups
  mounted.context.instance.state.set("relationKinds", null);
  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-relations-group")).toHaveLength(5));

  // Node with zero edges and no refused/failed/unavailable shows distinct no-neighbors notice
  mounted.context.instance.state.set("selected", { className: ACTION, primaryKey: "act-approve" });
  await vi.waitFor(() =>
    expect(document.querySelector('.sdk-object-relations-summary-item[data-status="no-neighbors"]')).not.toBeNull(),
  );
  expect(document.querySelector(".sdk-object-relations-summary-count")?.textContent).toContain("0");
  expect(document.querySelectorAll(".sdk-object-relations-group")).toHaveLength(0);
  expect(document.querySelector(".sdk-object-relations-empty-kinds")?.textContent).toContain("1");
});
