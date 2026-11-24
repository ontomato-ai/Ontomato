import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as panelCheck from "@ontomato/contracts/panel-check";
import { AUDIT_LOG, GENERAL_SETTINGS } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { validateBuiltinProductReferences } from "../../product-panels/references";
import { validateProjectionComponent } from "../../product-panels/component-catalogue";
import { platformTypeEntries } from "../../product-panels/type-table";

vi.mock("../../assistant/skills", () => ({}));

const EIGHT_LOCALES = ["en", "zh-CN", "zh-TW", "ja", "de", "fr", "it", "ar"] as const;

describe("built-in general settings and audit log panels validation", () => {
  it("passes checkBuiltinPanelSource, projection expansion, reference checks, settings.json uses, and 8-locale parity", async () => {
    const repoRoot = resolve(__dirname, "../../../../../..");
    const { checkBuiltinPanelSource } = await import(
      resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
    );
    const { components } = await import(resolve(repoRoot, "packages/apps-sdk/src/catalogue.ts"));

    const typeMap = platformTypeEntries();
    expect(typeMap.has(GENERAL_SETTINGS)).toBe(true);
    expect(typeMap.has(AUDIT_LOG)).toBe(true);

    const draftReadOperationIds = [...typeMap.values()].flatMap(({ operations = [] }) =>
      operations
        .filter((operation) => operation.effect === "read" && operation.target.source === "draft")
        .map((operation) => operation.id),
    );
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
    for (const dirName of ["general-settings", "audit-log"]) {
      const dir = resolve(repoRoot, "packages/platform-admin/resources/builtin-panels", dirName);
      await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds });
      const mod = readFileSync(resolve(dir, "panel.mjs"), "utf8");
      const html = readFileSync(resolve(dir, "panel.html"), "utf8");
      expect(mod).not.toContain("usePanelData");
      expect(html).not.toMatch(/<el-|--el-/);

      const reg = JSON.parse(readFileSync(resolve(dir, "registration.json"), "utf8"));
      const desc = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));

      // Verify all 8 locales exist and share the exact same message keys.
      const messages = desc.content?.messages ?? {};
      const enKeys = Object.keys(messages.en ?? {}).sort();
      expect(enKeys.length).toBeGreaterThan(0);
      for (const locale of EIGHT_LOCALES) {
        expect(messages[locale], `${dirName} missing locale ${locale}`).toBeDefined();
        expect(Object.keys(messages[locale]).sort(), `${dirName} locale ${locale} key mismatch`).toEqual(enKeys);
        for (const key of enKeys) {
          expect(typeof messages[locale][key]).toBe("string");
          expect(messages[locale][key].trim().length, `${dirName} ${locale}.${key} empty`).toBeGreaterThan(0);
        }
      }

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
    }

    for (const [id, proj] of projections) {
      await validateProjectionComponent(id, proj, readCatalogue as never);
    }
    await validateBuiltinProductReferences(panels, projections, readCatalogue as never);

    const settings = JSON.parse(
      readFileSync(
        resolve(repoRoot, "packages/data-engine-core/src/main/resources/applications/settings.json"),
        "utf8",
      ),
    );
    const uses = settings.declaration.panelUses.filter(
      (use: { id: string }) => use.id === "general-settings" || use.id === "audit-log",
    );
    expect(uses).toHaveLength(2);
    for (const use of uses) {
      panelCheck.builtinApplicationPanelUseSchema.parse(use);
      expect(panels.has(use.panelId)).toBe(true);
      for (const locale of EIGHT_LOCALES) {
        expect(use.names?.[locale], `settings.json use ${use.id} missing name for ${locale}`).toBeTruthy();
      }
      expect(use.descriptions?.en).toBeTruthy();
      expect(use.descriptions?.["zh-CN"]).toBeTruthy();
    }
  });
});
