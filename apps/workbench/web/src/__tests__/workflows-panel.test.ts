import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  ACTIVATE_WORKFLOW,
  DEACTIVATE_WORKFLOW,
  DELETE_WORKFLOW,
  WORKFLOW,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/workflows/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/workflows/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/workflows/panel.mjs?raw";
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

const appId = "ontology";
const use = panelUse(
  "ontology-workflows",
  "ontology-workflows",
  "builtin-product-ontology-workflows",
  "/ontology/assets/workflows",
);

const workflowTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[WORKFLOW],
  operations: [
    {
      id: `${WORKFLOW}.save`,
      kind: "form.save",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "draft" },
    },
    {
      id: ACTIVATE_WORKFLOW,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "workflow" },
    },
    {
      id: DEACTIVATE_WORKFLOW,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "workflow" },
    },
    {
      id: DELETE_WORKFLOW,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "workflow" },
    },
  ],
});

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) throw new Error(`Expected authored projection for ${name}`);
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes: { [WORKFLOW]: workflowTypeEntry } },
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
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const workflowsPanel = {
  ...panelRecord(use.panelId, "Workflows", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function workflowRow(id: string, name: string) {
  return {
    primaryKey: id,
    label: name,
    subtitle: `${name} description`,
    fieldLabels: {
      label: "Workflow",
      statusBadges: "Status",
      version: "Version",
      stepsSummary: "Steps",
      grantsSummary: "Grants",
      createdBy: "Created by",
      reviewedBy: "Last activated by",
    },
    fields: {
      label: name,
      statusBadges: ["Active"],
      statusCode: "ACTIVE",
      canActivate: false,
      canDeactivate: true,
      version: "v2",
      stepsSummary: "Submit -> Approve",
      grantsSummary: "1 role grant in force",
      createdBy: "Alice",
      reviewedBy: "Bob",
    },
    tones: {
      statusBadges: "success",
    },
  };
}

function grantRow(id: string, roleCode: string, capabilities: string[]) {
  return {
    primaryKey: id,
    label: roleCode,
    fieldLabels: {
      roleCode: "Role code",
      capabilities: "Capabilities",
    },
    fields: {
      roleCode,
      capabilities,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(turns = 16) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function isLoadingMaskActive(container: Element): boolean {
  const mask = container.querySelector<HTMLElement>(".el-loading-mask");
  if (!mask) return false;
  return mask.style.display !== "none";
}

function isSectionVisible(section: HTMLElement | null | undefined): boolean {
  return Boolean(section && section.style.display !== "none");
}

function mountWorkflowsRoute(onRead: (body: DataReadRequest) => Response | Promise<Response>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: use.path, component: PanelApplicationRoute, props: { applicationId: appId } }],
  });
  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${workflowsPanel.id}`) return panelAnswer(workflowsPanel, request);
    if (path === `/api/product-panels/${workflowsPanel.id}/snapshot`) {
      return panelSnapshot(workflowsPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) return Response.json({ status: "ready", value: {} });
      return onRead(body);
    }
    return nothingAt(request);
  }, router);

  return {
    async open() {
      useApplicationCatalog().applications.value = [
        {
          id: appId,
          kind: "product",
          names: { en: "Ontology" },
          descriptions: {},
          icon: "ontology",
          rail: "apps",
          category: "build",
          sort: 0,
          entry: { path: "/ontology", renderer: "panels" },
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [use],
        },
      ];
      await router.push(panelAddress(use.path, {}, workflowsPanel.manifest));
      const { element } = mountPlatformPage(() => h(RouterView), router);
      await flush();
      return element;
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("workflows builtin panel effective grants modal", () => {
  it("clears the loading overlay once the four grant lists finish loading and shows non-empty groups", async () => {
    const pending = {
      grantCaseScopedSteps: deferred<Response>(),
      grantInForce: deferred<Response>(),
      grantSuperseded: deferred<Response>(),
      grantDirect: deferred<Response>(),
    };

    const route = mountWorkflowsRoute((body) => {
      const member = body.memberPath[0]?.member;
      if (member === "catalog") {
        return Response.json({
          status: "ready",
          value: { rows: [workflowRow("wf-1", "Expense approval")], total: 1 },
        });
      }
      if (member === "grantsInForceTitle") {
        return Response.json({
          status: "ready",
          value: { primaryKey: "wf-1", label: "Expense approval", fields: { activeGrantVersion: "v2" } },
        });
      }
      if (member && member in pending) {
        return pending[member as keyof typeof pending].promise;
      }
      return Response.json({ status: "empty" });
    });

    const root = await route.open();
    const grantLink = await vi.waitFor(() => {
      const btn = root.querySelector<HTMLButtonElement>(".wf-grant-link");
      expect(btn).not.toBeNull();
      return btn!;
    });
    grantLink.click();

    const grantsBody = await vi.waitFor(() => {
      const el = document.body.querySelector<HTMLElement>(".wf-grants-body");
      expect(el).not.toBeNull();
      expect(isLoadingMaskActive(el!)).toBe(true);
      return el!;
    });

    // Resolve all four grant lists via their real ObjectList status/loadedCount outputs.
    pending.grantCaseScopedSteps.resolve(Response.json({ status: "ready", value: [] }));
    pending.grantInForce.resolve(
      Response.json({ status: "ready", value: [grantRow("g-1", "finance_approver", ["expense.approve"])] }),
    );
    pending.grantSuperseded.resolve(Response.json({ status: "empty" }));
    pending.grantDirect.resolve(
      Response.json({ status: "ready", value: [grantRow("g-2", "domain_admin", ["expense.audit"])] }),
    );

    await vi.waitFor(() => {
      expect(isLoadingMaskActive(grantsBody)).toBe(false);
    });
    const sections = [...grantsBody.querySelectorAll<HTMLElement>("section.wf-grants-group")];
    expect(sections).toHaveLength(4);
    expect(isSectionVisible(sections[0])).toBe(false);
    expect(isSectionVisible(sections[1])).toBe(true);
    expect(isSectionVisible(sections[2])).toBe(false);
    expect(isSectionVisible(sections[3])).toBe(true);
    expect(sections[1]!.textContent).toContain("finance_approver");
    expect(sections[3]!.textContent).toContain("domain_admin");
    expect(grantsBody.textContent).not.toContain("This workflow currently conveys no authority.");
    expect(grantsBody.textContent).not.toContain("Could not read authority.");
  });

  it("keeps the loading overlay until all four grant lists settle, then clears it and shows the empty state when there is no workflow authority", async () => {
    const pendingDirect = deferred<Response>();
    const route = mountWorkflowsRoute((body) => {
      const member = body.memberPath[0]?.member;
      if (member === "catalog") {
        return Response.json({
          status: "ready",
          value: { rows: [workflowRow("wf-2", "Draft workflow")], total: 1 },
        });
      }
      if (member === "grantsInForceTitle") {
        return Response.json({
          status: "ready",
          value: { primaryKey: "wf-2", label: "Draft workflow", fields: { activeGrantVersion: "v1" } },
        });
      }
      if (member === "grantCaseScopedSteps" || member === "grantInForce") {
        return Response.json({ status: "ready", value: [] });
      }
      if (member === "grantSuperseded") {
        return Response.json({ status: "empty" });
      }
      if (member === "grantDirect") {
        return pendingDirect.promise;
      }
      return Response.json({ status: "empty" });
    });

    const root = await route.open();
    const grantLink = await vi.waitFor(() => {
      const btn = root.querySelector<HTMLButtonElement>(".wf-grant-link");
      expect(btn).not.toBeNull();
      return btn!;
    });
    grantLink.click();

    const grantsBody = await vi.waitFor(() => {
      const el = document.body.querySelector<HTMLElement>(".wf-grants-body");
      expect(el).not.toBeNull();
      expect(isLoadingMaskActive(el!)).toBe(true);
      return el!;
    });
    expect(grantsBody.textContent).not.toContain("This workflow currently conveys no authority.");

    pendingDirect.resolve(
      Response.json({
        status: "ready",
        value: [grantRow("g-direct", "domain_admin", ["expense.audit"])],
      }),
    );

    await vi.waitFor(() => {
      expect(isLoadingMaskActive(grantsBody)).toBe(false);
    });
    expect(grantsBody.textContent).toContain("This workflow currently conveys no authority.");
    const sections = [...grantsBody.querySelectorAll<HTMLElement>("section.wf-grants-group")];
    expect(sections.every((section) => !isSectionVisible(section))).toBe(true);
  });

  it.each([
    { name: "error", response: { status: "error", message: "grant store unreachable" } },
    { name: "forbidden", response: { status: "forbidden", reason: "not allowed" } },
  ])("clears the loading overlay and shows the unavailable state when any grant list returns $name", async ({ response }) => {
    const route = mountWorkflowsRoute((body) => {
      const member = body.memberPath[0]?.member;
      if (member === "catalog") {
        return Response.json({
          status: "ready",
          value: { rows: [workflowRow("wf-3", "Restricted workflow")], total: 1 },
        });
      }
      if (member === "grantsInForceTitle") {
        return Response.json({
          status: "ready",
          value: { primaryKey: "wf-3", label: "Restricted workflow", fields: { activeGrantVersion: "v1" } },
        });
      }
      if (member === "grantInForce") {
        return Response.json(response);
      }
      return Response.json({ status: "ready", value: [] });
    });

    const root = await route.open();
    const grantLink = await vi.waitFor(() => {
      const btn = root.querySelector<HTMLButtonElement>(".wf-grant-link");
      expect(btn).not.toBeNull();
      return btn!;
    });
    grantLink.click();

    const grantsBody = await vi.waitFor(() => {
      const el = document.body.querySelector<HTMLElement>(".wf-grants-body");
      expect(el).not.toBeNull();
      expect(isLoadingMaskActive(el!)).toBe(false);
      return el!;
    });
    expect(grantsBody.textContent).toContain("Could not read authority.");
    const sections = [...grantsBody.querySelectorAll<HTMLElement>("section.wf-grants-group")];
    expect(sections.every((section) => !isSectionVisible(section))).toBe(true);
  });
});
