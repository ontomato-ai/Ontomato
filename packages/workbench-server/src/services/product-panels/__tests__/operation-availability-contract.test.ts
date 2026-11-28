import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { components } from "../../../../../apps-sdk/src/catalogue";
import { installContentLayout } from "../../../content/layout";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { contractInputs, fixedAvailabilityCases, rowAvailabilityCases, sampleObject, type BuiltinProducts } from "./operation-availability-contract.shared";

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

// Agent deletion reads its stored owner from Node to build the Java read; no system agent and every agent stored.
vi.mock("../agent-definition-directory", async original => ({
  ...await original<typeof import("../agent-definition-directory")>(),
  createSystemAgentOwners: () => ({ forTarget: async () => undefined }),
}));
vi.mock("../../assistant/store", async original => {
  const actual = await original<typeof import("../../assistant/store")>();
  return { ...actual, assistantStore: { ...actual.assistantStore, agent: async (id: string) => ({ id, owner_id: "contract-owner" }) } };
});

let readBuiltinProducts: typeof import("../builtin-products").readBuiltinProducts;
let prepareOperationDescriptions: typeof import("../direct-operations").prepareOperationDescriptions;
let prepareRegisteredOperationRead: typeof import("../registered-operation-reads").prepareRegisteredOperationRead;
let registeredPanelOperation: typeof import("../server-operations").registeredPanelOperation;
let availability: typeof import("../operation-availability");
let boundProjectionOperations: typeof import("../operation-bindings").boundProjectionOperations;
let registeredDataReads: typeof import("../registered-data-reads").registeredDataReads;
let products: BuiltinProducts;

const viewer = { domainId: "tenant", userId: "reader" };
const credentials = { token: "reader-token", locale: "en" };
const context = { owner: viewer, credentials, locale: "en" };

beforeAll(async () => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], knowledgeRoot: process.cwd(), runtimeResources: [] });
  ({ readBuiltinProducts } = await import("../builtin-products"));
  ({ prepareOperationDescriptions } = await import("../direct-operations"));
  ({ prepareRegisteredOperationRead } = await import("../registered-operation-reads"));
  ({ registeredPanelOperation } = await import("../server-operations"));
  availability = await import("../operation-availability");
  ({ boundProjectionOperations } = await import("../operation-bindings"));
  ({ registeredDataReads } = await import("../registered-data-reads"));
  const packagesRoot = path.resolve(process.cwd(), "..");
  products = await loadProducts([
    path.join(packagesRoot, "ontology-manager/resources/builtin-panels"),
    path.join(packagesRoot, "platform-schedules/resources/builtin-panels"),
    path.join(packagesRoot, "platform-admin/resources/builtin-panels"),
    path.join(packagesRoot, "platform-shell/resources/builtin-panels"),
    path.join(packagesRoot, "workbench-ui/resources/builtin-panels"),
  ]);
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
    const cases = fixedAvailabilityCases(products, operationId => {
      const handler = registeredPanelOperation(operationId)?.handler;
      return Boolean(handler && (handler.availability || handler.inputForm));
    });
    expect(cases.length).toBeGreaterThan(0);

    const byPlacement = new Map<string, typeof cases>();
    for (const item of cases) {
      const key = `${item.panelId}\0${item.memberName}`;
      byPlacement.set(key, [...byPlacement.get(key) ?? [], item]);
    }

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
      ).resolves.toMatchObject({ reads: expect.any(Array) });
    }
  });

  it("plans the row availability of every shipped list on a formal page from its rows, its list or Node", async () => {
    const cases = rowAvailabilityCases(products);
    expect(cases.length).toBeGreaterThan(0);
    let planned = 0;
    for (const { panelId, memberName, dataName, placement: { projection }, inputs } of cases) {
      const { source, read } = projection.data[dataName]!;
      const typeId = "type" in source ? source.type.id
        : "literal" in source.object ? source.object.literal.className
        : (projection.inputs[source.object.input] as { objectType: string }).objectType;
      const result = (platformObjectTypes[typeId as keyof typeof platformObjectTypes]?.reads as Record<string, { result: string }> | undefined)
        ?.[read]?.result;
      if (result !== "panelRecordList" && result !== "panelRecordQuery") continue;
      const carries = registeredDataReads.find(item => item.typeId === typeId && item.method === read)?.carries ?? [];
      // Facts a list must carry back but does not would be refused here as PANEL_OPERATION_READ_UNAVAILABLE.
      await expect(
        availability.planRowOperations(boundProjectionOperations(projection), inputs, context, carries),
        `${panelId}/${memberName}.${dataName} (${typeId}.${read}) cannot plan its row operations`,
      ).resolves.toSatisfy(plan => plan === undefined || Array.isArray((plan as { reads: unknown }).reads));
      planned++;
    }
    expect(planned).toBeGreaterThan(0);
  });

  it("plans every availability binding of shipped panels for one direct read outside formal pages", async () => {
    let planned = 0;
    for (const [projectionId, definition] of products.projections) {
      const projection = { ...definition, id: projectionId };
      const inputs = contractInputs(projection);
      for (const bound of boundProjectionOperations(projection)) {
        const declared = bound.owner?.handler.availability;
        if (!declared) continue;
        const { target } = bound.binding;
        const row = target !== undefined && ("row" in target || "rowField" in target);
        const fixed = target && "input" in target ? inputs[target.input] : target && "literal" in target ? target.literal : undefined;
        const object = (Array.isArray(fixed) ? fixed[0] : fixed) as { className: string; primaryKey: string } | undefined
          ?? (row ? sampleObject(bound.owner!.targetType ?? "@any") : undefined);
        const sample = object ? { kind: "object" as const, objectType: object.className, primaryKey: object.primaryKey } : null;
        const source = row && declared.row ? { from: "row" as const } : { from: "targets" as const, targets: [sample] };
        await expect(availability.planAvailability(declared, context, source),
          `${projectionId}.${bound.name} (${bound.binding.operation.id}) cannot plan its direct read`)
          .resolves.toMatchObject({ reads: expect.any(Array) });
        planned++;
      }
    }
    expect(planned).toBeGreaterThan(0);
  });
});
