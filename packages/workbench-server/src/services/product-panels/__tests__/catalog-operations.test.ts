import { APPLICATION, APPLICATION_PANEL_USE, OBJECT_TYPE, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { panelOperationImpactSchema } from "@ontomato/contracts/panel-operations";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { productProjectionSchema } from "@ontomato/contracts/product-panels";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const applicationRecord = vi.hoisted(() => vi.fn());
const applicationCreate = vi.hoisted(() => vi.fn());
const applicationForm = vi.hoisted(() => vi.fn());
const applicationSaveEntries = vi.hoisted(() => vi.fn());
const javaReads = vi.hoisted(() => ({ answer: (() => ({})) as () => object, items: [] as unknown[] }));
vi.mock("../java-panel-reads", async importOriginal => ({
  ...await importOriginal<typeof import("../java-panel-reads")>(),
  readViaJava: async (viewer: unknown, reads: unknown[]) => {
    javaReads.items.push(reads);
    return { viewer, results: reads.map(() => javaReads.answer()) };
  },
}));
vi.mock("../application-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof import("../application-catalogue")>();
  return {
    ...actual,
    applicationCatalogueClient: (viewer: never) => ({
      ...actual.applicationCatalogueClient(viewer),
      record: applicationRecord,
      create: applicationCreate,
      form: applicationForm,
      saveEntries: applicationSaveEntries,
    }),
  };
});

vi.mock("../catalog", async importOriginal => ({
  ...await importOriginal<typeof import("../catalog")>(),
  currentProductUsedBy: vi.fn(),
}));
vi.mock("../current", async importOriginal => ({
  ...await importOriginal<typeof import("../current")>(),
  readCurrentPanelLabel: vi.fn(),
  readCurrentProjection: vi.fn(),
  saveCurrentPanel: vi.fn(),
  saveCurrentProjection: vi.fn(),
}));

import { fieldPatterns, productCatalogServerOperations } from "../catalog-operations";
import { currentProductUsedBy } from "../catalog";
import { readCurrentPanelLabel, readCurrentProjection } from "../current";
import type { PanelOperationHost } from "../server-operations";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], knowledgeRoot: process.cwd(), runtimeResources: [] });
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: en },
      fr: { ...enLocaleMeta, messages: { "panels.productCatalog.save": "Enregistrer" } },
    },
  });
});

beforeEach(() => {
  applicationRecord.mockReset();
  applicationForm.mockReset();
  applicationSaveEntries.mockReset();
});

const impactReader = { owner: { domainId: "domain", userId: "reader" }, credentials: { locale: "en" } };
const unusedRequest = async () => { throw new Error("Unexpected operation request"); };
const impactHost: PanelOperationHost = {
  initiator: impactReader, executor: impactReader, request: unusedRequest, requestWorkbench: unusedRequest,
};
const targetInfo = (objectType: string, primaryKey: string, label: string) => ({ target: { objectType, primaryKey }, label });

async function inspectDelete(collection: string, objectType: string, primaryKey: string) {
  const handler = productCatalogServerOperations.find(op => op.handlerRef === `${collection}.delete`)!;
  const result = await handler.inspectImpact!.inspect(impactHost, [{
    target: { kind: "object", objectType, primaryKey }, input: { revision: 2 },
  }]);
  return panelOperationImpactSchema.parse(result);
}

it("names all visible panel users and counts hidden references in the delete impact", async () => {
  vi.mocked(readCurrentPanelLabel).mockResolvedValue("Orders dashboard");
  vi.mocked(currentProductUsedBy).mockResolvedValueOnce({
    panels: [{ id: "home", name: "Operations Home" }],
    applicationEntries: [{ entryId: "orders-entry", applicationId: "app-orders", applicationName: "Orders", path: "/applications/app-orders/list" }],
    classNames: ["Order"], hiddenCount: 2,
  });

  const impact = await inspectDelete("productPanels", PRODUCT_PANEL, "orders");
  expect(impact.total).toBe(5);
  expect(impact.objects).toEqual(expect.arrayContaining([
    targetInfo(PRODUCT_PANEL, "home", "Operations Home"),
    targetInfo(APPLICATION_PANEL_USE, "orders-entry", "Orders (/applications/app-orders/list)"),
    targetInfo(OBJECT_TYPE, "Order", "Order"),
  ]));
  expect(impact.objects).toHaveLength(3);
  expect(impact.summary).toContain("Orders dashboard");
  expect(impact.summary).toContain("2");
});

it("always supplies a confirmation for an unreferenced healthy panel", async () => {
  vi.mocked(readCurrentPanelLabel).mockResolvedValue("Orders dashboard");
  vi.mocked(currentProductUsedBy).mockResolvedValueOnce({ panels: [], applicationEntries: [], classNames: [], hiddenCount: 0 });
  expect(await inspectDelete("productPanels", PRODUCT_PANEL, "orders")).toMatchObject({
    total: 1, objects: [targetInfo(PRODUCT_PANEL, "orders", "Orders dashboard")],
  });
});

it.each([
  { panels: [{ id: "orders", name: "Orders dashboard" }], hiddenCount: 2, total: 3, objects: [targetInfo(PRODUCT_PANEL, "orders", "Orders dashboard")] },
  { panels: [], hiddenCount: 1, total: 1, objects: [] },
  { panels: [], hiddenCount: 0, total: 1, objects: [targetInfo(PRODUCT_PROJECTION, "table", "Order table")] },
])("previews projection deletion with $hiddenCount hidden users", async ({ panels, hiddenCount, total, objects }) => {
  vi.mocked(readCurrentProjection).mockResolvedValueOnce(productProjectionSchema.parse({
    id: "table", domainId: "domain", ownerId: "reader", editable: true, revision: 2,
    createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
    name: "Order table", description: "", visibility: "private", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {}, data: {},
  }));
  vi.mocked(currentProductUsedBy).mockResolvedValueOnce({ panels, hiddenCount });
  const impact = await inspectDelete("productProjections", PRODUCT_PROJECTION, "table");
  expect(impact).toMatchObject({ total, objects });
  expect(impact.summary).toContain("Order table");
  if (hiddenCount) expect(impact.summary).toContain(String(hiddenCount));
});

const definition = { name: "Orders", description: "", visibility: "private" };
it.each([
  [PRODUCT_PANEL, { ...definition, content: { html: "<main></main>" }, manifest: { state: {}, members: {} } }],
  [PRODUCT_PROJECTION, { ...definition, componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {}, data: {} }],
  [APPLICATION, {
    entry: { path: "/applications/app-orders", renderer: "panels" }, panelUses: [], initialOpenEntryIds: [],
    declaration: { names: { en: "Orders" }, descriptions: {}, icon: "app", groups: [] },
  }],
] as const)("reports the created identity when saving a draft %s", async (objectType, values) => {
  const save = productCatalogServerOperations.find(op => op.handlerRef === `${objectType}.save`)!;
  if (save.kind !== "form.save") throw new Error("Expected a form save");
  const primaryKey = objectType === APPLICATION ? "app-orders" : "orders";
  const outcome = await save.execute(impactHost, { kind: "draft", id: primaryKey }, { values }, "intent-1");

  expect(outcome).toMatchObject({ kind: "success", created: { objectType, primaryKey } });
});

it.each([PRODUCT_PROJECTION, PRODUCT_PANEL, APPLICATION])("describes %s save in the reader's language", async type => {
  const { readRegisteredProjectionOperations } = await import("./registered-operations-fixture");
  const owner = { domainId: "domain", userId: "reader" };
  const projection = productProjectionSchema.parse({
    id: "editor", domainId: owner.domainId, ownerId: owner.userId, editable: true,
    revision: 1, createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
    name: "Catalogue editor", description: "", visibility: "private", componentId: "@ontomato/sdk:ObjectForm",
    inputs: {}, outputs: {}, config: {},
    data: { createForm: { source: { type: { kind: "PlatformObjectType", id: type } }, read: "createForm", params: {} } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${type}.save` } } },
  });
  const member = { target: { projectionId: projection.id } };
  const placement = { projection, member, slot: "form", panel: { manifest: { members: { form: member }, state: {} } } };

  const describe = (locale: string) => readRegisteredProjectionOperations({ owner, credentials: { locale } }, placement, {});
  expect(await describe("en")).toMatchObject({ save: { label: "Save" } });
  expect(await describe("fr")).toMatchObject({ save: { label: "Enregistrer" } });
});

it("includes object-variant fields and nested array-row variant fields in fieldPatterns", () => {
  const text = (path: string, label: string): PanelFormField => ({
    path, label, valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" },
  });
  const option = (value: string, label: string) => ({
    value, label, description: null, disabled: false, disabledReason: null,
  });
  const fields: PanelFormField[] = [{
    path: "/steps",
    label: "Steps",
    valueSchema: { type: "array" },
    required: false,
    readOnly: false,
    control: {
      kind: "object-array",
      itemFields: [{
        path: "/executor",
        label: "Executor",
        valueSchema: { type: "object" },
        required: false,
        readOnly: false,
        control: {
          kind: "object",
          fields: [{
            path: "/mode",
            label: "Mode",
            valueSchema: { type: "string" },
            required: true,
            readOnly: false,
            control: { kind: "select", options: [option("none", "None"), option("rule", "Rule"), option("agent", "Agent")] },
          }],
          variantBy: "/mode",
          variants: {
            rule: [text("/ruleId", "Rule")],
            agent: [text("/agentId", "Agent"), text("/prompt/template", "Prompt")],
          },
        },
      }],
    },
  }];

  expect(fieldPatterns(fields)).toEqual([
    ["steps"],
    ["steps", "*", "executor"],
    ["steps", "*", "executor", "mode"],
    ["steps", "*", "executor", "ruleId"],
    ["steps", "*", "executor", "agentId"],
    ["steps", "*", "executor", "prompt", "template"],
  ]);
});

it.each([
  ["not found", { status: "error", code: "APPLICATION_NOT_FOUND", error: "Not found" }, undefined],
  ["forbidden", { status: "forbidden", error: "Forbidden" }, { status: "forbidden", reason: "Forbidden" }],
  ["owner error", { status: "error", code: "PANEL_READ_FAILED", error: "ECONNREFUSED" },
    { status: "error", code: "PANEL_READ_FAILED", message: "ECONNREFUSED" }],
] as const)("refuses applications.delete for a missing application and fails on an owner refusal (%s)", async (_kind, result, failure) => {
  javaReads.answer = () => result;
  const { readRegisteredProjectionOperations } = await import("./registered-operations-fixture");
  const owner = { domainId: "domain", userId: "reader" };
  const projection = productProjectionSchema.parse({
    id: "app-actions", domainId: owner.domainId, ownerId: owner.userId, editable: true,
    revision: 1, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
    name: "Application actions", description: "", visibility: "private", componentId: "@ontomato/sdk:ObjectHeader",
    inputs: { app: { kind: "object", objectType: APPLICATION } }, outputs: {}, config: {},
    data: {},
    operations: {
      delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "app" } },
      addEntry: { operation: { kind: "PlatformOperation", id: "applications.addEntry" }, target: { input: "app" } },
    },
  });
  const member = { target: { projectionId: projection.id }, inputs: { app: { state: "selected" } } };
  const placement = {
    projection,
    member,
    slot: "header",
    panel: {
      manifest: {
        members: { header: member },
        state: {
          selected: {
            type: { kind: "object" as const, objectType: APPLICATION },
            personal: false,
            deepLink: false,
            external: false,
          },
        },
      },
    },
  };

  const admitted = readRegisteredProjectionOperations(
    { owner, credentials: { locale: "en" } },
    placement,
    { app: { className: APPLICATION, primaryKey: "app-1" } },
  );
  if (failure) {
    await expect(admitted).rejects.toMatchObject({ response: failure });
    return;
  }
  const described = await admitted;
  expect(described.delete?.unavailable).toEqual({ reason: en["panels.productCatalog.application.availabilityUnavailable"] });
  expect(described.addEntry).toBeDefined();
  expect(described.addEntry?.unavailable).toBeUndefined();
});

it("marks applications.delete unavailable for read-only applications and available when maintainable", async () => {
  const { readRegisteredProjectionOperations } = await import("./registered-operations-fixture");
  const owner = { domainId: "domain", userId: "reader" };
  const projection = productProjectionSchema.parse({
    id: "app-delete", domainId: owner.domainId, ownerId: owner.userId, editable: true,
    revision: 1, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
    name: "Delete application", description: "", visibility: "private", componentId: "@ontomato/sdk:OperationButton",
    inputs: { app: { kind: "object", objectType: APPLICATION } }, outputs: {}, config: { operation: "delete" },
    data: {},
    operations: {
      delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "app" } },
    },
  });
  const member = { target: { projectionId: projection.id }, inputs: { app: { state: "selected" } } };
  const placement = {
    projection,
    member,
    slot: "deleteApp",
    panel: {
      manifest: {
        members: { deleteApp: member },
        state: {
          selected: {
            type: { kind: "object" as const, objectType: APPLICATION },
            personal: false,
            deepLink: false,
            external: false,
          },
        },
      },
    },
  };
  const readOps = () => readRegisteredProjectionOperations(
    { owner, credentials: { locale: "en" } },
    placement,
    { app: { className: APPLICATION, primaryKey: "app-1" } },
  );

  javaReads.answer = () => ({ status: "ready", payload: { canMaintain: false } });
  expect((await readOps()).delete?.unavailable).toEqual({ reason: en["panels.productCatalog.application.readOnly"] });

  javaReads.answer = () => ({ status: "ready", payload: { canMaintain: true } });
  expect((await readOps()).delete?.unavailable).toBeUndefined();
  // The facts are read as the person, without a placement.
  expect(javaReads.items.at(-1)).toEqual([{ source: { kind: "direct" },
    call: { type: APPLICATION, name: "deleteAvailability", parameters: { primaryKey: "app-1" } } }]);
});

it("preserves existing entry icons when saving entries from a form that does not submit icon", async () => {
  const save = productCatalogServerOperations.find(op => op.handlerRef === `${APPLICATION}.save`)!;
  if (save.kind !== "form.save") throw new Error("Expected a form save");
  const existingEntry = {
    id: "entry-roles",
    pageKey: "roles",
    panelId: "panel-roles",
    path: "/applications/app-1/roles",
    names: { en: "Roles" },
    icon: "user-cog",
  };
  applicationForm.mockResolvedValue({
    values: {
      entry: { path: "/applications/app-1", renderer: "panels" },
      panelUses: [existingEntry],
    },
    fields: [],
  });
  applicationSaveEntries.mockResolvedValue(undefined);

  await save.execute(
    impactHost,
    { kind: "object", objectType: APPLICATION, primaryKey: "app-1" },
    {
      values: {
        id: "entry-roles",
        pageKey: "roles",
        panelId: "panel-roles",
        path: "/applications/app-1/roles",
        names: { en: "Roles updated" },
      },
    },
    "intent-icon-single",
  );
  expect(applicationSaveEntries).toHaveBeenCalledWith("app-1", expect.objectContaining({
    panelUses: [expect.objectContaining({ id: "entry-roles", icon: "user-cog", names: { en: "Roles updated" } })],
  }));

  applicationSaveEntries.mockClear();
  await save.execute(
    impactHost,
    { kind: "object", objectType: APPLICATION, primaryKey: "app-1" },
    {
      values: {
        entry: { path: "/applications/app-1", renderer: "panels" },
        panelUses: [{
          id: "entry-roles",
          pageKey: "roles",
          panelId: "panel-roles",
          path: "/applications/app-1/roles",
          names: { en: "Roles bulk" },
        }],
      },
      submittedFields: ["/entry", "/panelUses"],
    },
    "intent-icon-bulk",
  );
  expect(applicationSaveEntries).toHaveBeenCalledWith("app-1", expect.objectContaining({
    panelUses: [expect.objectContaining({ id: "entry-roles", icon: "user-cog", names: { en: "Roles bulk" } })],
  }));
});

it("saves a new entry from submitted fields using the registration DTO", async () => {
  const save = productCatalogServerOperations.find(op => op.handlerRef === `${APPLICATION}.save`)!;
  if (save.kind !== "form.save") throw new Error("Expected a form save");
  const entry = { path: "/applications/app-1", renderer: "panels" };
  const use = { id: "roles", names: { en: "roles" }, pageKey: "roles-view", panelId: "panel-roles", path: `${entry.path}/roles` };
  applicationForm.mockResolvedValue({ values: { entry, panelUses: [] }, fields: [] });
  applicationSaveEntries.mockResolvedValue(undefined);

  await save.execute(impactHost, { kind: "object", objectType: APPLICATION, primaryKey: "app-1" }, {
    values: use,
    submittedFields: ["/id", "/pageKey", "/panelId", "/path", "/names"],
  }, "intent-new-entry");

  expect(applicationSaveEntries).toHaveBeenCalledWith("app-1", { entry, panelUses: [use] });
});
