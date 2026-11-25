import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import * as panelCheck from "@ontomato/contracts/panel-check";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";

beforeAll(() => {
  installContentLayout({
    runtimeRoot: process.cwd(),
    publicSkillsRoot: process.cwd(),
    prompts: [],
    runtimeResources: [],
  });
});

describe("built-in workflows panel validation", () => {
  it("passes checkBuiltinPanelSource, projection expansion, reference checks, ontology.json registration, and avoids usePanelData", async () => {
    const repoRoot = resolve(__dirname, "../../../../../..");
    const dir = resolve(repoRoot, "packages/ontology-manager/resources/builtin-panels/workflows");
    const { checkBuiltinPanelSource } = await import(
      resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
    );
    const { components } = await import(resolve(repoRoot, "packages/apps-sdk/src/catalogue.ts"));
    const { validateProjectionComponent } = await import("../../product-panels/component-catalogue");
    const { validateBuiltinProductReferences } = await import("../../product-panels/references");
    const { platformTypeEntries } = await import("../../product-panels/type-table");

    const typeMap = platformTypeEntries();
    const draftReadOperationIds = [...typeMap.values()].flatMap(({ operations = [] }) =>
      operations
        .filter((operation) => operation.effect === "read" && operation.target.source === "draft")
        .map((operation) => operation.id),
    );

    const checkResult = await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds });
    expect(checkResult.panelId).toBe("builtin-product-ontology-workflows");

    const html = readFileSync(resolve(dir, "panel.html"), "utf8");
    const mod = readFileSync(resolve(dir, "panel.mjs"), "utf8");
    const desc = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));
    const reg = JSON.parse(readFileSync(resolve(dir, "registration.json"), "utf8"));

    expect(mod).not.toContain("usePanelData");
    expect(html).not.toMatch(/el-|--el-|v-loading/);
    expect(html).not.toContain("@state-change");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain(".sdk-object-list-table");
    expect(desc.manifest.members).not.toHaveProperty("grantsHeader");
    expect(desc.manifest.members).toHaveProperty("grantsInForceTitle");
    expect(desc.manifest.members.catalog.config.rowActions).toMatchObject({
      maxVisible: 4,
      fixed: "right",
    });
    expect(Object.values(desc.manifest.members as Record<string, { component?: string }>)).not.toContainEqual(
      expect.objectContaining({ component: "PanelData" }),
    );
    expect(desc.manifest.state.search.deepLink).toBe(true);
    expect(desc.manifest.state.viewing.deepLink).toBe(false);
    expect(desc.manifest.state.creating.deepLink).toBe(false);
    expect(desc.manifest.state.inspectingGrants.deepLink).toBe(false);
    expect(desc.manifest.members.viewForm.operation).toBe("platform:Workflow.save");
    for (const tableSlot of ["catalog", "grantCaseScopedSteps", "grantInForce", "grantSuperseded", "grantDirect"] as const) {
      const columns = desc.manifest.members[tableSlot].config.columns as Array<{ key: string; labelKey?: string }>;
      for (const column of columns) {
        expect(column.labelKey, `${tableSlot}.${column.key} must declare labelKey for empty headers`).toBeTruthy();
        expect(desc.content.messages.en[column.labelKey!]).toBeTruthy();
        expect(desc.content.messages["zh-CN"][column.labelKey!]).toBeTruthy();
      }
    }

    const typeTable = {
      objectTypes: z.record(platformTypeTableEntrySchema).parse(Object.fromEntries(typeMap)),
    };
    const catalogueMap = new Map(
      components.map((component: { module: string; componentId: string }) => {
        const pkg = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
        return [`${pkg}:${component.componentId}`, component];
      }),
    );
    const readCatalogue = async () => ({ version: "1.1.2", digest: "test", components: catalogueMap });

    const panels = new Map();
    const projections = new Map();
    const { state, members, ...decl } = desc.manifest;
    const placements = Object.fromEntries(
      Object.entries(members).map(([member, def]) => {
        if (!("component" in (def as Record<string, unknown>))) return [member, def];
        const typed = def as { id: string; name?: string; description?: string };
        const { projection, placement } = panelCheck.expandPanelAuthoringMember(member, def as never, {
          state,
          components: [...catalogueMap.values()] as never,
          typeTable,
        });
        projections.set(
          typed.id,
          panelCheck.builtinProductProjectionInputSchema.parse({
            ...projection,
            visibility: "platform",
            name: typed.name ?? member,
            description: typed.description ?? member,
          }),
        );
        return [member, { ...placement, target: { projectionId: typed.id } }];
      }),
    );

    const { id, input } = reg.panels[0];
    panels.set(
      id,
      panelCheck.builtinProductPanelInputSchema.parse({
        ...input,
        visibility: "platform",
        manifest: { ...decl, state, members: placements },
        content: { ...desc.content, html, module: mod },
      }),
    );

    for (const [projId, proj] of projections) {
      await validateProjectionComponent(projId, proj, readCatalogue as never);
    }
    await validateBuiltinProductReferences(panels, projections, readCatalogue as never);

    expect(typeMap.get(WORKFLOW)?.reads).toHaveProperty("query");
    expect(typeMap.get(WORKFLOW)?.reads).toHaveProperty("grantCaseScopedSteps");

    const ontology = JSON.parse(
      readFileSync(resolve(repoRoot, "packages/data-engine-core/src/main/resources/applications/ontology.json"), "utf8"),
    );
    const uses = ontology.declaration.panelUses as Array<{
      id: string;
      pageKey: string;
      panelId: string;
      path: string;
      groupKey?: string;
    }>;
    const actionsIndex = uses.findIndex((entry) => entry.id === "ontology-actions");
    const workflowsIndex = uses.findIndex((entry) => entry.id === "ontology-workflows");
    const skillsIndex = uses.findIndex((entry) => entry.id === "ontology-skills");
    expect(workflowsIndex).toBeGreaterThan(actionsIndex);
    expect(workflowsIndex).toBeLessThan(skillsIndex);
    expect(uses[workflowsIndex]).toMatchObject({
      id: "ontology-workflows",
      pageKey: "ontology-workflows",
      panelId: "builtin-product-ontology-workflows",
      path: "/ontology/assets/workflows",
      groupKey: "capabilities",
    });
  }, 30_000);
});
