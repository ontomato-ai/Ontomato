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
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/projections/panel.json";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/projections/panel.html?raw";
import catalogModule from "../../../../../packages/ontology-manager/resources/builtin-panels/projections/panel.mjs?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/projection-detail/panel.json";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/projection-detail/panel.html?raw";
import detailModule from "../../../../../packages/ontology-manager/resources/builtin-panels/projection-detail/panel.mjs?raw";
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
const CATALOG_PATH = "/ontology/projections";
const DETAIL_PATH = "/ontology/projections/detail";

const catalogUse = panelUse(
  "use-ontology-projections",
  "ontology-projections",
  "builtin-product-ontology-projections",
  CATALOG_PATH,
);

const detailUse = panelUse(
  "use-ontology-projection-detail",
  "ontology-projection-detail",
  "builtin-product-ontology-projection-detail",
  DETAIL_PATH,
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

function buildPanelRecord(
  panelId: string,
  name: string,
  source: { manifest: unknown; content: { messages: Record<string, Record<string, string>> } },
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) {
        return [memberName, definition];
      }
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      projections.set(definition.id!, {
        ...projection,
        id: definition.id!,
        name: memberName,
        description: memberName,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-24T00:00:00Z",
        updatedAt: "2026-11-24T00:00:00Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );

  return {
    ...panelRecord(panelId, name, definePanel({ ...manifest, members })),
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
    content: { html, module, messages: source.content.messages },
  };
}

const projectionsCatalogPanel = buildPanelRecord(
  catalogUse.panelId,
  "Projections",
  catalogSource,
  catalogHtml,
  catalogModule,
);

const projectionDetailPanel = buildPanelRecord(
  detailUse.panelId,
  "Projection Detail",
  detailSource,
  detailHtml,
  detailModule,
);

const projRef = (primaryKey: string) => ({ className: PRODUCT_PROJECTION, primaryKey });

interface ProjectionFixture {
  readonly id: string;
  readonly name: string;
  readonly canEdit: boolean;
  readonly canCopy: boolean;
  readonly canGrant: boolean;
  readonly canDelete: boolean;
  readonly isChart: boolean;
  readonly domainShared?: boolean;
  readonly revision: number;
  readonly status?: "ready" | "forbidden" | "error" | "empty";
  readonly errorMessage?: string;
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
    domainShared: false,
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
    domainShared: false,
    revision: 2,
    usedByPanels: [],
    hiddenUsedByCount: 0,
  },
  "proj-created": {
    id: "proj-created",
    name: "Created Projection",
    canEdit: true,
    canCopy: true,
    canGrant: true,
    canDelete: true,
    isChart: false,
    domainShared: false,
    revision: 1,
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
    domainShared: false,
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
    domainShared: true,
    revision: 1,
    usedByPanels: [],
  },
  "proj-forbidden": {
    id: "proj-forbidden",
    name: "Secret Projection",
    canEdit: false,
    canCopy: false,
    canGrant: false,
    canDelete: false,
    isChart: false,
    revision: 1,
    status: "forbidden",
  },
  "proj-error": {
    id: "proj-error",
    name: "Broken Projection",
    canEdit: false,
    canCopy: false,
    canGrant: false,
    canDelete: false,
    isChart: false,
    revision: 1,
    status: "error",
    errorMessage: "Projection storage temporarily unavailable",
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
    createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
  };
}

function selectedPrimaryKey(state: Record<string, unknown> | undefined): string | null {
  const value = state?.selected;
  if (value && typeof value === "object" && "primaryKey" in value && typeof (value as { primaryKey?: unknown }).primaryKey === "string") {
    return (value as { primaryKey: string }).primaryKey;
  }
  return null;
}

function presentFrame(address: string, state?: Record<string, unknown>): PresentationFrame {
  return {
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: `call-${Math.random()}`,
    target: {
      kind: "page",
      address,
      ...(state ? { state: state as PresentationFrame["target"] extends { state?: infer S } ? S : never } : {}),
    },
  };
}

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function formDescription(mode: "create" | "edit", key: string) {
  return {
    fields: [
      { path: "/name", label: "Name", required: true, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/id", label: "ID", required: false, readOnly: mode === "edit", control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/description", label: "Description", required: false, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/visibility", label: "Visibility", required: false, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/componentId", label: "Component", required: true, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/data", label: "Data", required: true, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/config", label: "Config", required: false, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/inputs", label: "Inputs", required: false, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/outputs", label: "Outputs", required: false, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
      { path: "/operations", label: "Operations", required: false, readOnly: false, control: { kind: "text" }, valueSchema: { type: "string" } },
    ],
    values: {
      name: mode === "create" ? "" : (FIXTURES[key]?.name ?? `Projection ${key}`),
      id: mode === "create" ? "" : key,
      description: "",
      visibility: "private",
      componentId: "@ontomato/sdk:ObjectSummary",
      data: "{}",
      config: "{}",
      inputs: "{}",
      outputs: "{}",
      operations: "{}",
    },
    errors: [],
    revision: mode === "create" ? undefined : (FIXTURES[key]?.revision ?? 1),
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/product-projections/${key || "new"}`,
      bodySchema: {},
    },
  };
}

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
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

function setFieldInput(root: HTMLElement, fieldPath: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(`[data-field="${fieldPath}"] input`);
  expect(input).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
}

interface MountOptions {
  initialAddress?: string;
  confirmLeave?: () => Promise<boolean>;
  copyOutcome?: () => { kind: "success"; data: Record<string, unknown> };
  deleteOutcome?: (primaryKey: string) => { kind: "success"; data: Record<string, unknown> } | { kind: "refusal"; code: string; message: string };
  createdKey?: string;
}

async function mountProjectionsApp(options: MountOptions = {}) {
  const reads: DataReadRequest[] = [];
  const navigated: string[] = [];
  const savedRequests: Array<{ operationId: string; targetKey: string; input: Record<string, unknown> }> = [];
  const preparedIntents = new Map<string, { preparation: PanelHumanOperationPreparation; targetKey: string; input: Record<string, unknown> }>();
  const dispatchedIntents: Array<{ intentId: string; operationId: string; targetKey: string; input: Record<string, unknown> }> = [];
  let intentSeq = 0;
  let sharedState = false;
  const confirmLeaveUnsaved = vi.fn(async () => (options.confirmLeave ? options.confirmLeave() : true));

  const sent = installPlatform((request: Sent) => {
    const { method, path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [catalogUse, detailUse] },
      });
    }
    if (path === `/api/product-panels/${projectionsCatalogPanel.id}`) {
      return panelAnswer(projectionsCatalogPanel, request);
    }
    if (path === `/api/product-panels/${projectionsCatalogPanel.id}/snapshot`) {
      return panelSnapshot(projectionsCatalogPanel, Object.fromEntries(projections), request);
    }
    if (path === `/api/product-panels/${projectionDetailPanel.id}`) {
      return panelAnswer(projectionDetailPanel, request);
    }
    if (path === `/api/product-panels/${projectionDetailPanel.id}/snapshot`) {
      return panelSnapshot(projectionDetailPanel, Object.fromEntries(projections), request);
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
      } else if (body.operationId === "createForm.save" || body.operationId === "form.save") {
        label = "Save";
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
      if (stored.preparation.operationId === "createForm.save") {
        const createdId = options.createdKey ?? "proj-created";
        savedRequests.push({ operationId: stored.preparation.operationId, targetKey: createdId, input: stored.input });
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            created: { objectType: PRODUCT_PROJECTION, primaryKey: createdId },
            data: { id: createdId },
            affected: { objects: [], objectTypes: [] },
          },
        });
      }
      if (stored.preparation.operationId === "form.save") {
        savedRequests.push({ operationId: stored.preparation.operationId, targetKey: stored.targetKey, input: stored.input });
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            data: { id: stored.targetKey },
            affected: { objects: [], objectTypes: [] },
          },
        });
      }
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
      if (stored.preparation.operationId === "shareEnable.share") {
        sharedState = true;
      } else if (stored.preparation.operationId === "shareDisable.share") {
        sharedState = false;
      }
      return Response.json({ kind: "dispatched", intentId, outcome: { kind: "success", data: {} } });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        const member = body.memberPath[0]?.member;
        if (member === "createForm" || member === "form") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                handlerRef: "platform:ProductProjection.save",
                label: "Save",
                kind: "form.save",
                effect: "write",
                batch: false,
                target: { source: "draft", slot: member },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
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
        if (member === "shareEnable" || member === "shareDisable") {
          return Response.json({
            status: "ready",
            value: {
              share: {
                handlerRef: "productProjections.share",
                label: "Share",
                kind: "action",
                effect: "write",
                batch: false,
                target: { source: "input", input: "target" },
                inputSchema: { type: "object", properties: { shared: { type: "boolean" } } },
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
              fields: { component: "ObjectSummary", owner: "Alice", scope: "Private", updatedAt: "2026-11-24T00:00:00Z" },
            })),
            total: 4,
          },
        });
      }
      if (member === "headerTitle" || member === "summary" || member === "definitionSummary" || member === "shareStatusDesc") {
        const key = readTargetKey(body);
        const fixture = FIXTURES[key];
        if (!fixture) return Response.json({ status: "empty" });
        if (fixture.status === "forbidden") return Response.json({ status: "forbidden" });
        if (fixture.status === "error") return Response.json({ status: "error", message: fixture.errorMessage });
        const domainShared = fixture.id === "proj-a" ? sharedState : Boolean(fixture.domainShared);
        return Response.json({
          status: "ready",
          value: {
            primaryKey: fixture.id,
            label: fixture.name,
            subtitle: fixture.id,
            fields: {
              id: fixture.id,
              component: fixture.isChart ? "MetricChart" : "ObjectSummary",
              scope: domainShared ? "Domain" : "Private",
              owner: "Alice",
              revision: fixture.revision,
              domainShared,
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
              domainShared,
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
      if (member === "createForm") {
        return Response.json({ status: "ready", value: formDescription("create", "") });
      }
      if (member === "form") {
        const key = readTargetKey(body);
        return Response.json({ status: "ready", value: formDescription("edit", key) });
      }
      if (member === "usedByList") {
        const key = readTargetKey(body);
        const fixture = FIXTURES[key];
        const rows = (fixture?.usedByPanels ?? []).map((panel) => ({
          primaryKey: panel.id,
          label: panel.name,
          fields: {
            panel: { kind: "reference", className: PRODUCT_PANEL, primaryKey: panel.id, label: panel.name },
            id: panel.id,
          },
        }));
        return Response.json({ status: "ready", value: rows });
      }
      if (
        member === "dataList"
        || member === "configList"
        || member === "inputsList"
        || member === "outputsList"
        || member === "operationsList"
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
      panelUses: [catalogUse, detailUse],
    },
  ];

  const observed = { context: null as { url?: string; state?: Record<string, unknown> } | null };
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Projections", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path === CATALOG_PATH || path === DETAIL_PATH ? { featureId: "panel", address, instance: path } : null;
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

  const startAddress = options.initialAddress ?? CATALOG_PATH;
  await display.present(presentFrame(startAddress));

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
              useId: display.page.value.instance === DETAIL_PATH ? detailUse.id : catalogUse.id,
              address: display.page.value.address,
              liveState: display.liveState.value,
              navigate: (address: string) => {
                navigated.push(address);
                const path = address.split("?")[0]!;
                if (path === CATALOG_PATH || path === DETAIL_PATH) {
                  void display.present(presentFrame(address));
                }
              },
              registerPageController: (controller: unknown) =>
                display.registerPageController(display.page.value!.instance, controller as never),
              onDisplayAddress: display.address,
              onDisplayLoaded: display.loaded,
              onContext: (reported: { url?: string; state?: Record<string, unknown> } | null) => {
                observed.context = reported;
                display.context(reported as never);
              },
            })
          : null;
    },
  });

  const mounted = mountPlatformPage(() => h(Host), router);
  if (startAddress.startsWith(DETAIL_PATH)) {
    await waitFor(
      () => Boolean(mounted.element.querySelector(".proj-detail-page")),
      "initial projection detail page",
    );
  } else {
    await waitFor(
      () =>
        mounted.element.textContent?.includes("Projection A") === true
        && mounted.element.textContent?.includes("Projection B") === true,
      "initial projections catalog list",
    );
  }

  return {
    mounted,
    display,
    observed,
    reads,
    sent,
    navigated,
    savedRequests,
    dispatchedIntents,
    confirmLeaveUnsaved,
    present: (state: Record<string, unknown>, address = display.page.value!.address) =>
      display.present(presentFrame(address, state)),
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  window.sessionStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("projections two-entry catalog & detail panels", () => {
  it("avoids usePanelData, third-party element names, direct /api/ calls, and sessionStorage handoff, and keeps creating/detailMode off deepLink URLs", () => {
    for (const [html, mod] of [
      [catalogHtml, catalogModule],
      [detailHtml, detailModule],
    ]) {
      expect(mod).not.toContain("usePanelData");
      expect(mod).not.toContain("/api/");
      expect(mod).not.toContain("sessionStorage");
      expect(html).not.toMatch(/<el-[a-z]|--el-/i);
    }
    expect(catalogHtml).not.toContain("<sdk-dialog");
    expect(catalogHtml).not.toContain("<object-form-fields");
    expect(catalogSource.manifest.members.createForm.config.actions).toBe("none");
    expect(catalogSource.manifest.state.creating.deepLink).toBe(false);
    expect(detailSource.manifest.state.detailMode.deepLink).toBe(false);
    expect(catalogSource.manifest.members.catalogue.config.showChevron).toBe(true);
    expect(catalogSource.manifest.members.catalogue.config.fallbackToFirst).toBe(false);
  });

  it("navigates from full-width catalog row click to /ontology/projections/detail?selected=...", { timeout: 20000 }, async () => {
    const harness = await mountProjectionsApp();
    const { mounted, navigated, observed } = harness;
    try {
      // Single primary button in catalog page-header.
      const primaryButtons = mounted.element.querySelectorAll(".sdk-page-header .el-button--primary");
      expect(primaryButtons.length).toBe(1);

      // Click Projection A row -> navigates to detail entry in default view mode.
      const rowA = Array.from(mounted.element.querySelectorAll("tr")).find((tr) => tr.textContent?.includes("Projection A"));
      expect(rowA).toBeTruthy();
      rowA!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await waitFor(
        () => navigated.includes(`${DETAIL_PATH}?selected=proj-a`),
        () => `navigated=${JSON.stringify(navigated)}`,
      );
      await waitFor(
        () => Boolean(mounted.element.querySelector(".proj-detail-page")) && observed.context?.state?.detailMode === "view" && Boolean(findButton(mounted.element, "Edit")),
        "detail page mounted in default view mode with Edit button",
      );
      expect(Boolean(findButton(mounted.element, "Back to projections"))).toBe(true);
    } finally {
      mounted.app.unmount();
    }
  });

  it("switches to full-width create form with all owner fields, guards unsaved Back/Cancel via confirmLeaveUnsaved, and opens created projection in default detail view mode without sessionStorage", { timeout: 20000 }, async () => {
    let resolveConfirm: ((ok: boolean) => void) | null = null;
    const harness = await mountProjectionsApp({
      confirmLeave: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    const { mounted, observed, navigated, savedRequests, dispatchedIntents, confirmLeaveUnsaved } = harness;
    try {
      // Open full-width create form from header primary button (no modal dialog).
      findButton(mounted.element, "New projection")!.click();
      await waitFor(
        () =>
          observed.context?.state?.creating === true
          && Boolean(mounted.element.querySelector('.proj-create-body .proj-form-wrap [data-field="/name"] input')),
        "full-width create form mounted",
      );
      expect(document.querySelector(".el-dialog")).toBeNull();
      expect((mounted.element.querySelector<HTMLElement>(".proj-catalog")?.style.display)).toBe("none");

      // Header renders Back to projections, Cancel, and disabled Save driven by usePanelFormDraft("createForm").
      expect(Boolean(findButton(mounted.element, "Back to projections"))).toBe(true);
      expect(Boolean(findButton(mounted.element, "Cancel"))).toBe(true);
      expect(findButton(mounted.element, "Save")?.disabled).toBe(true);

      // All owner-declared fields render in full without field slicing.
      for (const path of ["/name", "/id", "/description", "/visibility", "/componentId", "/data", "/config", "/inputs", "/outputs", "/operations"]) {
        expect(mounted.element.querySelector(`.proj-create-body [data-field="${path}"]`)).not.toBeNull();
      }

      // Edit name -> form becomes dirty and header Save becomes enabled.
      setFieldInput(mounted.element, "/name", "Draft Projection");
      await waitFor(
        () =>
          mounted.element.querySelector<HTMLInputElement>('.proj-create-body [data-field="/name"] input')?.value === "Draft Projection"
          && findButton(mounted.element, "Save")?.disabled === false,
        "create form name typed and header Save enabled",
      );

      // 1. Clicking Back to projections while dirty asks confirmLeaveUnsaved; declining keeps create form & draft intact.
      findButton(mounted.element, "Back to projections")!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 1 && resolveConfirm !== null, "confirmLeaveUnsaved on Back");
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(observed.context?.state?.creating).toBe(true);
      expect(mounted.element.querySelector<HTMLInputElement>('.proj-create-body [data-field="/name"] input')?.value).toBe("Draft Projection");

      // 2. Clicking Cancel while dirty asks confirmLeaveUnsaved; declining keeps create form & draft intact.
      findButton(mounted.element, "Cancel")!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 2 && resolveConfirm !== null, "confirmLeaveUnsaved on Cancel");
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(observed.context?.state?.creating).toBe(true);
      expect(mounted.element.querySelector<HTMLInputElement>('.proj-create-body [data-field="/name"] input')?.value).toBe("Draft Projection");

      // 3. Clicking Cancel again and confirming discards draft and returns to catalog.
      findButton(mounted.element, "Cancel")!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 3 && resolveConfirm !== null, "confirmLeaveUnsaved on Cancel confirm");
      resolveConfirm!(true);
      resolveConfirm = null;
      await waitFor(
        () =>
          observed.context?.state?.creating === false
          && !mounted.element.querySelector(".proj-create-body")
          && mounted.element.querySelector<HTMLElement>(".proj-catalog")?.style.display !== "none",
        "returned to catalog after confirming discard",
      );

      // 4. Assistant remote control `present({ creating: true })` opens full-width create form;
      // filling name and clicking header Save dispatches createForm.save and navigates to detail view mode with zero sessionStorage writes.
      await harness.present({ creating: true });
      await waitFor(
        () => Boolean(mounted.element.querySelector('.proj-create-body [data-field="/name"] input')),
        "re-opened full-width create form via present",
      );
      setFieldInput(mounted.element, "/name", "Created Projection");
      await waitFor(() => findButton(mounted.element, "Save")?.disabled === false, "header Save enabled for create");
      findButton(mounted.element, "Save")!.click();

      await waitFor(
        () => savedRequests.length === 1,
        () => `createForm.save dispatched; intents=${JSON.stringify(dispatchedIntents)}, sent=${JSON.stringify(harness.sent.filter((s) => s.path.includes("intents")))}`,
      );
      await waitFor(
        () => navigated.includes(`${DETAIL_PATH}?selected=proj-created`),
        () => `expected detail navigation, got ${JSON.stringify(navigated)}`,
      );
      await waitFor(
        () =>
          Boolean(mounted.element.querySelector(".proj-detail-page"))
          && observed.context?.state?.detailMode === "view"
          && Boolean(findButton(mounted.element, "Edit")),
        "created projection opened directly in detail default view mode",
      );
      expect(mounted.element.querySelector(".proj-form-wrap")).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
      expect(displayUrlOf(harness)).toBe(`${DETAIL_PATH}?selected=proj-created`);
    } finally {
      mounted.app.unmount();
    }
  });

  it("guards edit mode Cancel with confirmLeaveUnsaved, saves via header draft Save, and navigates Back to catalog", { timeout: 20000 }, async () => {
    let resolveConfirm: ((ok: boolean) => void) | null = null;
    const harness = await mountProjectionsApp({
      initialAddress: `${DETAIL_PATH}?selected=proj-a`,
      confirmLeave: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    const { mounted, observed, savedRequests, navigated, confirmLeaveUnsaved } = harness;
    try {
      await waitFor(() => Boolean(findButton(mounted.element, "Edit")), "view mode Edit button ready");
      expect(observed.context?.state?.detailMode).toBe("view");

      // Click Edit -> full-width edit form opens, header switches to Cancel / Save (Save disabled while clean).
      findButton(mounted.element, "Edit")!.click();
      await waitFor(
        () =>
          observed.context?.state?.detailMode === "edit"
          && (mounted.element.querySelector<HTMLInputElement>('.proj-form-wrap [data-field="/name"] input')?.value ?? "") === "Projection A",
        "full-width edit form loaded",
      );
      const saveBtn = findButton(mounted.element, "Save");
      expect(saveBtn).toBeTruthy();
      expect(saveBtn!.disabled).toBe(true);

      // Edit name -> Save becomes enabled via usePanelFormDraft("form").
      setFieldInput(mounted.element, "/name", "Projection A Updated");
      await waitFor(
        () => findButton(mounted.element, "Save")?.disabled === false,
        () => `header Save button enabled when dirty; ops=${JSON.stringify(harness.sent.filter((s) => s.path === "/api/product-panels/read" && "operations" in (s.body as object)))}`,
      );

      // Click Cancel -> confirmLeaveUnsaved fires; declining preserves edit mode & draft.
      findButton(mounted.element, "Cancel")!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 1 && resolveConfirm !== null, "confirmLeaveUnsaved on edit Cancel");
      resolveConfirm!(false);
      resolveConfirm = null;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(observed.context?.state?.detailMode).toBe("edit");
      expect(mounted.element.querySelector<HTMLInputElement>('.proj-form-wrap [data-field="/name"] input')?.value).toBe("Projection A Updated");

      // Confirming Cancel discards the draft and returns to view mode.
      findButton(mounted.element, "Cancel")!.click();
      await waitFor(() => confirmLeaveUnsaved.mock.calls.length === 2 && resolveConfirm !== null, "confirmLeaveUnsaved on edit Cancel confirm");
      resolveConfirm!(true);
      resolveConfirm = null;
      await waitFor(
        () => observed.context?.state?.detailMode === "view" && !mounted.element.querySelector(".proj-form-wrap"),
        "returned to view mode after confirming edit Cancel",
      );

      // Re-enter Edit, modify name, and click Save in page-header -> submits form.save and returns to view mode.
      await waitFor(() => Boolean(findButton(mounted.element, "Edit")), "Edit button restored in view mode");
      findButton(mounted.element, "Edit")!.click();
      await waitFor(
        () => (mounted.element.querySelector<HTMLInputElement>('.proj-form-wrap [data-field="/name"] input')?.value ?? "") === "Projection A",
        "re-entered edit form with clean baseline",
      );
      setFieldInput(mounted.element, "/name", "Projection A Saved");
      await waitFor(() => findButton(mounted.element, "Save")?.disabled === false, "Save enabled on second edit");
      findButton(mounted.element, "Save")!.click();
      await waitFor(() => savedRequests.length === 1, "form.save dispatched via page-header draft Save");
      await waitFor(
        () => observed.context?.state?.detailMode === "view" && !mounted.element.querySelector(".proj-form-wrap"),
        "returned to view mode after saving",
      );

      // Click Back to projections -> navigates back to /ontology/projections.
      findButton(mounted.element, "Back to projections")!.click();
      await waitFor(() => navigated.includes(CATALOG_PATH), "navigated back to catalog");
    } finally {
      mounted.app.unmount();
    }
  });

  it("supports More menu operations: openClass, Copy (strict owner data.id), Delete via inspectImpact, usage link to /ontology/panels/detail, and grants/share", { timeout: 20000 }, async () => {
    let nextCopyResponse: { kind: "success"; data: Record<string, unknown> } = {
      kind: "success",
      data: { id: "owner-assigned-copy" },
    };
    const harness = await mountProjectionsApp({
      initialAddress: `${DETAIL_PATH}?selected=proj-a`,
      copyOutcome: () => nextCopyResponse,
    });
    const { mounted, observed, navigated, dispatchedIntents, present } = harness;
    try {
      await waitFor(() => Boolean(findButton(mounted.element, "More")), "More menu button ready");

      // Overview & definition tabs render summary, preview, and binding tables.
      expect(mounted.element.querySelector('[data-tab="overview"]')?.textContent).toContain("Inline preview");
      expect(mounted.element.querySelector('[data-tab="definition"]')?.textContent).toContain("Data sources & reads");
      expect(mounted.element.querySelector('[data-tab="definition"]')?.textContent).toContain("Registered operations");

      // 1. Keep same-object tabs mounted via v-show while unmounting grants tab when unauthorized.
      await present({ tab: "grants" });
      await waitFor(() => mounted.element.querySelectorAll(".proj-tab-panel").length === 4, "4 tab panels mounted for authorized projection");
      const tabPanels = Array.from(mounted.element.querySelectorAll<HTMLElement>(".proj-tab-panel"));
      const grantsPanel = tabPanels[3]!;
      expect(grantsPanel.style.display).not.toBe("none");

      // Domain share toggle & Add grant dialog work inside grants tab.
      const shareBtn = findButton(grantsPanel, "Enable domain sharing");
      expect(shareBtn).toBeTruthy();
      shareBtn!.click();
      await waitFor(() => dispatchedIntents.some((i) => i.operationId === "shareEnable.share"), "shareEnable dispatched");
      findButton(grantsPanel, "Add grant")!.click();
      await waitFor(() => observed.context?.state?.grantDialog === true && Boolean(document.querySelector(".el-dialog")), "add grant dialog opened");
      findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Cancel")!.click();
      await waitFor(() => observed.context?.state?.grantDialog === false, "add grant dialog closed");

      // Switch to usage tab -> shows visible panels and hidden count hint; clicking panel navigates to /ontology/panels/detail?selected=...
      await present({ tab: "usage" });
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Sales Dashboard") === true
          && mounted.element.textContent?.includes("1 additional panel") === true,
        "usage tab shows panels and hidden count",
      );
      const usagePanel = tabPanels[2]!;
      const panelRow = Array.from(usagePanel.querySelectorAll("tr")).find((tr) => tr.textContent?.includes("Sales Dashboard"));
      expect(panelRow).toBeTruthy();
      panelRow!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(
        () => navigated.includes("/ontology/panels/detail?selected=panel-sales"),
        () => `navigated=${JSON.stringify(navigated)}`,
      );

      // 2. Open More menu -> click View object type -> navigates to capability map.
      findButton(mounted.element, "More")!.click();
      await waitFor(() => Boolean(findMenuItem("View object type")), "More dropdown opened");
      findMenuItem("View object type")!.click();
      await waitFor(
        () => navigated.some((addr) => addr.startsWith("/ontology/assets/capability-map") && addr.includes("selectedType=platform:ProductProjection")),
        () => `navigated=${JSON.stringify(navigated)}`,
      );

      // 3. Copy selects only owner-returned data.id and never falls back to draft copyId.
      await present({ copyDialog: true, copyId: "draft-id-ignored", copyName: "Copy A" });
      await waitFor(
        () => Boolean(document.querySelector(".el-dialog")) && Boolean(findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")),
        "copy dialog submit ready",
      );
      findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")!.click();
      await waitFor(
        () =>
          selectedPrimaryKey(observed.context?.state) === "owner-assigned-copy"
          && observed.context?.state?.copyDialog === false,
        "selected switched strictly to owner-returned data.id",
      );

      nextCopyResponse = { kind: "success", data: {} };
      await present({ selected: projRef("proj-a"), copyDialog: true, copyId: "draft-id-must-not-be-selected", copyName: "Copy Without ID" });
      await waitFor(
        () => Boolean(document.querySelector(".el-dialog")) && Boolean(findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")),
        "second copy dialog ready",
      );
      findButton(document.querySelector<HTMLElement>(".el-dialog")!, "Copy")!.click();
      await waitFor(() => observed.context?.state?.copyDialog === false, "copy dialog closed when receipt has no id");
      expect(selectedPrimaryKey(observed.context?.state)).toBe("proj-a");

      // 4. Delete from More menu triggers owner inspectImpact dialog showing known using panels & hidden count.
      await waitFor(() => observed.context?.state?.deleteRevision === 3, "deleteRevision synced for proj-a");
      findButton(mounted.element, "More")!.click();
      await waitFor(() => Boolean(findMenuItem("Delete")), "More menu Delete item visible");
      findMenuItem("Delete")!.click();
      await waitFor(() => Boolean(document.querySelector(".el-message-box")), "inspectImpact dialog opened for proj-a");
      const boxA = document.querySelector<HTMLElement>(".el-message-box")!;
      expect(Array.from(boxA.querySelectorAll("li")).map((el) => el.textContent)).toEqual(["Sales Dashboard", "Ops Overview"]);
      expect(boxA.textContent).toContain("1 additional panel(s)");
      findButton(boxA, "Cancel")!.click();
      await waitFor(() => !document.querySelector(".el-message-box"), "inspectImpact dialog closed on cancel");

      // Switch to unused Projection B, confirm Delete -> dispatches with revision 2 and navigates back to /ontology/projections.
      await present({ selected: projRef("proj-b") });
      await waitFor(() => observed.context?.state?.deleteRevision === 2, "deleteRevision synced for proj-b");
      findButton(mounted.element, "More")!.click();
      await waitFor(() => Boolean(findMenuItem("Delete")), "Delete menu item ready for proj-b");
      findMenuItem("Delete")!.click();
      await waitFor(() => Boolean(document.querySelector(".el-message-box")), "delete impact dialog for proj-b");
      const boxB = document.querySelector<HTMLElement>(".el-message-box")!;
      findButton(boxB, "Delete")!.click();
      await waitFor(
        () => dispatchedIntents.some((i) => i.operationId === "deleteProjection.delete" && i.targetKey === "proj-b" && i.input.revision === 2),
        "deleteProjection.delete dispatched with revision 2",
      );
      await waitFor(() => navigated.includes(CATALOG_PATH), "navigated back to catalog after delete");
    } finally {
      mounted.app.unmount();
    }
  });

  it("handles readonly, chart, forbidden, error, missing states and atomic remote-control edit switches cleanly", { timeout: 20000 }, async () => {
    const harness = await mountProjectionsApp({ initialAddress: `${DETAIL_PATH}?selected=proj-readonly` });
    const { mounted, observed, present } = harness;
    try {
      await waitFor(() => mounted.element.querySelectorAll(".proj-tab-panel").length === 3, "readonly projection unmounts grants tab");
      expect(observed.context?.state?.detailMode).toBe("view");
      expect(findButton(mounted.element, "Edit")).toBeUndefined();

      // Chart projection shows chart hint and hides Copy in More menu.
      await present({ selected: projRef("proj-chart") });
      await waitFor(() => mounted.element.textContent?.includes("Chart projections are registered") === true, "chart hint shown");
      findButton(mounted.element, "More")!.click();
      await waitFor(() => Boolean(findMenuItem("View object type")), "More menu opened for chart");
      expect(findMenuItem("Copy")).toBeUndefined();

      // Atomic remote control `{ selected: proj-a, detailMode: "edit" }` enters edit mode directly.
      await present({ selected: projRef("proj-a"), detailMode: "edit" });
      await waitFor(
        () =>
          observed.context?.state?.detailMode === "edit"
          && (mounted.element.querySelector<HTMLInputElement>('.proj-form-wrap [data-field="/name"] input')?.value ?? "") === "Projection A",
        "atomic selected + detailMode edit opens edit form directly",
      );

      // Forbidden & error states render in place.
      await present({ selected: projRef("proj-forbidden"), detailMode: "view" });
      await waitFor(
        () => mounted.element.textContent?.includes("You do not have permission to use this projection.") === true,
        () => `forbidden state rendered in place; text=${JSON.stringify(mounted.element.textContent?.slice(0, 300))}, state=${JSON.stringify(observed.context?.state)}`,
      );

      await present({ selected: projRef("proj-error") });
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Projection storage temporarily unavailable") === true
          && Boolean(findButton(mounted.element, "Retry")),
        "error state rendered in place with Retry button",
      );

      await present({ selected: projRef("proj-missing") });
      await waitFor(
        () => mounted.element.textContent?.includes("This projection is no longer available.") === true,
        "missing state rendered in place",
      );
    } finally {
      mounted.app.unmount();
    }
  });
});

function displayUrlOf(harness: Awaited<ReturnType<typeof mountProjectionsApp>>): string {
  return harness.display.page.value?.address ?? "";
}

function findMenuItem(text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(".el-dropdown-menu__item")).find(
    (item) => item.textContent?.trim() === text && item.offsetParent !== null || (item.textContent?.trim() === text && getComputedStyle(item).display !== "none"),
  );
}
