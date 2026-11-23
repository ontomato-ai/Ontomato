import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { PRODUCT_PANEL, PRODUCT_PROJECTION, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/projections/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/projections/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/projections/panel.mjs?raw";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const APP_ID = "ontology";
const ENTRY_PATH = "/ontology/projections";

const use = panelUse(
  "use-ontology-projections",
  "ontology-projections",
  "builtin-product-ontology-projections",
  ENTRY_PATH,
);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create");
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) {
      return [name, definition];
    }
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes },
      components: catalogue,
    });
    projections.set(definition.id!, {
      ...projection,
      id: definition.id!,
      name,
      description: name,
      visibility: "platform",
      domainId: null,
      ownerId: null,
      editable: false,
      revision: 1,
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const projectionsDirectoryPanel = {
  ...panelRecord(use.panelId, "Projections", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const projRef = (primaryKey: string) => ({ className: PRODUCT_PROJECTION, primaryKey });

interface ProjectionFixture {
  readonly id: string;
  readonly name: string;
  readonly canEdit: boolean;
  readonly canCopy: boolean;
  readonly canGrant: boolean;
  readonly canDelete: boolean;
  readonly isChart: boolean;
  readonly revision: number;
  readonly usedByPanels?: readonly { readonly id: string; readonly name: string }[];
  readonly hiddenUsedByCount?: number;
}

const FIXTURES: Record<string, ProjectionFixture> = {
  "proj-a": {
    id: "proj-a",
    name: "Projection A",
    canEdit: true,
    canCopy: true,
    canGrant: true,
    canDelete: true,
    isChart: false,
    revision: 3,
    usedByPanels: [
      { id: "panel-sales", name: "Sales Dashboard" },
      { id: "panel-ops", name: "Ops Overview" },
    ],
    hiddenUsedByCount: 1,
  },
  "proj-b": {
    id: "proj-b",
    name: "Projection B",
    canEdit: true,
    canCopy: true,
    canGrant: true,
    canDelete: true,
    isChart: false,
    revision: 2,
    usedByPanels: [],
    hiddenUsedByCount: 0,
  },
  "proj-chart": {
    id: "proj-chart",
    name: "Revenue Chart",
    canEdit: true,
    canCopy: false,
    canGrant: true,
    canDelete: true,
    isChart: true,
    revision: 4,
    usedByPanels: [],
  },
  "proj-readonly": {
    id: "proj-readonly",
    name: "Shared Projection",
    canEdit: false,
    canCopy: false,
    canGrant: false,
    canDelete: false,
    isChart: false,
    revision: 1,
    usedByPanels: [],
  },
  "owner-assigned-copy": {
    id: "owner-assigned-copy",
    name: "Owner Assigned Copy",
    canEdit: true,
    canCopy: true,
    canGrant: true,
    canDelete: true,
    isChart: false,
    revision: 1,
    usedByPanels: [],
  },
};

function previewStubProjection(id: string): ProductProjection {
  return {
    id,
    name: FIXTURES[id]?.name ?? id,
    description: "",
    visibility: "private",
    domainId: "domain-1",
    ownerId: "user-1",
    editable: FIXTURES[id]?.canEdit ?? false,
    revision: FIXTURES[id]?.revision ?? 1,
    componentId: "@ontomato/sdk:ObjectSummary",
    data: {},
    config: {},
    inputs: {},
    outputs: {},
    operations: {},
    createdAt: "2026-11-23T00:00:00Z",
    updatedAt: "2026-11-23T00:00:00Z",
  };
}

function selectedPrimaryKey(state: Record<string, unknown> | undefined): string | null {
  const value = state?.selected;
  if (value && typeof value === "object" && "primaryKey" in value && typeof (value as { primaryKey?: unknown }).primaryKey === "string") {
    return (value as { primaryKey: string }).primaryKey;
  }
  return null;
}

function presentFrame(state: Record<string, unknown>, address = ENTRY_PATH): PresentationFrame {
  return {
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: `call-${Math.random()}`,
    target: {
      kind: "page",
      address,
      state: state as PresentationFrame["target"] extends { state?: infer S } ? S : never,
    },
  };
}

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function formDescription(mode: "create" | "edit", key: string) {
  return {
    fields: [
      {
        path: "/name",
        label: "Name",
        required: true,
        readOnly: false,
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
    ],
    values: { name: mode === "create" ? "" : (FIXTURES[key]?.name ?? `Projection ${key}`) },
    errors: [],
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/product-projections/${key || "new"}`,
      bodySchema: {},
    },
  };
}

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

function readTargetKey(req: DataReadRequest): string {
  for (const value of Object.values(req.inputs ?? {})) {
    if (value && typeof value === "object" && "primaryKey" in value && typeof value.primaryKey === "string") {
      return value.primaryKey;
    }
  }
  return "";
}

function findButton(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

function setFormNameInput(root: HTMLElement, value: string) {
  const input = root.querySelector<HTMLInputElement>(".proj-form-wrap input");
  expect(input).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
}

interface MountOptions {
  confirmLeave?: () => Promise<boolean>;
  copyOutcome?: () => { kind: "success"; data: Record<string, unknown> };
  deleteOutcome?: (primaryKey: string) => { kind: "success"; data: Record<string, unknown> } | { kind: "refusal"; code: string; message: string };
}

async function mountProjectionsDirectory(options: MountOptions = {}) {
  const reads: DataReadRequest[] = [];
  const preparedIntents = new Map<string, { preparation: PanelHumanOperationPreparation; targetKey: string; input: Record<string, unknown> }>();
  const dispatchedIntents: Array<{ intentId: string; operationId: string; targetKey: string; input: Record<string, unknown> }> = [];
  let intentSeq = 0;
  const confirmLeaveUnsaved = vi.fn(async () => (options.confirmLeave ? options.confirmLeave() : true));

  const sent = installPlatform((request: Sent) => {
    const { method, path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${projectionsDirectoryPanel.id}`) {
      return panelAnswer(projectionsDirectoryPanel, request);
    }
    if (path === `/api/product-panels/${projectionsDirectoryPanel.id}/snapshot`) {
      return panelSnapshot(projectionsDirectoryPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      const id = path.split("/").at(-1)!;
      return Response.json({ projection: projections.get(id) ?? previewStubProjection(id) });
    }
    if (method === "POST" && path === "/api/panel-operations/intents") {
      const body = request.body as {
        operationId: string;
        call?: { target?: { primaryKey?: string } | null; input?: Record<string, unknown> };
      };
      const intentId = `22222222-2222-4222-8222-${String(++intentSeq).padStart(12, "0")}`;
      const targetKey = body.call?.target?.primaryKey ?? "";
      const input = body.call?.input ?? {};
      const fixture = FIXTURES[targetKey];
      let confirmation: PanelHumanOperationPreparation["confirmation"] = { kind: "none" };
      let label = "Run";
      if (body.operationId === "deleteProjection.delete") {
        label = "Delete";
        const panels = fixture?.usedByPanels ?? [];
        const hidden = fixture?.hiddenUsedByCount ?? 0;
        const total = panels.length + hidden;
        if (total > 0) {
          confirmation = {
            kind: "impact",
            impact: {
              objects: panels.map((panel) => ({
                target: { objectType: PRODUCT_PANEL, primaryKey: panel.id },
                label: panel.name,
              })),
              total,
              summary: `"${fixture?.name ?? targetKey}" is used by these panels and deletion will be refused. ${hidden ? `${hidden} additional panel(s) you cannot view also reference it.` : ""}`.trim(),
            },
          };
        } else {
          confirmation = {
            kind: "impact",
            impact: {
              objects: [{ target: { objectType: PRODUCT_PROJECTION, primaryKey: targetKey }, label: fixture?.name ?? targetKey }],
              total: 1,
              summary: `Delete projection "${fixture?.name ?? targetKey}"? This action cannot be undone.`,
            },
          };
        }
      } else if (body.operationId === "copySubmit.copy") {
        label = "Copy";
      }
      const preparation: PanelHumanOperationPreparation = {
        intentId,
        operationId: body.operationId,
        label,
        confirmation,
      };
      preparedIntents.set(intentId, { preparation, targetKey, input });
      return Response.json(preparation);
    }
    if (method === "GET" && path.startsWith("/api/panel-operation-intents/")) {
      const intentId = path.split("/").at(-1)!;
      const stored = preparedIntents.get(intentId);
      if (stored) return Response.json(stored.preparation);
    }
    if (method === "POST" && /^\/api\/panel-operations\/intents\/[^/]+\/dispatch$/.test(path)) {
      const intentId = path.split("/").at(-2)!;
      const stored = preparedIntents.get(intentId)!;
      dispatchedIntents.push({
        intentId,
        operationId: stored.preparation.operationId,
        targetKey: stored.targetKey,
        input: stored.input,
      });
      if (stored.preparation.operationId === "deleteProjection.delete") {
        const outcome = options.deleteOutcome
          ? options.deleteOutcome(stored.targetKey)
          : { kind: "success" as const, data: { id: stored.targetKey } };
        return Response.json({ kind: "dispatched", intentId, outcome });
      }
      if (stored.preparation.operationId === "copySubmit.copy") {
        const outcome = options.copyOutcome
          ? options.copyOutcome()
          : { kind: "success" as const, data: { id: "owner-assigned-copy" } };
        return Response.json({ kind: "dispatched", intentId, outcome });
      }
      return Response.json({ kind: "dispatched", intentId, outcome: { kind: "success", data: {} } });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        const member = body.memberPath[0]?.member;
        if (member === "deleteProjection") {
          return Response.json({
            status: "ready",
            value: {
              delete: {
                handlerRef: "productProjections.delete",
                label: "Delete",
                kind: "action",
                effect: "write",
                batch: false,
                target: { source: "input", input: "target" },
                inputSchema: { type: "object", properties: { revision: { type: "number" } }, required: ["revision"] },
                resultSchema: {},
              },
            },
          });
        }
        if (member === "copySubmit") {
          return Response.json({
            status: "ready",
            value: {
              copy: {
                handlerRef: "productProjections.copy",
                label: "Copy",
                kind: "action",
                effect: "write",
                batch: false,
                target: { source: "input", input: "target" },
                inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] },
                resultSchema: {},
              },
            },
          });
        }
        if (member === "grantSubmit") {
          return Response.json({
            status: "ready",
            value: {
              grant: {
                handlerRef: "productProjections.grant",
                label: "Grant",
                kind: "action",
                effect: "write",
                batch: false,
                target: { source: "input", input: "target" },
                inputSchema: { type: "object", properties: {} },
                resultSchema: {},
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      reads.push(body);
      const member = body.memberPath[0]?.member;
      if (member === "catalogue") {
        return Response.json({
          status: "ready",
          value: {
            rows: [FIXTURES["proj-a"]!, FIXTURES["proj-b"]!, FIXTURES["proj-chart"]!, FIXTURES["proj-readonly"]!].map((item) => ({
              primaryKey: item.id,
              label: item.name,
              subtitle: item.id,
              fields: { component: "ObjectSummary", owner: "Alice", scope: "Private", updatedAt: "2026-11-23T00:00:00Z" },
            })),
            total: 4,
          },
        });
      }
      if (member === "headerTitle" || member === "summary" || member === "definitionSummary" || member === "shareStatusDesc") {
        const key = readTargetKey(body);
        const fixture = FIXTURES[key];
        if (!fixture) return Response.json({ status: "empty" });
        return Response.json({
          status: "ready",
          value: {
            primaryKey: fixture.id,
            label: fixture.name,
            subtitle: fixture.id,
            fields: {
              id: fixture.id,
              component: fixture.isChart ? "MetricChart" : "ObjectSummary",
              scope: "Private",
              owner: "Alice",
              revision: fixture.revision,
              domainShared: false,
              definitionJson: JSON.stringify({ id: fixture.id }),
            },
            fieldLabels: { id: "ID", component: "Component", scope: "Scope", owner: "Owner", revision: "Revision" },
            outputs: {
              canEdit: fixture.canEdit,
              canGrant: fixture.canGrant,
              canDelete: fixture.canDelete,
              canCopy: fixture.canCopy,
              isBuiltin: false,
              isChart: fixture.isChart,
              domainShared: false,
              revision: fixture.revision,
              usedByCount: (fixture.usedByPanels?.length ?? 0) + (fixture.hiddenUsedByCount ?? 0),
              hiddenUsedByCount: fixture.hiddenUsedByCount ?? 0,
            },
          },
        });
      }
      if (member === "userPicker" || member === "rolePicker") {
        if (body.dataName === "options") {
          return Response.json({ status: "ready", value: { options: [], total: 0 } });
        }
        return Response.json({ status: "empty" });
      }
      if (member === "form") {
        const key = readTargetKey(body);
        if (body.dataName === "createForm") {
          return Response.json({ status: "ready", value: formDescription("create", "") });
        }
        return Response.json({ status: "ready", value: formDescription("edit", key) });
      }
      if (
        member === "dataList"
        || member === "configList"
        || member === "inputsList"
        || member === "outputsList"
        || member === "operationsList"
        || member === "usedByList"
        || member === "grantsList"
      ) {
        return Response.json({ status: "ready", value: [] });
      }
      return Response.json({ status: "ready", value: { rows: [], total: 0 } });
    }
    return nothingAt(request);
  });

  useApplicationCatalog().applications.value = [
    {
      id: APP_ID,
      kind: "product",
      names: { en: "Ontology" },
      descriptions: {},
      icon: "ontology",
      rail: "apps",
      category: "build",
      sort: 0,
      entry: { path: "/ontology", renderer: "panels" },
      entryAccess: ["domain-member"],
      scheduleAdapter: null,
      releaseId: null,
      panelUses: [use],
    },
  ];

  const observed = { context: null as { state?: Record<string, unknown> } | null };
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Projections", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path === ENTRY_PATH ? { featureId: "panel", address, instance: path } : null;
    },
    serialize: async () => true,
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || "Projections",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
    }),
    leave: { leaves: () => false, confirm: async () => true },
  });
  display.placed(() => "side");

  await display.present({
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: "open-initial",
    target: { kind: "page", address: ENTRY_PATH },
  });

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
  await router.push("/");

  const Host = defineComponent({
    setup() {
      provideUnsavedChanges(confirmLeaveUnsaved);
      return () =>
        display.page.value
          ? h(PanelApplicationRoute, {
              key: display.page.value.instance,
              applicationId: APP_ID,
              useId: use.id,
              address: display.page.value.address,
              liveState: display.liveState.value,
              registerPageController: (controller: unknown) =>
                display.registerPageController(display.page.value!.instance, controller as never),
              onDisplayAddress: display.address,
              onDisplayLoaded: display.loaded,
              onContext: (reported: { state?: Record<string, unknown> } | null) => {
                observed.context = reported;
                display.context(reported as never);
              },
            })
          : null;
    },
  });

  const mounted = mountPlatformPage(() => h(Host), router);
  await waitFor(
    () =>
      mounted.element.textContent?.includes("Projection A") === true
      && mounted.element.textContent?.includes("Projection B") === true,
    "initial projections list",
  );

  return {
    mounted,
    display,
    observed,
    reads,
    sent,
    dispatchedIntents,
    confirmLeaveUnsaved,
    present: (state: Record<string, unknown>) => display.present(presentFrame(state, display.page.value!.address)),
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("projections builtin directory R3 fixes", () => {
  it("guards dirty edit and create forms on list row switch and create button: cancel keeps draft, confirm switches to view mode", { timeout: 20000 }, async () => {
    let resolveConfirm: ((ok: boolean) => void) | null = null;
    const harness = await mountProjectionsDirectory({
      confirmLeave: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    const { mounted, observed, reads, confirmLeaveUnsaved, present } = harness;
    try {
      // Enter edit mode on Projection A.
      await present({ selected: projRef("proj-a"), detailMode: "edit" });
      await waitFor(
        () => (mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value ?? "") === "Projection A",
        "proj-a edit form loaded",
      );

      // Make an unsaved edit to Projection A.
      setFormNameInput(mounted.element, "Unsaved Projection A Draft");
      await waitFor(
        () => (mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value ?? "") === "Unsaved Projection A Draft",
        "unsaved edit applied",
      );

      // Click Projection B in the catalogue list -> must ask confirmation once without loading B's form.
      const readsBeforeClick = reads.length;
      const rowB = Array.from(mounted.element.querySelectorAll("tr")).find((tr) => tr.textContent?.includes("Projection B"));
      expect(rowB).toBeTruthy();
      rowB!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 1 && resolveConfirm !== null, "confirm leave dialog on row click");
      expect(
        reads.slice(readsBeforeClick).some((r) => r.memberPath[0]?.member === "form" && readTargetKey(r) === "proj-b"),
      ).toBe(false);
      expect(mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value).toBe("Unsaved Projection A Draft");

      // Cancel leaving -> stays in Projection A edit form with unsaved draft intact.
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(observed.context?.state?.selected).toEqual(projRef("proj-a"));
      expect(observed.context?.state?.detailMode).toBe("edit");
      expect(mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value).toBe("Unsaved Projection A Draft");

      // Clicking "New projection" while dirty also asks confirmation; cancel stays on Projection A draft.
      const createBtn = findButton(mounted.element, "New projection");
      expect(createBtn).toBeTruthy();
      createBtn!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 2 && resolveConfirm !== null, "confirm leave dialog on create button");
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(observed.context?.state?.selected).toEqual(projRef("proj-a"));
      expect(observed.context?.state?.creating ?? null).toBeNull();
      expect(mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value).toBe("Unsaved Projection A Draft");

      // Clicking "Close" in the form header while dirty also triggers confirmation; cancel keeps draft intact.
      const closeBtn = findButton(mounted.element, "Close");
      expect(closeBtn).toBeTruthy();
      closeBtn!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 3 && resolveConfirm !== null, "confirm leave dialog on close button");
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(observed.context?.state?.selected).toEqual(projRef("proj-a"));
      expect(observed.context?.state?.detailMode).toBe("edit");
      expect(mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value).toBe("Unsaved Projection A Draft");

      // Click Projection B again and confirm -> discards draft, exits edit mode, and views Projection B.
      rowB!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 4 && resolveConfirm !== null, "second confirm leave on row click");
      resolveConfirm!(true);
      resolveConfirm = null;

      await waitFor(
        () => !mounted.element.querySelector(".proj-form-wrap") && observed.context?.state?.detailMode === "view" && selectedPrimaryKey(observed.context?.state) === "proj-b",
        "switched to proj-b view mode after confirming discard",
      );

      // Now enter create mode, make an unsaved draft, click Projection A -> cancel keeps create draft, confirm views Projection A.
      findButton(mounted.element, "New projection")!.click();
      await waitFor(
        () => observed.context?.state?.creating === true && Boolean(mounted.element.querySelector(".proj-form-wrap input")),
        "create form mounted",
      );
      setFormNameInput(mounted.element, "New Draft Projection");
      await waitFor(
        () => (mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value ?? "") === "New Draft Projection",
        "create draft typed",
      );

      const rowA = Array.from(mounted.element.querySelectorAll("tr")).find((tr) => tr.textContent?.includes("Projection A"));
      rowA!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 5 && resolveConfirm !== null, "confirm leave on create draft row switch");
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(observed.context?.state?.creating).toBe(true);
      expect(observed.context?.state?.selected ?? null).toBeNull();
      expect(mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value).toBe("New Draft Projection");

      rowA!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 6 && resolveConfirm !== null, "confirm discard on create draft row switch");
      resolveConfirm!(true);
      resolveConfirm = null;
      await waitFor(
        () => !mounted.element.querySelector(".proj-form-wrap") && observed.context?.state?.creating === null && selectedPrimaryKey(observed.context?.state) === "proj-a",
        "switched to proj-a view mode after discarding create draft",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("deletes via owner inspectImpact confirmation dialog showing known using panel names", { timeout: 20000 }, async () => {
    const harness = await mountProjectionsDirectory();
    const { mounted, observed, dispatchedIntents, present } = harness;
    try {
      // Select Projection A (used by Sales Dashboard & Ops Overview + 1 hidden).
      await present({ selected: projRef("proj-a") });
      await waitFor(() => Boolean(findButton(mounted.element, "Delete")), "delete OperationButton ready for proj-a");

      // Click Delete directly (no custom panel delete dialog); platform inspectImpact dialog opens with panel names.
      findButton(mounted.element, "Delete")!.click();
      await waitFor(() => Boolean(document.querySelector(".el-message-box")), "owner inspectImpact confirmation dialog");
      const box = document.querySelector<HTMLElement>(".el-message-box")!;
      const listedPanels = Array.from(box.querySelectorAll("li")).map((item) => item.textContent);
      expect(listedPanels).toEqual(["Sales Dashboard", "Ops Overview"]);
      expect(box.textContent).toContain("deletion will be refused");
      expect(box.textContent).toContain("1 additional panel(s)");

      // Cancel -> nothing dispatched, Projection A stays selected.
      findButton(box, "Cancel")!.click();
      await waitFor(() => !document.querySelector(".el-message-box"), "confirmation dialog closed after cancel");
      expect(dispatchedIntents).toHaveLength(0);
      expect(observed.context?.state?.selected).toEqual(projRef("proj-a"));

      // Select unused Projection B -> confirm delete -> dispatches delete with revision and clears selection.
      await present({ selected: projRef("proj-b") });
      await waitFor(
        () => observed.context?.state?.deleteRevision === 2 && Boolean(findButton(mounted.element, "Delete")),
        "delete OperationButton ready for proj-b with revision 2",
      );
      findButton(mounted.element, "Delete")!.click();
      await waitFor(() => Boolean(document.querySelector(".el-message-box")), "delete impact dialog for proj-b");
      const boxB = document.querySelector<HTMLElement>(".el-message-box")!;
      expect(boxB.textContent).toContain("Projection B");
      findButton(boxB, "Delete")!.click();

      await waitFor(() => dispatchedIntents.length === 1, "delete intent dispatched");
      expect(dispatchedIntents[0]).toMatchObject({
        operationId: "deleteProjection.delete",
        targetKey: "proj-b",
        input: { revision: 2 },
      });
      await waitFor(() => (observed.context?.state?.selected ?? null) === null, "selection cleared after delete");
    } finally {
      mounted.app.unmount();
    }
  });

  it("aligns copy and grant dialogs and submit buttons with detail entry permissions even when toggled via public state", { timeout: 20000 }, async () => {
    const harness = await mountProjectionsDirectory();
    const { mounted, present } = harness;
    try {
      // 1. No selection -> forcing copyDialog & grantDialog via public state mounts neither dialog nor submit buttons.
      await present({ selected: null, copyDialog: true, copyId: "x", copyName: "X", grantDialog: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.querySelector(".el-dialog")).toBeNull();
      expect(findButton(document.body, "Grant")).toBeUndefined();

      // 2. Chart projection -> no Copy button, and forcing copyDialog: true renders neither copy dialog nor copySubmit.
      await present({ selected: projRef("proj-chart"), copyDialog: true, copyId: "chart-copy", copyName: "Chart Copy" });
      await waitFor(() => mounted.element.textContent?.includes("Revenue Chart") === true, "chart projection loaded");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(findButton(mounted.element, "Copy")).toBeUndefined();
      expect(document.querySelector(".el-dialog")).toBeNull();

      // 3. Read-only (use-only) projection -> no Edit/Copy/Delete buttons, no Grants tab, and forcing copyDialog/grantDialog renders no dialogs.
      await present({ selected: projRef("proj-readonly"), copyDialog: true, grantDialog: true });
      await waitFor(() => mounted.element.textContent?.includes("Shared Projection") === true, "readonly projection loaded");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(findButton(mounted.element, "Edit")).toBeUndefined();
      expect(findButton(mounted.element, "Copy")).toBeUndefined();
      expect(findButton(mounted.element, "Delete")).toBeUndefined();
      expect(document.querySelector(".el-dialog")).toBeNull();
      expect(findButton(document.body, "Grant")).toBeUndefined();

      // 4. Editable ordinary projection -> opening copyDialog and grantDialog legitimately renders both dialogs and submit buttons.
      await present({ selected: projRef("proj-a"), copyDialog: true, copyId: "copy-a", copyName: "Copy A" });
      await waitFor(
        () => Boolean(document.querySelector(".el-dialog")) && Boolean(findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")),
        "copy dialog rendered for editable ordinary projection",
      );

      await present({ copyDialog: null, grantDialog: true });
      await waitFor(
        () => Boolean(document.querySelector(".el-dialog")) && Boolean(findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Grant")),
        "grant dialog rendered for editable projection",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("returns to view mode and closes open dialogs when only selected changes, while preserving atomic selected + detailMode edit", { timeout: 20000 }, async () => {
    const harness = await mountProjectionsDirectory();
    const { mounted, observed, reads, present } = harness;
    try {
      // Open Projection A in edit mode (clean) and verify.
      await present({ selected: projRef("proj-a"), detailMode: "edit" });
      await waitFor(
        () => (mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value ?? "") === "Projection A",
        "proj-a edit form opened",
      );

      // Update ONLY `selected` to Projection B -> automatically returns to view mode on B.
      await present({ selected: projRef("proj-b") });
      await waitFor(
        () => !mounted.element.querySelector(".proj-form-wrap") && observed.context?.state?.detailMode === "view" && selectedPrimaryKey(observed.context?.state) === "proj-b",
        "switching only selected exits edit mode to view",
      );

      // Open Copy dialog on Projection B, then update ONLY `selected` to Projection A -> dialog closes automatically.
      await present({ copyDialog: true, copyId: "tmp-copy", copyName: "Tmp Copy" });
      await waitFor(() => Boolean(document.querySelector(".el-dialog")), "copy dialog opened on proj-b");

      await present({ selected: projRef("proj-a") });
      await waitFor(
        () =>
          selectedPrimaryKey(observed.context?.state) === "proj-a"
          && (observed.context?.state?.copyDialog ?? null) === null
          && (observed.context?.state?.copyId ?? null) === null
          && !document.querySelector(".el-dialog"),
        "switching only selected closes open copy dialog",
      );

      // Open Grant dialog on Projection A, then update ONLY `selected` to Projection B -> grantDialog closes automatically.
      await present({ grantDialog: true });
      await waitFor(() => Boolean(document.querySelector(".el-dialog")), "grant dialog opened on proj-a");

      await present({ selected: projRef("proj-b") });
      await waitFor(
        () =>
          selectedPrimaryKey(observed.context?.state) === "proj-b"
          && (observed.context?.state?.grantDialog ?? null) === null
          && !document.querySelector(".el-dialog"),
        "switching only selected closes open grant dialog",
      );

      // Atomic `{ selected: proj-a, detailMode: "edit" }` lands directly in Projection A edit form.
      reads.length = 0;
      await present({ selected: projRef("proj-a"), detailMode: "edit" });
      await waitFor(
        () =>
          reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form" && readTargetKey(r) === "proj-a")
          && (mounted.element.querySelector<HTMLInputElement>(".proj-form-wrap input")?.value ?? "") === "Projection A",
        "atomic selected + detailMode edit opens proj-a form directly",
      );
      expect(observed.context?.state?.detailMode).toBe("edit");

      // Create recipe `{ selected: null, creating: true }` opens createForm with cleared selection.
      reads.length = 0;
      await present({ selected: null, creating: true });
      await waitFor(
        () =>
          reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "createForm" && readTargetKey(r) === "")
          && observed.context?.state?.creating === true
          && (observed.context?.state?.selected ?? null) === null,
        "create recipe opens createForm with cleared selection",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("selects only the owner-returned data.id after copy and never falls back to draft copyId", { timeout: 20000 }, async () => {
    let nextCopyResponse: { kind: "success"; data: Record<string, unknown> } = {
      kind: "success",
      data: { id: "owner-assigned-copy" },
    };
    const harness = await mountProjectionsDirectory({
      copyOutcome: () => nextCopyResponse,
    });
    const { mounted, observed, dispatchedIntents, present } = harness;
    try {
      // 1. Owner returns `data.id` different from draft `copyId` -> selects `data.id`.
      await present({ selected: projRef("proj-a"), copyDialog: true, copyId: "draft-id-ignored", copyName: "Copy A" });
      await waitFor(
        () => Boolean(document.querySelector(".el-dialog")) && Boolean(findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")),
        "copy dialog submit ready",
      );
      findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")!.click();

      await waitFor(() => dispatchedIntents.length === 1, "copy intent dispatched");
      await waitFor(
        () =>
          selectedPrimaryKey(observed.context?.state) === "owner-assigned-copy"
          && (observed.context?.state?.copyDialog ?? null) === null,
        "selected switched strictly to owner-returned data.id",
      );

      // 2. Owner returns success without `data.id` -> does NOT fall back to draft `copyId`.
      nextCopyResponse = { kind: "success", data: {} };
      await present({ selected: projRef("proj-a"), copyDialog: true, copyId: "draft-id-must-not-be-selected", copyName: "Copy Without ID" });
      await waitFor(
        () => Boolean(document.querySelector(".el-dialog")) && Boolean(findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")),
        "second copy dialog submit ready",
      );
      findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")!.click();

      await waitFor(() => dispatchedIntents.length === 2, "second copy intent dispatched");
      await waitFor(
        () => (observed.context?.state?.copyDialog ?? null) === null && (observed.context?.state?.copyId ?? null) === null,
        "copy dialog closed after receipt without id",
      );
      expect(observed.context?.state?.selected).toEqual(projRef("proj-a"));
    } finally {
      mounted.app.unmount();
    }
  });

  it("keeps same-object tabs mounted via v-show while unmounting grants tab when unauthorized", { timeout: 20000 }, async () => {
    const harness = await mountProjectionsDirectory();
    const { mounted, present } = harness;
    try {
      await present({ selected: projRef("proj-a"), tab: "grants" });
      await waitFor(
        () => mounted.element.querySelectorAll(".proj-tab-panel").length === 4,
        "all 4 same-object tab panels mounted for authorized projection",
      );
      const tabPanels = Array.from(mounted.element.querySelectorAll<HTMLElement>(".proj-tab-panel"));
      const grantsPanel = tabPanels[3]!;
      expect(grantsPanel.style.display).not.toBe("none");

      // Switching away to overview hides grants with v-show instead of unmounting it.
      await present({ tab: "overview" });
      await waitFor(
        () => grantsPanel.style.display === "none" && tabPanels[0]!.style.display !== "none",
        "grants tab hidden via v-show when switching to overview",
      );
      expect(mounted.element.contains(grantsPanel)).toBe(true);

      // Selecting a readonly projection without grant permission unmounts the grants tab panel.
      await present({ selected: projRef("proj-readonly") });
      await waitFor(
        () => mounted.element.querySelectorAll(".proj-tab-panel").length === 3,
        "grants tab panel unmounted when viewer lacks grant permission",
      );
    } finally {
      mounted.app.unmount();
    }
  });
});
