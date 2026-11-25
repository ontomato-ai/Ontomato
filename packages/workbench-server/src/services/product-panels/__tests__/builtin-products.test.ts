import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { components } from "../../../../../apps-sdk/src/catalogue";
import * as panelCheck from "@ontomato/contracts/panel-check";
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
  it("loads and validates every shipped builtin panel and platform projection against startup schemas", async () => {
    const { readBuiltinProducts } = await import("../builtin-products");
    const packagesRoot = path.resolve(__dirname, "../../../../..");
    const roots = [
      path.join(packagesRoot, "ontology-manager/resources/builtin-panels"),
      path.join(packagesRoot, "platform-schedules/resources/builtin-panels"),
      path.join(packagesRoot, "platform-admin/resources/builtin-panels"),
      path.join(packagesRoot, "platform-shell/resources/builtin-panels"),
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
      expect(agentDetail.manifest.members).toHaveProperty("userPicker");
      expect(agentDetail.manifest.members).toHaveProperty("rolePicker");
      expect(agentDetail.manifest.members).toHaveProperty("grantSubmit");
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
      expect(dashboardsPanel!.content.html).not.toMatch(/<el-|--el-|:deep\(/);
      expect(dashboardsPanel!.content.module).not.toContain("usePanelData");

      const repoRoot = path.resolve(packagesRoot, "..");
      const { checkBuiltinPanelSource } = await import(
        path.join(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
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
});
