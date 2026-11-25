import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import * as panelCheck from "@ontomato/contracts/panel-check";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { TRIGGER } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";

beforeAll(() => {
  installContentLayout({
    runtimeRoot: process.cwd(),
    publicSkillsRoot: process.cwd(),
    prompts: [],
    runtimeResources: [],
  });
});

describe("built-in triggers panel validation", () => {
  it("passes checkBuiltinPanelSource, projection expansion, reference checks, and parity contracts", async () => {
    const repoRoot = resolve(__dirname, "../../../../../..");
    const dir = resolve(repoRoot, "packages/ontology-manager/resources/builtin-panels/triggers");
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
    expect(checkResult.panelId).toBe("builtin-product-ontology-triggers");

    const html = readFileSync(resolve(dir, "panel.html"), "utf8");
    const mod = readFileSync(resolve(dir, "panel.mjs"), "utf8");
    const desc = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));
    const reg = JSON.parse(readFileSync(resolve(dir, "registration.json"), "utf8"));

    expect(mod).not.toContain("usePanelData");
    expect(html).not.toMatch(/el-|--el-|v-loading/);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<sdk-tag");
    expect(html).toContain(':before-close="beforeCloseDialog"');
    expect(desc.manifest.members.armedStats.config.appearance).toBe("default");
    expect(desc.manifest.members.totalStats.config.appearance).toBe("default");

    const columns = desc.manifest.members.triggers.config.columns as Array<{ key: string; labelKey?: string; subtitleKey?: string }>;
    expect(columns.map((column) => column.key)).toEqual([
      "triggerTitle",
      "effect",
      "conditionKind",
      "cadence",
      "nextRunAt",
      "status",
    ]);
    expect(columns[0]?.subtitleKey).toBeUndefined();
    for (const column of columns) {
      expect(column.labelKey).toBeTruthy();
      expect(desc.content.messages.en[column.labelKey!]).toBeTruthy();
      expect(desc.content.messages["zh-CN"][column.labelKey!]).toBeTruthy();
    }

    expect(desc.manifest.members.triggers.config.rowActions).toMatchObject({
      align: "left",
      maxVisible: 3,
      items: [
        { kind: "local", id: "edit", icon: "pencil", iconOnly: true },
        { kind: "operation", operation: "disable", when: { field: "statusCode", equals: "PUBLISHED" } },
        { kind: "operation", operation: "publish", when: { field: "statusCode", notEquals: "PUBLISHED" } },
        { kind: "operation", operation: "remove", icon: "trash-2", iconOnly: true, tone: "danger" },
      ],
    });

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
    expect(typeMap.get(TRIGGER)?.reads).toHaveProperty("query");
  }, 30_000);
});
