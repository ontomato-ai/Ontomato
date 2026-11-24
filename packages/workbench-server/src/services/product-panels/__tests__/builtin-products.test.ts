import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { components } from "../../../../../apps-sdk/src/catalogue";
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

      const frame = panels.get("builtin-product-ontology-frame");
      expect(frame).toBeDefined();
      const countMembers = Object.entries(frame!.manifest.members).filter(([, member]) => "projectionId" in member.target);
      expect(countMembers).toHaveLength(15);

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
        } else {
          expect(projection?.data.rows?.read).toBe("query");
        }
      }
      expect(frame!.content.html).not.toContain(".sdk-object-count");

      const projectionsPanel = panels.get("builtin-product-ontology-projections");
      expect(projectionsPanel).toBeDefined();
      expect(projectionsPanel!.manifest.state).not.toHaveProperty("deleteDialog");
      expect(projectionsPanel!.manifest.members).not.toHaveProperty("deleteSubmit");
      expect(projectionsPanel!.manifest.members).toHaveProperty("deleteProjection");
      const deleteMember = projectionsPanel!.manifest.members.deleteProjection;
      expect(deleteMember && "target" in deleteMember && "projectionId" in deleteMember.target).toBe(true);
      const deleteProjection = deleteMember && "target" in deleteMember && "projectionId" in deleteMember.target
        ? projections.get(deleteMember.target.projectionId)
        : undefined;
      expect(deleteProjection?.operations?.delete?.operation).toEqual({
        kind: "PlatformOperation",
        id: "productProjections.delete",
      });
      const recipes = projectionsPanel!.content.recipes ?? "";
      expect(recipes).not.toContain("deleteDialog");
      expect(recipes).not.toContain("deleteSubmit");
      expect(recipes).toContain("deleteProjection.delete");
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  });
});
