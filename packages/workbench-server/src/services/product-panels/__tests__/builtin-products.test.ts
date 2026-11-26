import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { components } from "../../../../../apps-sdk/src/catalogue";
import * as panelCheck from "@ontomato/contracts/panel-check";
import { PERMISSION_POLICY } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";

vi.mock("../../app-builder/sdk", () => ({
  readCurrentAppSdkComponents: async () => ({
    version: "test",
    digest: "0".repeat(64),
    catalogue: {
      version: "test",
      components: components.map((component) => ({
        ...component,
        ports: { props: [], slots: [], events: [] },
      })),
    },
  }),
}));

beforeAll(() => {
  installContentLayout({
    runtimeRoot: process.cwd(),
    publicSkillsRoot: process.cwd(),
    prompts: [],
    runtimeResources: [],
  });
});

describe("readBuiltinProducts", () => {
  it("loads short and formal candidates from their owner directory before checking references", async () => {
    const { readBuiltinProducts } = await import("../builtin-products");
    const bundle = await mkdtemp(path.join(tmpdir(), "builtin-candidates-"));
    const reader = path.join(bundle, "reader");
    const owner = path.join(bundle, "owner");
    const shortId = "builtin-product-short-count";
    const formalId = "builtin-product-formal-count";
    const formal = {
      name: "Formal count", description: "", visibility: "platform", componentId: "@ontomato/sdk:ObjectCount",
      inputs: {}, outputs: {}, config: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: "platform:ObjectType" } }, read: "count", params: {} } },
    };
    const short = { component: "ObjectCount", type: "platform:ObjectType", data: { rows: "count" } };
    const candidates = [
      { id: shortId, input: short },
      { id: formalId, input: formal },
    ];
    try {
      await writeFile(path.join(bundle, "index.json"), JSON.stringify(["reader", "owner"]));
      for (const [directory, name, members] of [
        [reader, "reader", { count: { target: { fromState: "choice", candidates: { projectionIds: [shortId, formalId] } } } }],
        [owner, "owner", {}],
      ] as const) {
        await mkdir(directory);
        await writeFile(path.join(directory, "registration.json"), JSON.stringify({
          panels: [{ id: `builtin-product-${name}`, input: { name, description: "" } }],
        }));
        await writeFile(path.join(directory, "panel.json"), JSON.stringify({
          manifest: { state: { choice: { type: { kind: "object", objectType: "platform:ProductProjection" } } }, members },
        }));
        await writeFile(path.join(directory, "panel.html"), "<main></main>");
      }
      const file = path.join(owner, "projections.json");
      await writeFile(file, JSON.stringify(candidates));
      const { projections } = await readBuiltinProducts(bundle);
      expect(projections.get(shortId)?.data.rows?.read).toBe("count");
      expect(projections.get(formalId)?.data.rows?.read).toBe("count");

      await writeFile(file, JSON.stringify([candidates[0]]));
      await expect(readBuiltinProducts(bundle)).rejects.toThrow(new RegExp(formalId));

      await writeFile(file, JSON.stringify([candidates[0], { id: formalId, input: { ...formal, componentId: "@ontomato/sdk:MissingCount" } }]));
      await expect(readBuiltinProducts(bundle)).rejects.toMatchObject({ code: "PANEL_COMPONENT_UNAVAILABLE" });
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  });

  it("loads and validates every shipped builtin panel and platform projection against startup schemas", async () => {
    const { readBuiltinProducts } = await import("../builtin-products");
    const packagesRoot = path.resolve(__dirname, "../../../../..");
    const roots = [
      path.join(packagesRoot, "ontology-manager/resources/builtin-panels"),
      path.join(packagesRoot, "platform-schedules/resources/builtin-panels"),
      path.join(packagesRoot, "platform-admin/resources/builtin-panels"),
      path.join(packagesRoot, "platform-shell/resources/builtin-panels"),
      path.join(packagesRoot, "workbench-ui/resources/builtin-panels"),
    ];

    const bundle = await mkdtemp(path.join(tmpdir(), "builtin-products-test-"));
    try {
      const entries: string[] = [];
      for (const root of roots) {
        for (const dirent of await readdir(root, { withFileTypes: true })) {
          if (!dirent.isDirectory()) continue;
          const relative = `${path.basename(path.resolve(root, "../.."))}-${dirent.name}`;
          await symlink(path.join(root, dirent.name), path.join(bundle, relative));
          entries.push(relative);
        }
      }
      await writeFile(path.join(bundle, "index.json"), JSON.stringify(entries));

      const { panels, projections } = await readBuiltinProducts(bundle);

      expect(panels.size).toBe(entries.length);
      expect(projections.size).toBeGreaterThan(0);
      expect(panels.has("builtin-product-ontology-actions")).toBe(true);
      expect(panels.has("builtin-product-ontology-action-detail")).toBe(true);
      expect(panels.has("builtin-product-ontology-metric-views")).toBe(true);
      expect(panels.has("builtin-product-ontology-metric-view-detail")).toBe(true);
      expect(panels.has("builtin-product-ontology-functions")).toBe(true);
      expect(panels.has("builtin-product-ontology-function-detail")).toBe(true);
      expect(panels.has("builtin-product-agent-settings")).toBe(true);
      expect(panels.has("builtin-product-agent-detail")).toBe(true);

      const agentsCatalog = panels.get("builtin-product-agent-settings")!;
      expect(agentsCatalog.manifest.state).toHaveProperty("search");
      expect(agentsCatalog.manifest.state).toHaveProperty("creating");
      expect(agentsCatalog.manifest.state).toHaveProperty("detailPath");
      expect(agentsCatalog.manifest.state).not.toHaveProperty("selected");
      expect(agentsCatalog.manifest.state).not.toHaveProperty("mode");
      expect(agentsCatalog.content.html).not.toContain("two-pane-layout");

      const agentDetail = panels.get("builtin-product-agent-detail")!;
      expect(agentDetail.manifest.state).toHaveProperty("selected");
      expect(agentDetail.manifest.state).toHaveProperty("catalogPath");
      expect(agentDetail.manifest.state.tab?.deepLink).toBe(true);
      expect(agentDetail.manifest.state.grantDialog?.deepLink).toBe(false);
      expect(agentDetail.manifest.members).toHaveProperty("header");
      expect(agentDetail.manifest.members).toHaveProperty("form");
      expect(agentDetail.manifest.members).toHaveProperty("remove");
      expect(agentDetail.manifest.members).toHaveProperty("grantsList");
      expect(agentDetail.manifest.members).toHaveProperty("shareStatusDesc");
      expect(agentDetail.manifest.members).toHaveProperty("shareEnable");
      expect(agentDetail.manifest.members).toHaveProperty("shareDisable");
      const agentProjection = (slot: string) => {
        const member = agentDetail.manifest.members[slot];
        if (member && "target" in member && "projectionId" in member.target) {
          return projections.get(member.target.projectionId);
        }
      };
      expect(agentDetail.manifest.state.grantPolicy?.type).toEqual({ kind: "object", objectType: PERMISSION_POLICY });
      expect(agentProjection("policyPicker")).toMatchObject({
        componentId: "@ontomato/sdk:ReferencePicker",
        data: {
          options: { source: { type: { id: PERMISSION_POLICY } }, read: "options" },
          selected: { source: { type: { id: PERMISSION_POLICY } }, read: "resolve" },
        },
      });
      expect(agentProjection("grantSubmit")?.operations).toMatchObject({
        grant: {
          operation: { kind: "PlatformOperation", id: "agents.grant" },
          params: { policyId: { input: "policyId" }, verb: { input: "verb" } },
        },
      });
      expect(agentProjection("grantsList")?.operations?.revoke).toMatchObject({
        operation: { kind: "PlatformOperation", id: "agents.revoke" },
      });
      expect(agentDetail.manifest.members).not.toHaveProperty("userPicker");
      expect(agentDetail.manifest.members).not.toHaveProperty("rolePicker");
      expect(agentDetail.content.html).not.toContain('v-if="detailReady" #actions');

      const functionsCatalog = panels.get("builtin-product-ontology-functions")!;
      expect(functionsCatalog.manifest.state).not.toHaveProperty("selected");
      expect(functionsCatalog.manifest.state).not.toHaveProperty("creating");
      expect(functionsCatalog.content.html).not.toContain("two-pane-layout");

      const functionDetail = panels.get("builtin-product-ontology-function-detail")!;
      expect(functionDetail.manifest.members).toHaveProperty("header");
      expect(functionDetail.manifest.members).toHaveProperty("definition");
      expect(functionDetail.manifest.members).toHaveProperty("remove");
      expect(functionDetail.content.html).not.toContain('v-if="detailReady" #actions');
      expect(panels.has("builtin-product-skills-library")).toBe(true);
      expect(panels.has("builtin-product-skills-library-detail")).toBe(true);
      expect(panels.has("builtin-product-ontology-triggers")).toBe(true);

      const triggersPanel = panels.get("builtin-product-ontology-triggers");
      expect(triggersPanel).toBeDefined();
      expect(triggersPanel!.manifest.state.search?.deepLink).toBe(true);
      expect(triggersPanel!.manifest.state.creating?.deepLink).toBe(false);
      expect(triggersPanel!.manifest.state.editing?.deepLink).toBe(false);
      expect(triggersPanel!.content.html).not.toMatch(/<el-|--el-/);
      expect(triggersPanel!.content.module).not.toContain("usePanelData");
      expect(panels.has("builtin-product-ontology-workflows")).toBe(true);

      const generalSettings = panels.get("builtin-product-general-settings");
      expect(generalSettings).toBeDefined();
      expect(generalSettings!.manifest.state.settings?.external).toBe(true);
      expect(generalSettings!.manifest.members).toHaveProperty("generalForm");
      expect(generalSettings!.content.html).not.toMatch(/<el-|--el-/);
      expect(generalSettings!.content.module).not.toContain("usePanelData");

      const auditLog = panels.get("builtin-product-audit-log");
      expect(auditLog).toBeDefined();
      expect(auditLog!.manifest.state.selectedLog?.deepLink).toBe(true);
      expect(auditLog!.manifest.state.business?.deepLink).toBe(true);
      expect(auditLog!.manifest.state.operation?.deepLink).toBe(true);
      expect(auditLog!.manifest.members).toHaveProperty("logList");
      expect(auditLog!.manifest.members).toHaveProperty("logDetail");
      expect(auditLog!.content.html).not.toMatch(/<el-|--el-/);
      expect(auditLog!.content.module).not.toContain("usePanelData");

      const frame = panels.get("builtin-product-ontology-frame");
      expect(frame).toBeDefined();
      const countMembers = Object.entries(frame!.manifest.members).filter(([, member]) => "projectionId" in member.target);
      expect(countMembers).toHaveLength(19);

      expect(frame!.content.module).toContain('"/permissions/members": "members"');
      expect(frame!.content.module).toContain('"/permissions/roles": "roles"');
      expect(frame!.content.module).toContain('"/permissions/policies": "policies"');
      expect(frame!.content.module).toContain('"/permissions/organization": "organizationUnits"');

      const governanceQueryTypes: Record<string, string> = {
        members: "platform:User",
        roles: "platform:Role",
        policies: "platform:PermissionPolicy",
      };

      const expectedCountReads: Record<string, string> = {
        objectTypes: "platform:ObjectType",
        attributes: "platform:Attribute",
        relationships: "platform:Relationship",
        actions: "platform:Action",
        workflows: "platform:Workflow",
        triggers: "platform:Trigger",
        metricViews: "platform:MetricView",
        applications: "platform:Application",
        sdkComponents: "platform:SDKComponent",
        agents: "platform:AgentDefinition",
      };
      for (const [memberKey, member] of countMembers) {
        const projectionId = "projectionId" in member.target ? member.target.projectionId : "";
        const projection = projections.get(projectionId);
        expect(projection?.componentId).toBe("@ontomato/sdk:ObjectCount");
        expect(projection?.config).toEqual({ appearance: "badge" });
        if (Object.hasOwn(expectedCountReads, memberKey)) {
          expect(projection?.data.rows).toEqual({
            source: { type: { kind: "PlatformObjectType", id: expectedCountReads[memberKey] } },
            read: "count",
            params: {},
          });
        } else if (Object.hasOwn(governanceQueryTypes, memberKey)) {
          expect(projection?.data.rows).toEqual({
            source: { type: { kind: "PlatformObjectType", id: governanceQueryTypes[memberKey] } },
            read: "query",
            params: { page: { literal: { number: 1, size: 1 } } },
          });
        } else if (memberKey === "organizationUnits") {
          expect(projection?.data.rows).toEqual({
            source: { type: { kind: "PlatformObjectType", id: "platform:OrgUnit" } },
            read: "list",
            params: {},
          });
        } else {
          expect(projection?.data.rows?.read).toBe("query");
        }
      }
      expect(frame!.content.html).not.toContain(".sdk-object-count");

      const projectionsCatalogPanel = panels.get("builtin-product-ontology-projections");
      expect(projectionsCatalogPanel).toBeDefined();
      expect(projectionsCatalogPanel!.manifest.members).toHaveProperty("catalogue");
      expect(projectionsCatalogPanel!.manifest.members).toHaveProperty("createForm");
      expect(projectionsCatalogPanel!.manifest.members).not.toHaveProperty("deleteProjection");
      expect(projectionsCatalogPanel!.manifest.state).not.toHaveProperty("selected");
      expect(projectionsCatalogPanel!.manifest.state.creating?.deepLink).not.toBe(true);

      const projectionDetailPanel = panels.get("builtin-product-ontology-projection-detail");
      expect(projectionDetailPanel).toBeDefined();
      expect(projectionDetailPanel!.manifest.state.detailMode?.deepLink).not.toBe(true);
      expect(projectionDetailPanel!.manifest.state).not.toHaveProperty("deleteDialog");
      expect(projectionDetailPanel!.manifest.members).not.toHaveProperty("deleteSubmit");
      expect(projectionDetailPanel!.manifest.members).toHaveProperty("deleteProjection");
      const deleteMember = projectionDetailPanel!.manifest.members.deleteProjection;
      expect(deleteMember && "target" in deleteMember && "projectionId" in deleteMember.target).toBe(true);
      const deleteProjection = deleteMember && "target" in deleteMember && "projectionId" in deleteMember.target
        ? projections.get(deleteMember.target.projectionId)
        : undefined;
      expect(deleteProjection?.operations?.delete?.operation).toEqual({
        kind: "PlatformOperation",
        id: "productProjections.delete",
      });
      const recipes = projectionDetailPanel!.content.recipes ?? "";
      expect(recipes).not.toContain("deleteDialog");
      expect(recipes).not.toContain("deleteSubmit");
      expect(recipes).toContain("deleteProjection.delete");

      const panelsCatalog = panels.get("builtin-product-ontology-panels");
      const panelDetail = panels.get("builtin-product-ontology-panel-detail");
      expect(panelsCatalog).toBeDefined();
      expect(panelDetail).toBeDefined();
      expect(panelsCatalog!.manifest.state).not.toHaveProperty("selected");
      expect(panelsCatalog!.manifest.state.creating?.deepLink).not.toBe(true);
      expect(panelsCatalog!.manifest.members).toHaveProperty("catalogue");
      expect(panelsCatalog!.manifest.members).toHaveProperty("unavailableList");
      expect(panelsCatalog!.manifest.members).toHaveProperty("createForm");
      expect(panelDetail!.manifest.state.selected?.deepLink).toBe(true);
      expect(panelDetail!.manifest.state.detailMode?.deepLink).toBe(false);
      expect(panelDetail!.manifest.members).toHaveProperty("headerTitle");
      expect(panelDetail!.manifest.members).toHaveProperty("form");
      expect(panelDetail!.manifest.members).toHaveProperty("deletePanel");

      const dashboardsPanel = panels.get("builtin-product-dashboards");
      expect(dashboardsPanel).toBeDefined();
      expect(dashboardsPanel!.manifest.state.dashboardId?.deepLink).toBe(true);
      expect(dashboardsPanel!.manifest.state.cardId?.deepLink).toBe(true);
      expect(dashboardsPanel!.manifest.state.cardDialog?.deepLink).toBe(false);
      expect(dashboardsPanel!.manifest.state).not.toHaveProperty("selectedCard");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("boardTabs");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("createBoard");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("boardGrid");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("chartCard");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("metricCard");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("cardParamForm");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("cardMetricSource");
      expect(dashboardsPanel!.manifest.members).toHaveProperty("cardMetricOpen");
      expect(dashboardsPanel!.content.html).not.toMatch(/<el-|--el-|:deep\(/);
      expect(dashboardsPanel!.content.module).not.toContain("usePanelData");

      const personalWorkspace = panels.get("builtin-product-personal-workspace");
      expect(personalWorkspace).toBeDefined();
      expect(personalWorkspace!.manifest.state.layout?.personal).toBe(true);
      expect(personalWorkspace!.manifest.state.layout?.type).toMatchObject({
        kind: "grid-layout",
        columns: 12,
        maxRowSpan: 12,
        groupIds: ["workspace"],
        itemIds: ["apps", "dashboards", "tasks", "conversations", "objects", "recent"],
      });
      expect(personalWorkspace!.manifest.state.openModeObjects?.personal).toBe(true);
      expect(personalWorkspace!.manifest.state.openModeMetrics?.personal).toBe(true);
      expect(personalWorkspace!.manifest.state.openModeTasks?.personal).toBe(true);
      expect(personalWorkspace!.manifest.state.selectedObject?.type).toEqual({ kind: "object", objectType: "@any" });
      expect(personalWorkspace!.manifest.members).toHaveProperty("homeStatus");
      expect(personalWorkspace!.manifest.members).toHaveProperty("homeActions");
      expect(personalWorkspace!.manifest.members).toHaveProperty("askInline");
      expect(personalWorkspace!.manifest.members).toHaveProperty("customizeWorkspace");
      expect(personalWorkspace!.manifest.members).toHaveProperty("workspaceGrid");
      expect(personalWorkspace!.manifest.members).toHaveProperty("favoriteApps");
      expect(personalWorkspace!.manifest.members).toHaveProperty("favoriteDashboards");
      expect(personalWorkspace!.manifest.members).toHaveProperty("favoriteDashboardCards");
      expect(personalWorkspace!.manifest.members).toHaveProperty("scheduledTasks");
      expect(personalWorkspace!.manifest.members).toHaveProperty("taskSummary");
      expect(personalWorkspace!.manifest.members).toHaveProperty("recentConversations");
      expect(personalWorkspace!.manifest.members).toHaveProperty("pinnedObjects");
      expect(personalWorkspace!.manifest.members).toHaveProperty("recentVisits");
      expect(personalWorkspace!.manifest.members).toHaveProperty("objectDetail");
      const pwMemberProjection = (slot: string) => {
        const member = personalWorkspace!.manifest.members[slot];
        if (!member || !("projectionId" in member.target)) return undefined;
        return projections.get(member.target.projectionId);
      };
      expect(pwMemberProjection("workspaceGrid")?.config).toMatchObject({
        itemSurface: "section",
        rowSizing: "auto",
        itemHeaderDivider: "none",
        controlsVisibility: "hover",
        gap: 24,
      });
      expect(pwMemberProjection("favoriteApps")?.config).toMatchObject({
        layout: "cards",
        leadingIconField: "icon",
      });
      expect(pwMemberProjection("pinnedObjects")?.config).toMatchObject({
        rowActions: {
          maxVisible: 1,
          items: expect.arrayContaining([
            expect.objectContaining({
              kind: "conversation",
              id: "askObject",
              target: { kind: "page-default" },
              labelKey: "action.askAgent",
              prefillKey: "action.askObjectPrefill",
              icon: "sparkles",
            }),
          ]),
        },
      });
      expect(pwMemberProjection("favoriteDashboardCards")?.componentId).toBe("@ontomato/sdk:GroupedGrid");
      expect(pwMemberProjection("favoriteDashboardCardsNotice")?.componentId).toBe("@ontomato/sdk:InfoBanner");
      expect(pwMemberProjection("previewMetricCard")?.componentId).toBe("@ontomato/sdk:MetricCard");
      expect(pwMemberProjection("previewChartCard")?.componentId).toBe("@ontomato/sdk:MetricChart");
      expect(pwMemberProjection("cardChartPreview")?.componentId).toBe("@ontomato/sdk:MetricChart");
      expect(pwMemberProjection("cardChartPreview")?.data).toEqual({
        template: expect.objectContaining({ read: "chartTemplate" }),
        result: expect.objectContaining({ read: "result" }),
      });
      expect(pwMemberProjection("scheduledTasks")?.componentId).toBe("@ontomato/sdk:ScheduledTaskSummaryList");
      expect(personalWorkspace!.manifest.members.taskSummary?.target).toEqual({
        panelId: "builtin-product-scheduled-task-run-detail",
      });
      const runDetailPanel = panels.get("builtin-product-scheduled-task-run-detail");
      expect(runDetailPanel).toBeDefined();
      expect(runDetailPanel!.content.html).not.toMatch(/<el-|--el-|:deep\(/);
      expect(personalWorkspace!.content.html).toContain("<object-title");
      expect(personalWorkspace!.content.html).toContain('slot="cardChartPreview"');
      expect(personalWorkspace!.content.module).toContain("currentUser");
      expect(personalWorkspace!.content.html).not.toMatch(/<el-|--el-|:deep\(/);
      expect(personalWorkspace!.content.module).not.toContain("usePanelData");

      const applicationGallery = panels.get("builtin-product-application-gallery");
      expect(applicationGallery).toBeDefined();
      const galleryMember = applicationGallery!.manifest.members.applications;
      const galleryProjection = galleryMember && "projectionId" in galleryMember.target
        ? projections.get(galleryMember.target.projectionId)
        : undefined;
      expect(galleryProjection?.config).toMatchObject({
        layout: "cards",
        leadingIconField: "icon",
        skeletonCount: 6,
        actionErrorPlacement: "top",
      });

      const repoRoot = path.resolve(packagesRoot, "..");
      const { checkBuiltinPanelSource } = await import(
        path.join(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
      );
      await checkBuiltinPanelSource(
        path.join(packagesRoot, "platform-shell/resources/builtin-panels/application-gallery"),
        { ...panelCheck, draftReadOperationIds: [] },
      );
      await checkBuiltinPanelSource(
        path.join(packagesRoot, "platform-shell/resources/builtin-panels/personal-workspace"),
        { ...panelCheck, draftReadOperationIds: [] },
      );
      await checkBuiltinPanelSource(
        path.join(packagesRoot, "platform-schedules/resources/builtin-panels/scheduled-task-run-detail"),
        { ...panelCheck, draftReadOperationIds: [] },
      );
      await checkBuiltinPanelSource(
        path.join(packagesRoot, "ontology-manager/resources/builtin-panels/projections"),
        { ...panelCheck, draftReadOperationIds: [] },
      );
      await checkBuiltinPanelSource(
        path.join(packagesRoot, "ontology-manager/resources/builtin-panels/projection-detail"),
        { ...panelCheck, draftReadOperationIds: [] },
      );
      await checkBuiltinPanelSource(
        path.join(packagesRoot, "ontology-manager/resources/builtin-panels/agent-detail"),
        { ...panelCheck, draftReadOperationIds: [] },
      );
      expect(projectionsCatalogPanel!.content.module).not.toContain("usePanelData");
      expect(projectionDetailPanel!.content.module).not.toContain("usePanelData");
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  }, 30_000);

  it("makes the capability map a shell that names neither half's projection nor its members", async () => {
    const { readBuiltinProducts } = await import("../builtin-products");
    const packagesRoot = path.resolve(__dirname, "../../../../..");
    const bundle = await mkdtemp(path.join(tmpdir(), "builtin-capability-map-"));
    try {
      const entries: string[] = [];
      for (const root of [path.join(packagesRoot, "ontology-manager/resources/builtin-panels")]) {
        for (const dirent of await readdir(root, { withFileTypes: true })) {
          if (!dirent.isDirectory()) continue;
          const relative = `ontology-manager-${dirent.name}`;
          await symlink(path.join(root, dirent.name), path.join(bundle, relative));
          entries.push(relative);
        }
      }
      await writeFile(path.join(bundle, "index.json"), JSON.stringify(entries));
      const { panels, projections } = await readBuiltinProducts(bundle);

      const map = panels.get("builtin-product-capability-map")!;
      const graph = panels.get("builtin-product-ontology-graph")!;
      const browser = panels.get("builtin-product-data-browser")!;

      // Two fixed members, one per half, each handed only a source and the states it owns.
      expect(Object.keys(map.manifest.members).sort()).toEqual(["instances", "types"]);
      expect(map.manifest.members.types.target).toEqual({ panelId: "builtin-product-ontology-graph" });
      expect(map.manifest.members.instances.target).toEqual({ panelId: "builtin-product-data-browser" });
      expect(map.manifest.members.types.inputs).toHaveProperty("dataSource", { literal: "platform" });
      expect(map.manifest.members.instances.inputs).toHaveProperty("dataSource", { literal: "platform" });

      // Neither half's projection, nor the name of any member of theirs, appears in this panel's declaration.
      const declared = JSON.stringify(map.manifest);
      for (const id of projections.keys()) expect(declared).not.toContain(id);
      const otherMembers = [...Object.keys(graph.manifest.members), ...Object.keys(browser.manifest.members)];
      const declaredMembers = JSON.stringify(map.manifest.members);
      for (const member of otherMembers) expect(declaredMembers).not.toContain(`"${member}"`);

      // Each half opens four or five states and no switch of its own: no `embedded`, no projection choice.
      const external = (panel: typeof graph) => Object.entries(panel.manifest.state)
        .filter(([, field]) => field.external).map(([name]) => name).sort();
      expect(external(graph)).toEqual(["dataSource", "exploreTypeRequest", "objectType", "relation"]);
      expect(external(browser)).toEqual(["dataSource", "graphStart", "selectedClass", "selectedNode", "viewMode"]);
      for (const panel of [map, graph, browser]) expect(panel.manifest.state).not.toHaveProperty("embedded");
      // The halves' projection choices start empty: the panel writes them on its first frame.
      const chosen = Object.entries(graph.manifest.state)
        .filter(([name, field]) => name !== "dataSource" && name.endsWith("Source") && "external" in field && !field.external);
      expect(chosen.length).toBeGreaterThan(0);
      for (const [, field] of chosen) expect(field.default).toBeUndefined();

      // Both halves register their own two sets; the shell registers none.
      const owned = [...projections.keys()];
      expect(owned.some(id => id.includes("capability"))).toBe(true);
      expect(map.content.html).toContain("<projection v-if=\"mode === 'type'\" slot=\"types\">");
      expect(graph.content.html).not.toContain("productGraph");
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  }, 30_000);
});
