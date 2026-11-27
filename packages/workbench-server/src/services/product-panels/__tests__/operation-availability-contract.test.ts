import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { components } from "../../../../../apps-sdk/src/catalogue";
import { installContentLayout } from "../../../content/layout";
import { fixedAvailabilityCases, type BuiltinProducts } from "./operation-availability-contract.shared";

vi.mock("../../app-builder/sdk", () => ({
  readCurrentAppSdkComponents: async () => ({
    version: "test",
    digest: "0".repeat(64),
    catalogue: {
      version: "test",
      components: components.map(component => ({ ...component, ports: { props: [], slots: [], events: [] } })),
    },
  }),
}));

vi.mock("../../app-builder/project-service", async original => ({
  ...await original<typeof import("../../app-builder/project-service")>(),
  prepareBuilderProjectFacts: async (_owner: unknown, appId: string, options: { live: boolean; status: boolean }) => {
    const facts: { call: { type: string; name: string; parameters: Record<string, unknown> } }[] = [];
    const catalogueIndex = options.live
      ? facts.push({ call: { type: "platform:Application", name: "record", parameters: { primaryKey: appId } } }) - 1
      : undefined;
    const statusIndex = options.status
      ? facts.push({ call: { type: "platform:Application", name: "builderTestStatus", parameters: { workspaceId: `workspace-${appId}` } } }) - 1
      : undefined;
    return {
      facts,
      catalogueIndex,
      statusIndex,
      context: async () => { throw new Error("The contract test does not present builder facts"); },
      test: () => null,
    };
  },
}));

vi.mock("../agent-definition-operations", async original => ({
  ...await original<typeof import("../agent-definition-operations")>(),
  prepareAgentDeletionTarget: async () => ({ restriction: { reason: "contract test restriction" } }),
}));

let readBuiltinProducts: typeof import("../builtin-products").readBuiltinProducts;
let prepareOperationDescriptions: typeof import("../direct-operations").prepareOperationDescriptions;
let prepareRegisteredOperationRead: typeof import("../registered-operation-reads").prepareRegisteredOperationRead;
let registeredPanelOperation: typeof import("../server-operations").registeredPanelOperation;

beforeAll(async () => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  ({ readBuiltinProducts } = await import("../builtin-products"));
  ({ prepareOperationDescriptions } = await import("../direct-operations"));
  ({ prepareRegisteredOperationRead } = await import("../registered-operation-reads"));
  ({ registeredPanelOperation } = await import("../server-operations"));
});

async function loadProducts(roots: readonly string[]): Promise<BuiltinProducts> {
  const bundle = await mkdtemp(path.join(tmpdir(), "operation-availability-builtins-"));
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
    return await readBuiltinProducts(bundle);
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
}

describe("operation availability read-plan contract", () => {
  it("plans every fixed-target availability operation bound by shipped builtin panels", async () => {
    const packagesRoot = path.resolve(process.cwd(), "..");
    const products = await loadProducts([
      path.join(packagesRoot, "ontology-manager/resources/builtin-panels"),
      path.join(packagesRoot, "platform-schedules/resources/builtin-panels"),
      path.join(packagesRoot, "platform-admin/resources/builtin-panels"),
      path.join(packagesRoot, "platform-shell/resources/builtin-panels"),
      path.join(packagesRoot, "workbench-ui/resources/builtin-panels"),
    ]);
    const cases = fixedAvailabilityCases(products, operationId => {
      const handler = registeredPanelOperation(operationId)?.handler;
      return Boolean(handler && (handler.unavailable || handler.describeInputSchema
        || (handler.effect === "write" && (handler.unavailableBatch || handler.unavailableForInput))));
    });
    expect(cases.length).toBeGreaterThan(0);

    const byPlacement = new Map<string, typeof cases>();
    for (const item of cases) {
      const key = `${item.panelId}\0${item.memberName}`;
      byPlacement.set(key, [...byPlacement.get(key) ?? [], item]);
    }

    const viewer = { domainId: "tenant", userId: "reader" };
    const credentials = { token: "reader-token", locale: "en" };
    for (const group of byPlacement.values()) {
      const { placement, inputs } = group[0]!;
      const descriptions = prepareOperationDescriptions(
        placement as Parameters<typeof prepareOperationDescriptions>[0],
        inputs,
        "en",
      );
      for (const item of group) {
        expect(
          descriptions.some(description => description.kind === "platform" && description.name === item.operationName),
          `${item.panelId}/${item.memberName}.${item.operationName} (${item.operationId}) is not admitted by its declared binding`,
        ).toBe(true);
      }
      const label = group.map(item => `${item.panelId}/${item.memberName}.${item.operationName} (${item.operationId})`).join(", ");
      await expect(
        prepareRegisteredOperationRead(
          placement as Parameters<typeof prepareRegisteredOperationRead>[0],
          inputs,
          viewer,
          credentials,
        ),
        `fixed-target availability operations cannot be planned: ${label}`,
      ).resolves.toMatchObject({ calls: expect.any(Array) });
    }
  });
});
