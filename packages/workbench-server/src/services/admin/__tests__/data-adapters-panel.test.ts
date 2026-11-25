import { mkdtemp, readFileSync, rm, symlink, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as panelCheck from "@ontomato/contracts/panel-check";
import {
  multiDataSourceType,
  type DataAdapterInfo,
  type MultiDataSourceDefinition,
  type SandboxCapability,
} from "@ontomato/contracts/data-adapters";
import { panelFormDescriptionSchema, type PanelFormValues } from "@ontomato/contracts/panel-projection";
import {
  ACTION,
  CHECK_DATA_ADAPTER_SANDBOX_PERMISSION,
  DATA_ADAPTER_CONFIG,
  SAVE_DATA_ADAPTER_ROUTING,
  TEST_DATA_ADAPTER_CONNECTION,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { configureI18n } from "../../../i18n";
import { en } from "../../../i18n/locales/en";
import {
  createDataAdapterConfigReads,
  dataAdaptersServerOperations,
} from "../data-adapters-panel";
import { platformTypeEntries } from "../../product-panels/type-table";
import { validateBuiltinProductReferences } from "../../product-panels/references";
import { validateProjectionComponent } from "../../product-panels/component-catalogue";
import type {
  PanelOperationHost,
  PanelOperationTarget,
  PanelReadServerOperation,
  SinglePanelOperationOutcome,
} from "../../product-panels/server-operations";

const { assertPermission } = vi.hoisted(() => ({ assertPermission: vi.fn() }));
vi.mock("../../../identity/installed", () => ({ assertPermission }));
vi.mock("../../assistant/skills", () => ({}));

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
const mockFetch = vi.fn();
vi.mock("../../product-panels/operation-host", () => ({
  operationHost: () => ({
    request: (url: string, init: FetchInit) => mockFetch(url, init),
  }),
}));

const actor = {
  owner: { domainId: "domain-1", userId: "admin-1" },
  credentials: { type: "anonymous" as const, locale: "en" },
};

let storedConfig: {
  dataAdapter: string;
  dataAdapterConnections: Record<string, Record<string, string>>;
  multiDataSource: MultiDataSourceDefinition | null;
  sandboxCapability?: SandboxCapability;
};
let installedAdapters: DataAdapterInfo[];
let reportedCurrentType: string | undefined;
let storedSchema: {
  classDefs: Array<{ name: string }>;
  relationshipDefs: Record<string, { fromClass: string; toClass: string }>;
};
let nextSingleSaveResponse: unknown | null;
let nextMultiSaveResponse: unknown | null;
let nextTestResponse: unknown | null;
let failSchemaRead: boolean;
let schemaReadCount: number;
let savedSingleBodies: unknown[];
let savedMultiBodies: unknown[];
let testedBodies: unknown[];

function makeHost(): PanelOperationHost {
  return {
    initiator: actor,
    executor: actor,
    locale: "en",
    requestWorkbench: vi.fn(),
    request: (url, init) => mockFetch(url, init),
  };
}

function saveOp() {
  const found = dataAdaptersServerOperations.find((entry) => entry.handlerRef === `${DATA_ADAPTER_CONFIG}.save`);
  if (!found || found.effect !== "write" || found.batch) throw new Error("Missing save op");
  return found as {
    inputSchema: { parse(value: unknown): unknown };
    execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
      intentId: string,
    ): Promise<SinglePanelOperationOutcome>;
  };
}

function saveRoutingOp() {
  const found = dataAdaptersServerOperations.find((entry) => entry.handlerRef === SAVE_DATA_ADAPTER_ROUTING);
  if (!found || found.effect !== "write" || found.batch) throw new Error("Missing saveRouting op");
  return found as {
    inputSchema: { parse(value: unknown): unknown };
    execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
      intentId: string,
    ): Promise<SinglePanelOperationOutcome>;
  };
}

function testOp(): PanelReadServerOperation {
  const found = dataAdaptersServerOperations.find((entry) => entry.handlerRef === TEST_DATA_ADAPTER_CONNECTION);
  if (!found || found.effect !== "read") throw new Error("Missing test op");
  return found;
}

const domainTarget: PanelOperationTarget = {
  kind: "object",
  objectType: DATA_ADAPTER_CONFIG,
  primaryKey: "domain",
};

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: {
      en: { messages: en, languageName: "English", outputInstruction: "", conclusionPrefix: "" },
    },
  });
});

beforeEach(() => {
  reportedCurrentType = undefined;
  assertPermission.mockReset();
  assertPermission.mockResolvedValue(undefined);
  savedSingleBodies = [];
  savedMultiBodies = [];
  testedBodies = [];
  nextMultiSaveResponse = null;
  nextTestResponse = null;
  failSchemaRead = false;
  schemaReadCount = 0;

  installedAdapters = [
    {
      type: "postgresql",
      label: "PostgreSQL",
      requiresJoinFields: true,
      fields: ["url", "user", "password"],
      examples: { url: "jdbc:postgresql://host:5432/db", user: "postgres" },
      fieldInfos: [
        { name: "url", label: null, required: true, secret: false, example: "jdbc:postgresql://host:5432/db", fullWidth: true },
        { name: "user", label: null, required: true, secret: false, example: "postgres", fullWidth: false },
        { name: "password", label: null, required: true, secret: true, example: null, fullWidth: false },
      ],
    },
    {
      type: "m3",
      label: "M3 Graph",
      requiresJoinFields: false,
      fields: ["url", "company", "user", "password"],
      examples: { url: "10.0.0.1:8080" },
      fieldInfos: [
        { name: "url", label: null, required: true, secret: false, example: "10.0.0.1:8080", fullWidth: true },
        { name: "company", label: null, required: true, secret: false, example: "acme", fullWidth: false },
        { name: "user", label: null, required: true, secret: false, example: "admin", fullWidth: false },
        { name: "password", label: null, required: true, secret: true, example: null, fullWidth: false },
      ],
    },
    {
      type: "opensearch",
      label: "OpenSearch",
      requiresJoinFields: true,
      fields: ["url", "user", "password"],
      examples: { url: "https://search:9200", user: "admin" },
    },
    {
      type: multiDataSourceType,
      label: "Multi-source",
      requiresJoinFields: true,
      fields: [],
      examples: {},
    },
  ];

  storedConfig = {
    dataAdapter: "postgresql",
    dataAdapterConnections: {
      postgresql: {
        url: "jdbc:postgresql://db:5432/app",
        user: "appuser",
        password: "******",
      },
    },
    multiDataSource: {
      dataSources: [
        {
          id: "crm",
          label: "CRM DB",
          adapterType: "postgresql",
          readOnly: false,
          connection: { url: "jdbc:postgresql://crm:5432/crm", user: "crm", password: "******" },
        },
        {
          id: "graph",
          label: "Asset Graph",
          adapterType: "m3",
          readOnly: true,
          connection: { url: "graph.local:8080", company: "acme", user: "root", password: "******" },
        },
      ],
      classes: [
        { forOntoMap: "Order", sourceId: "crm" },
        { forOntoMap: "Device", sourceId: "graph" },
        { forOntoMap: "Rack", sourceId: "graph" },
      ],
      relationships: [
        { forOntoMap: "MOUNTED_ON", realEdge: "mounted_in_rack" },
      ],
    },
  };

  storedSchema = {
    classDefs: [{ name: "Order" }, { name: "Device" }, { name: "Rack" }],
    relationshipDefs: {
      MOUNTED_ON: { fromClass: "Device", toClass: "Rack" },
      ORDER_DEVICE: { fromClass: "Order", toClass: "Device" },
      SELF_ORDER: { fromClass: "Order", toClass: "Order" },
    },
  };

  nextSingleSaveResponse = null;
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init?: FetchInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url === "/api/data-query/businessConfig/getConfig") {
      return Response.json({ success: true, data: storedConfig });
    }
    if (url === "/api/data-query/businessConfig/dataAdapters") {
      return Response.json({
        success: true,
        data: { currentType: reportedCurrentType ?? storedConfig.dataAdapter, adapters: installedAdapters },
      });
    }
    if (url === "/api/data-query/admin/getSchema") {
      schemaReadCount += 1;
      if (failSchemaRead) {
        return Response.json({ success: false, message: "Schema service unavailable" });
      }
      return Response.json({ success: true, data: storedSchema });
    }
    if (url === "/api/data-query/businessConfig/useDataAdapter") {
      savedSingleBodies.push(body);
      return Response.json(nextSingleSaveResponse ?? { success: true });
    }
    if (url === "/api/data-query/businessConfig/useMultiDataSource") {
      savedMultiBodies.push(body);
      if (nextMultiSaveResponse) return Response.json(nextMultiSaveResponse);
      return Response.json({ success: true });
    }
    if (url === "/api/data-query/businessConfig/checkSandboxPermission") {
      expect(init?.method).toBe("POST");
      expect(body).toEqual({});
      return Response.json({ success: true, data: { sandboxCapability: failedCapability } });
    }
    if (url === "/api/data-query/businessConfig/testDataAdapter") {
      testedBodies.push(body);
      if (nextTestResponse) return Response.json(nextTestResponse);
      return Response.json({
        success: true,
        data: {
          kind: "catalog",
          sandboxCapability: failedCapability,
          elapsedMs: 14,
          databaseProduct: "PostgreSQL",
          databaseVersion: "16.2",
          driverName: "PostgreSQL JDBC Driver",
          driverVersion: "42.7.3",
          catalog: "app",
          schema: "public",
          tables: [
            { name: "orders", type: "TABLE" },
            { name: "active_orders", type: "VIEW" },
          ],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

const failedCapability = {
  status: "failed", supported: true, canCreateAndDrop: false, reason: "CREATE denied",
  probeNote: "Creates and drops an empty probe table", details: { operation: "create" },
} satisfies SandboxCapability;

describe("platform:DataAdapterConfig record read", () => {
  it("summarizes single-source and multi-source configurations without leaking secrets", async () => {
    const reads = createDataAdapterConfigReads(actor);

    const single = await reads.record("domain");
    expect(single.label).toBe("PostgreSQL");
    expect(single.fields.adapterType).toBe("postgresql");
    expect(single.fields.mode).toBe("Single source");
    expect(single.fields.summary).toContain("jdbc:postgresql://db:5432/app");
    expect(JSON.stringify(single)).not.toContain("******");
    expect(single.outputs).toMatchObject({
      currentType: "postgresql", mode: "single", configured: true,
      sandboxStatus: "unchecked", sandboxSupported: true, sandboxCanCreateAndDrop: false,
    });
    expect(single.fields.sandboxStatus).toBe("Not checked yet");
    expect(mockFetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/data-query/businessConfig/getConfig", "GET"],
      ["/api/data-query/businessConfig/dataAdapters", "GET"],
    ]);

    storedConfig.dataAdapter = multiDataSourceType;
    storedConfig.sandboxCapability = failedCapability;
    const multi = await reads.record("domain");
    expect(multi.fields.mode).toBe("Multi-source");
    expect(multi.fields.summary).toContain("crm (PostgreSQL)");
    expect(multi.fields.summary).toContain("graph (M3 Graph)");
    expect(multi.outputs).toMatchObject({
      currentType: "multi", mode: "multi", configured: true, sandboxStatus: "failed", sandboxReason: "CREATE denied",
    });
    expect(multi.fields.sandboxDetail).toContain("CREATE denied");
  });

  it("keeps an unconfigured domain ineligible for a permission check", async () => {
    storedConfig.dataAdapter = "";
    const record = await createDataAdapterConfigReads(actor).record("domain");
    expect(record.outputs).toMatchObject({ configured: false, sandboxStatus: "unsupported", sandboxSupported: false });
    expect(record.fields.sandboxDetail).toContain("Configure a business data source");
  });

  it("uses the installed current type to display sandbox capability when the saved adapter type is absent", async () => {
    storedConfig.dataAdapter = "";
    reportedCurrentType = "postgresql";
    storedConfig.sandboxCapability = failedCapability;

    const record = await createDataAdapterConfigReads(actor).record("domain");
    expect(record.outputs).toMatchObject({
      currentType: "postgresql", configured: true, sandboxStatus: "failed", sandboxSupported: true,
    });
    expect(record.fields.sandboxDetail).toContain("CREATE denied");
  });

  it("rejects unknown primary keys with 404", async () => {
    const reads = createDataAdapterConfigReads(actor);
    await expect(reads.record("other")).rejects.toMatchObject({ status: 404 });
  });
});

describe("platform:DataAdapterConfig form read & Explanation 19 secret handling", () => {
  it("never echoes saved secret masks into form values and lowers required when already saved", async () => {
    const reads = createDataAdapterConfigReads(actor);
    const form = panelFormDescriptionSchema.parse(await reads.form("domain", { changedField: null }));

    expect(form.values.adapterMode).toBe("postgresql");
    expect(form.values.connection).toEqual({
      url: "jdbc:postgresql://db:5432/app",
      user: "appuser",
      password: "",
    });
    expect(JSON.stringify(form.values)).not.toContain("******");

    expect(form.sections).toBeUndefined();
    expect(form.fields.every((f) => f.section === undefined)).toBe(true);

    const modeField = form.fields.find((f) => f.path === "/adapterMode")!;
    expect(modeField.refreshOnChange).toBe(true);
    expect(modeField.fullWidth).toBe(true);
    expect(modeField.control).toMatchObject({ kind: "select", presentation: "radio" });

    const urlField = form.fields.find((f) => f.path === "/connection/url")!;
    expect(urlField.fullWidth).toBe(true);
    expect(urlField.control).toEqual({
      kind: "text",
      clearable: true,
      placeholder: "jdbc:postgresql://host:5432/db",
    });

    const userField = form.fields.find((f) => f.path === "/connection/user")!;
    expect(userField.fullWidth).toBeUndefined();
    expect(userField.control).toMatchObject({ kind: "text", clearable: true });

    const passwordField = form.fields.find((f) => f.path === "/connection/password")!;
    expect(passwordField.required).toBe(false);
    expect(passwordField.help).toContain("Leave blank");
    expect(passwordField.control).toEqual({ kind: "text", secret: true, clearable: true, placeholder: "******" });
  });

  it("loads the newly chosen adapter's fields and keeps required=true for unsaved required secrets on refreshOnChange", async () => {
    const reads = createDataAdapterConfigReads(actor);
    const refreshed = panelFormDescriptionSchema.parse(
      await reads.form("domain", {
        changedField: "/adapterMode",
        values: {
          adapterMode: "m3",
          connection: { url: "jdbc:postgresql://db:5432/app", user: "appuser", password: "" },
        },
      }),
    );

    expect(refreshed.values).toEqual({
      adapterMode: "m3",
      connection: { url: "", company: "", user: "", password: "" },
    });
    const passwordField = refreshed.fields.find((f) => f.path === "/connection/password")!;
    expect(passwordField.required).toBe(true);
    expect(passwordField.help).toBeUndefined();
  });

  it("builds multi-source form with variantBy adapter connections and derives relationship routes on refreshOnChange", async () => {
    const reads = createDataAdapterConfigReads(actor);
    const multiForm = panelFormDescriptionSchema.parse(
      await reads.form("domain", {
        changedField: "/adapterMode",
        values: { adapterMode: multiDataSourceType },
      }),
    );

    expect(multiForm.sections?.map((s) => s.key)).toEqual(["mode", "dataSources"]);
    // DA-11: form read never fetches `/admin/getSchema`, even in multi-source mode.
    expect(schemaReadCount).toBe(0);
    const dsField = multiForm.fields.find((f) => f.path === "/dataSources")!;
    expect(dsField.fullWidth).toBe(true);
    expect(dsField.control.kind).toBe("object-array");
    if (dsField.control.kind !== "object-array") throw new Error("expected object-array");
    expect(dsField.control.columns).toBe(2);
    expect(dsField.control.reorderable).toBe(false);
    const idItem = dsField.control.itemFields.find((f) => f.path === "/id")!;
    expect(idItem.control).toMatchObject({ kind: "text", clearable: true });
    const adapterItem = dsField.control.itemFields.find((f) => f.path === "/adapter")!;
    expect(adapterItem.fullWidth).toBe(true);
    expect(adapterItem.control.kind).toBe("object");
    if (adapterItem.control.kind !== "object") throw new Error("expected object");
    expect(adapterItem.control.columns).toBe(2);
    expect(adapterItem.control.variantBy).toBe("/adapterType");
    expect(Object.keys(adapterItem.control.variants ?? {})).toEqual(["postgresql", "m3", "opensearch"]);
    expect(adapterItem.control.variants?.postgresql?.find((f) => f.path === "/connection/url")?.fullWidth).toBe(true);

    // Saved multi-source secrets must stay empty in form values.
    expect(JSON.stringify(multiForm.values)).not.toContain("******");
    const rows = multiForm.values.dataSources as Array<{ id: string; adapter: { connection: Record<string, string> } }>;
    expect(rows[0]!.adapter.connection.password).toBe("");
    expect(rows[1]!.adapter.connection.password).toBe("");

    // Ontology outline is lazy-loaded by the separate `routingForm` read.
    const routingForm = panelFormDescriptionSchema.parse(
      await reads.routingForm("domain", { changedField: null }),
    );
    expect(schemaReadCount).toBe(1);
    expect(routingForm.sections?.map((s) => s.key)).toEqual(["classRoutes", "relationshipRoutes"]);

    // DA-07: compact fixed-row tables for class routing (2 cols) and relationship routing (4 cols).
    const classRoutesField = routingForm.fields.find((f) => f.path === "/classRoutes")!;
    expect(classRoutesField.control).toMatchObject({
      kind: "object-array",
      presentation: "table",
      fixedRows: true,
      reorderable: false,
    });
    if (classRoutesField.control.kind !== "object-array") throw new Error("expected object-array");
    expect(classRoutesField.control.itemFields.map((f) => f.path)).toEqual(["/className", "/sourceId"]);
    expect(routingForm.values.classRoutes).toEqual([
      { className: "Order", sourceId: "crm" },
      { className: "Device", sourceId: "graph" },
      { className: "Rack", sourceId: "graph" },
    ]);

    const relRoutesField = routingForm.fields.find((f) => f.path === "/relationshipRoutes")!;
    expect(relRoutesField.control).toMatchObject({
      kind: "object-array",
      presentation: "table",
      fixedRows: true,
      reorderable: false,
    });
    if (relRoutesField.control.kind !== "object-array") throw new Error("expected object-array");
    expect(relRoutesField.control.itemFields.map((f) => f.path)).toEqual(["/relationship", "/ends", "/source", "/realEdge"]);

    // Relationship derivations:
    // - MOUNTED_ON: Device(graph) -> Rack(graph) => graph, editable realEdge
    // - ORDER_DEVICE: Order(crm) -> Device(graph) => cross-source, non-editable realEdge
    // - SELF_ORDER: Order(crm) -> Order(crm) => crm (SQL), non-editable realEdge
    const rels = routingForm.values.relationshipRoutes as Array<{
      relationship: string;
      ends: string;
      source: string;
      fromSource: string;
      toSource: string;
      crossSource: boolean;
      edgeEditable: boolean;
      realEdge: string;
    }>;
    expect(rels).toEqual([
      {
        relationship: "MOUNTED_ON",
        ends: "Device → Rack",
        source: "graph",
        fromSource: "graph",
        toSource: "graph",
        crossSource: false,
        edgeEditable: true,
        realEdge: "mounted_in_rack",
      },
      {
        relationship: "ORDER_DEVICE",
        ends: "Order → Device",
        source: "",
        fromSource: "crm",
        toSource: "graph",
        crossSource: true,
        edgeEditable: false,
        realEdge: "",
      },
      {
        relationship: "SELF_ORDER",
        ends: "Order → Order",
        source: "crm",
        fromSource: "crm",
        toSource: "crm",
        crossSource: false,
        edgeEditable: false,
        realEdge: "",
      },
    ]);

    // Re-route Order from crm to graph via refreshOnChange => ORDER_DEVICE & SELF_ORDER become graph + editable!
    const refreshed = panelFormDescriptionSchema.parse(
      await reads.routingForm("domain", {
        changedField: "/classRoutes/0/sourceId",
        values: {
          ...routingForm.values,
          classRoutes: [
            { className: "Order", sourceId: "graph" },
            { className: "Device", sourceId: "graph" },
            { className: "Rack", sourceId: "graph" },
          ],
        } as PanelFormValues,
      }),
    );
    const updatedRels = refreshed.values.relationshipRoutes as typeof rels;
    expect(updatedRels.find((r) => r.relationship === "ORDER_DEVICE")).toMatchObject({
      source: "graph",
      crossSource: false,
      edgeEditable: true,
      realEdge: "",
    });
    expect(updatedRels.find((r) => r.relationship === "SELF_ORDER")).toMatchObject({
      source: "graph",
      crossSource: false,
      edgeEditable: true,
      realEdge: "",
    });
  });

  it("isolates ontology outline failures to routingForm while keeping adapterForm editable", async () => {
    const reads = createDataAdapterConfigReads(actor);
    failSchemaRead = true;

    const multiForm = panelFormDescriptionSchema.parse(
      await reads.form("domain", {
        changedField: "/adapterMode",
        values: { adapterMode: multiDataSourceType },
      }),
    );
    expect(multiForm.sections?.map((s) => s.key)).toEqual(["mode", "dataSources"]);
    expect(schemaReadCount).toBe(0);

    await expect(reads.routingForm("domain", { changedField: null })).rejects.toThrow("Schema service unavailable");
    expect(schemaReadCount).toBe(1);

    // Once `/admin/getSchema` recovers, retrying `routingForm` succeeds cleanly.
    failSchemaRead = false;
    const recovered = panelFormDescriptionSchema.parse(
      await reads.routingForm("domain", { changedField: null }),
    );
    expect(recovered.sections?.map((s) => s.key)).toEqual(["classRoutes", "relationshipRoutes"]);
  });

  it("shows single-source fallback hint and routes unrouted classes when only one data source exists in sourceCatalog", async () => {
    const reads = createDataAdapterConfigReads(actor);
    const refreshed = panelFormDescriptionSchema.parse(
      await reads.routingForm("domain", {
        changedField: "/sourceCatalog",
        values: {
          sourceCatalog: [{ id: "sole-graph", adapterType: "m3" }],
          classRoutes: [
            { className: "Order", sourceId: "" },
            { className: "Device", sourceId: "" },
            { className: "Rack", sourceId: "" },
          ],
          relationshipRoutes: [],
        },
      }),
    );

    const classSection = refreshed.sections?.find((s) => s.key === "classRoutes");
    expect(classSection?.hint).toContain("sole-graph");
    const rels = refreshed.values.relationshipRoutes as Array<{ relationship: string; source: string; edgeEditable: boolean }>;
    expect(rels.every((r) => r.source === "sole-graph" && r.edgeEditable === true)).toBe(true);
  });
});

describe("platform:DataAdapterConfig.save operation", () => {
  it("restores masked secret when left blank on single-source save, sends new secret when provided, and rejects blank unsaved required secret", async () => {
    const op = saveOp();

    // 1. Blank password on saved postgresql => restores ******
    const keepRes = await op.execute(makeHost(), domainTarget, {
      values: {
        adapterMode: "postgresql",
        connection: { url: "jdbc:postgresql://db2:5432/app", user: "appuser", password: "" },
      },
    }, "intent-1");
    expect(keepRes.kind).toBe("success");
    expect(savedSingleBodies[0]).toEqual({
      type: "postgresql",
      url: "jdbc:postgresql://db2:5432/app",
      user: "appuser",
      password: "******",
    });

    // 2. Explicit new password => sends plaintext new password
    const replaceRes = await op.execute(makeHost(), domainTarget, {
      values: {
        adapterMode: "postgresql",
        connection: { url: "jdbc:postgresql://db2:5432/app", user: "appuser", password: "new-password" },
      },
    }, "intent-2");
    expect(replaceRes.kind).toBe("success");
    expect(savedSingleBodies[1]).toEqual({
      type: "postgresql",
      url: "jdbc:postgresql://db2:5432/app",
      user: "appuser",
      password: "new-password",
    });

    // 3. Unsaved adapter (m3) with blank required password => field-level refusal
    const refused = await op.execute(makeHost(), domainTarget, {
      values: {
        adapterMode: "m3",
        connection: { url: "m3:8080", company: "acme", user: "admin", password: "" },
      },
    }, "intent-3");
    expect(refused).toMatchObject({
      kind: "refusal",
      code: "INVALID_DATA_ADAPTER",
      errors: [{ field: "/connection/password", code: "required" }],
    });
    expect(savedSingleBodies).toHaveLength(2);
  });

  it("saves multi-source definition with per-source secret restoration and maps Java rejection problems to field errors", async () => {
    const op = saveOp();

    // Successful save restores ****** for crm & graph while sending new secret for brand new source
    const ok = await op.execute(makeHost(), domainTarget, {
      values: {
        adapterMode: multiDataSourceType,
        dataSources: [
          {
            id: "crm",
            label: "CRM",
            readOnly: false,
            adapter: { adapterType: "postgresql", connection: { url: "jdbc:postgresql://crm:5432/crm", user: "crm", password: "" } },
          },
          {
            id: "graph",
            label: "Graph",
            readOnly: true,
            adapter: { adapterType: "m3", connection: { url: "graph:8080", company: "acme", user: "root", password: "" } },
          },
        ],
        classRoutes: [
          { className: "Order", sourceId: "crm" },
          { className: "Device", sourceId: "graph" },
          { className: "Rack", sourceId: "graph" },
        ],
        relationshipRoutes: [
          { relationship: "MOUNTED_ON", realEdge: "mounted_on_rack" },
          { relationship: "ORDER_DEVICE", realEdge: "" },
        ],
      },
      submittedFields: ["/adapterMode", "/dataSources", "/classRoutes", "/relationshipRoutes"],
    }, "intent-m1");
    expect(op.inputSchema.parse({
      values: { adapterMode: multiDataSourceType },
      submittedFields: ["/adapterMode"],
    })).toEqual({
      values: { adapterMode: multiDataSourceType },
      submittedFields: ["/adapterMode"],
    });
    expect(ok.kind).toBe("success");
    expect(savedMultiBodies[0]).toEqual({
      dataSources: [
        {
          id: "crm",
          label: "CRM",
          adapterType: "postgresql",
          readOnly: false,
          connection: { url: "jdbc:postgresql://crm:5432/crm", user: "crm", password: "******" },
        },
        {
          id: "graph",
          label: "Graph",
          adapterType: "m3",
          readOnly: true,
          connection: { url: "graph:8080", company: "acme", user: "root", password: "******" },
        },
      ],
      classes: [
        { forOntoMap: "Order", sourceId: "crm" },
        { forOntoMap: "Device", sourceId: "graph" },
        { forOntoMap: "Rack", sourceId: "graph" },
      ],
      relationships: [{ forOntoMap: "MOUNTED_ON", realEdge: "mounted_on_rack" }],
    });

    // Rejected save with data.problems => maps dataSources problems and preserves full summary without reading schema
    nextMultiSaveResponse = {
      success: false,
      message: "Invalid multi-source configuration",
      data: {
        problems: [
          { path: "dataSources[crm]", detail: "data source crm has invalid adapter type" },
          { path: "classDef[Order]", detail: "class Order is not routed to a data source" },
        ],
      },
    };
    const rejected = await op.execute(makeHost(), domainTarget, {
      values: {
        adapterMode: multiDataSourceType,
        dataSources: [
          {
            id: "crm",
            label: "CRM",
            readOnly: false,
            adapter: { adapterType: "postgresql", connection: { url: "jdbc:postgresql://crm:5432/crm", user: "crm", password: "" } },
          },
        ],
        classRoutes: [{ className: "Order", sourceId: "crm" }],
        relationshipRoutes: [],
      },
    }, "intent-m2");

    expect(schemaReadCount).toBe(0);
    expect(rejected).toMatchObject({
      kind: "refusal",
      code: "MULTI_DATA_SOURCE_REJECTED",
    });
    if (rejected.kind !== "refusal") throw new Error("expected refusal");
    expect(rejected.message).toContain("classDef[Order]");
    expect(rejected.errors?.[0]?.field).toBe("/dataSources/0/adapter/adapterType");
    expect(rejected.details).toEqual({
      problems: [
        { path: "dataSources[crm]", message: "data source crm has invalid adapter type" },
        { path: "classDef[Order]", message: "class Order is not routed to a data source" },
      ],
    });
  });

  it("saves routing-only changes through platform:DataAdapterConfig.saveRouting and maps routing rejection problems to exact fields", async () => {
    const op = saveRoutingOp();
    nextMultiSaveResponse = { success: true, data: { sandboxCapability: failedCapability } };

    const ok = await op.execute(makeHost(), domainTarget, {
      values: {
        classRoutes: [
          { className: "Order", sourceId: "graph" },
          { className: "Device", sourceId: "graph" },
          { className: "Rack", sourceId: "graph" },
        ],
        relationshipRoutes: [
          { relationship: "MOUNTED_ON", realEdge: "mounted_on_rack" },
          { relationship: "ORDER_DEVICE", realEdge: "order_uses_device" },
        ],
      },
    }, "intent-r1");
    expect(ok).toMatchObject({
      kind: "success", data: { sandboxCapability: failedCapability },
      affected: { objectTypes: [DATA_ADAPTER_CONFIG, ACTION] },
    });
    expect(savedMultiBodies[0]).toMatchObject({
      classes: [
        { forOntoMap: "Order", sourceId: "graph" },
        { forOntoMap: "Device", sourceId: "graph" },
        { forOntoMap: "Rack", sourceId: "graph" },
      ],
      relationships: [
        { forOntoMap: "MOUNTED_ON", realEdge: "mounted_on_rack" },
        { forOntoMap: "ORDER_DEVICE", realEdge: "order_uses_device" },
      ],
    });

    nextMultiSaveResponse = {
      success: false,
      message: "Invalid multi-source routing",
      data: {
        problems: [
          { path: "classDef[Order]", detail: "class Order is not routed to a data source" },
          { path: "relationshipDef[ORDER_DEVICE]", detail: "the relationship crosses data sources" },
          { path: "relationships[MOUNTED_ON]", detail: "physical edge name conflict" },
        ],
      },
    };
    const rejected = await op.execute(makeHost(), domainTarget, {
      values: {
        classRoutes: [{ className: "Order", sourceId: "crm" }],
        relationshipRoutes: [],
      },
    }, "intent-r2");
    expect(rejected).toMatchObject({
      kind: "refusal",
      code: "MULTI_DATA_SOURCE_REJECTED",
    });
    if (rejected.kind !== "refusal") throw new Error("expected refusal");
    expect(rejected.errors?.map((e) => e.field)).toEqual([
      "/classRoutes/0/sourceId",
      "/relationshipRoutes/1",
      "/relationshipRoutes/0/realEdge",
    ]);
    expect(rejected.details).toEqual({
      problems: [
        { path: "classDef[Order]", message: "class Order is not routed to a data source" },
        { path: "relationshipDef[ORDER_DEVICE]", message: "the relationship crosses data sources" },
        { path: "relationships[MOUNTED_ON]", message: "physical edge name conflict" },
      ],
    });
  });
});

describe("sandbox permission writes", () => {
  it("checks the saved configuration only on the explicit operation and invalidates both panels", async () => {
    const check = dataAdaptersServerOperations.find((op) => op.handlerRef === CHECK_DATA_ADAPTER_SANDBOX_PERMISSION);
    if (!check || check.effect !== "write" || check.kind !== "action" || !check.targetLabel || check.batch) {
      throw new Error("Missing targeted check operation");
    }
    await expect(check.execute(makeHost(), domainTarget, {}, "intent-check")).resolves.toMatchObject({
      kind: "success", data: { sandboxCapability: failedCapability },
      affected: { objectTypes: [DATA_ADAPTER_CONFIG, ACTION] },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the failed permission check as part of a successful single-source save", async () => {
    nextSingleSaveResponse = { success: true, data: { sandboxCapability: failedCapability } };
    await expect(saveOp().execute(makeHost(), domainTarget, {
      values: { adapterMode: "postgresql", connection: { url: "jdbc:postgresql://db:5432/app", user: "appuser" } },
    }, "intent-save")).resolves.toMatchObject({
      kind: "success", data: { adapterMode: "postgresql", sandboxCapability: failedCapability },
      affected: { objectTypes: [DATA_ADAPTER_CONFIG, ACTION] },
    });
  });
});

describe("dataAdapters.testConnection read operation", () => {
  it("tests single-source draft with restored secret and returns structured JSON catalog report", async () => {
    const op = testOp();
    const res = await op.execute(makeHost(), {
      target: domainTarget,
      input: {
        draft: {
          adapterMode: "postgresql",
          connection: { url: "jdbc:postgresql://db:5432/app", user: "appuser", password: "" },
        },
        parameters: { sourceId: "" },
      },
    });

    expect(testedBodies[0]).toEqual({
      type: "postgresql",
      url: "jdbc:postgresql://db:5432/app",
      user: "appuser",
      password: "******",
    });
    expect(res).toEqual({
      kind: "json",
      value: {
        kind: "catalog",
        sandboxCapability: failedCapability,
        elapsedMs: 14,
        databaseProduct: "PostgreSQL",
        databaseVersion: "16.2",
        driverName: "PostgreSQL JDBC Driver",
        driverVersion: "42.7.3",
        catalog: "app",
        schema: "public",
        tables: [
          { name: "orders", type: "TABLE" },
          { name: "active_orders", type: "VIEW" },
        ],
      },
    });
  });

  it("tests a specific multi-source data source by sourceId and returns structured JSON search report", async () => {
    nextTestResponse = {
      success: true,
      data: {
        kind: "search",
        sandboxCapability: { ...failedCapability, status: "unsupported", supported: false, details: {} },
        elapsedMs: 7,
        databaseProduct: "OpenSearch",
        databaseVersion: "2.13.0",
        clusterName: "prod-es",
        indices: ["orders-2026", "customers"],
      },
    };

    const op = testOp();
    const res = await op.execute(makeHost(), {
      target: domainTarget,
      input: {
        draft: {
          adapterMode: multiDataSourceType,
          dataSources: [
            {
              id: "crm",
              label: "CRM",
              readOnly: false,
              adapter: { adapterType: "postgresql", connection: { url: "jdbc:postgresql://crm:5432/crm", user: "crm", password: "" } },
            },
            {
              id: "search-idx",
              label: "Search",
              readOnly: true,
              adapter: { adapterType: "opensearch", connection: { url: "https://search:9200", user: "admin", password: "pw" } },
            },
          ],
        },
        parameters: { sourceId: "search-idx" },
      },
    });

    expect(testedBodies[0]).toEqual({
      type: "opensearch",
      sourceId: "search-idx",
      url: "https://search:9200",
      user: "admin",
      password: "pw",
    });
    expect(res).toEqual({
      kind: "json",
      value: {
        kind: "search",
        sandboxCapability: { ...failedCapability, status: "unsupported", supported: false, details: {} },
        elapsedMs: 7,
        databaseProduct: "OpenSearch",
        databaseVersion: "2.13.0",
        clusterName: "prod-es",
        indices: ["orders-2026", "customers"],
      },
    });

    // Failure response keeps raising DATA_ADAPTER_TEST_FAILED so the inline report displays the error alert.
    nextTestResponse = { success: false, message: "Connection refused" };
    await expect(op.execute(makeHost(), {
      target: domainTarget,
      input: {
        draft: {
          adapterMode: "postgresql",
          connection: { url: "jdbc:postgresql://db:5432/app", user: "appuser", password: "" },
        },
        parameters: { sourceId: "" },
      },
    })).rejects.toMatchObject({ status: 422, code: "DATA_ADAPTER_TEST_FAILED", message: "Connection refused" });

    // Multi-source with multiple sources and missing sourceId fails cleanly
    await expect(op.execute(makeHost(), {
      target: domainTarget,
      input: {
        draft: {
          adapterMode: multiDataSourceType,
          dataSources: [
            { id: "crm", label: "CRM", readOnly: false, adapter: { adapterType: "postgresql", connection: { url: "u", user: "a", password: "" } } },
            { id: "graph", label: "Graph", readOnly: false, adapter: { adapterType: "m3", connection: { url: "g", company: "c", user: "u", password: "" } } },
          ],
        },
        parameters: { sourceId: "" },
      },
    })).rejects.toMatchObject({ status: 422, code: "DATA_SOURCE_REQUIRED" });
  });
});

describe("built-in data-adapters panel validation", () => {
  it("passes checkBuiltinPanelSource, projection expansion, reference checks, 8-locale parity, and settings.json registration", async () => {
    const repoRoot = resolve(__dirname, "../../../../../..");
    const { checkBuiltinPanelSource } = await import(resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs"));
    const { components } = await import(resolve(repoRoot, "packages/apps-sdk/src/catalogue.ts"));

    const typeMap = platformTypeEntries();
    const draftReadOperationIds = [...typeMap.values()].flatMap(({ operations = [] }) =>
      operations.filter((operation) => operation.effect === "read" && operation.target.source === "draft").map((operation) => operation.id),
    );
    expect(draftReadOperationIds).toContain(TEST_DATA_ADAPTER_CONNECTION);
    const dataAdapterOps = typeMap.get(DATA_ADAPTER_CONFIG)?.operations?.map((o) => o.id) ?? [];
    expect(dataAdapterOps).toContain(`${DATA_ADAPTER_CONFIG}.save`);
    expect(dataAdapterOps).toContain(TEST_DATA_ADAPTER_CONNECTION);
    expect(dataAdapterOps).toContain(CHECK_DATA_ADAPTER_SANDBOX_PERMISSION);

    const dir = resolve(repoRoot, "packages/platform-admin/resources/builtin-panels/data-adapters");
    await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds });

    const mod = readFileSync(resolve(dir, "panel.mjs"), "utf8");
    const html = readFileSync(resolve(dir, "panel.html"), "utf8");
    const reg = JSON.parse(readFileSync(resolve(dir, "registration.json"), "utf8"));
    const desc = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));

    expect(mod).not.toContain("usePanelData");
    expect(mod).not.toContain("fetch(");
    expect(html).not.toContain("<el-");
    expect(html).not.toContain("--el-");

    // Verify 8-locale completeness & key parity in panel.json content.messages
    const expectedLocales = ["en", "zh-CN", "zh-TW", "ja", "de", "fr", "it", "ar"];
    const messages = desc.content.messages as Record<string, Record<string, string>>;
    expect(Object.keys(messages).sort()).toEqual([...expectedLocales].sort());
    const enKeys = Object.keys(messages.en!).sort();
    for (const loc of expectedLocales) {
      expect(Object.keys(messages[loc]!).sort()).toEqual(enKeys);
    }

    const typeTable = {
      objectTypes: z.record(platformTypeTableEntrySchema).parse(Object.fromEntries(typeMap)),
    };
    const catalogueMap = new Map(components.map((component: { module: string; componentId: string }) => {
      const pkg = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
      return [`${pkg}:${component.componentId}`, component];
    }));
    const readCatalogue = async () => ({ version: "1.1.2", digest: "test", components: catalogueMap });

    const panels = new Map();
    const projections = new Map();
    const { state, members, ...decl } = desc.manifest;
    const placements = Object.fromEntries(Object.entries(members).map(([member, def]) => {
      const typed = def as { id: string; name?: string; description?: string };
      const { projection, placement } = panelCheck.expandPanelAuthoringMember(member, def as never, {
        state,
        components: [...catalogueMap.values()] as never,
        typeTable,
      });
      projections.set(typed.id, panelCheck.builtinProductProjectionInputSchema.parse({
        ...projection,
        visibility: "platform",
        name: typed.name ?? member,
        description: typed.description ?? member,
      }));
      return [member, { ...placement, target: { projectionId: typed.id } }];
    }));
    const { id, input } = reg.panels[0];
    panels.set(id, panelCheck.builtinProductPanelInputSchema.parse({
      ...input,
      visibility: "platform",
      manifest: { ...decl, state, members: placements },
      content: { ...desc.content, html, module: mod },
    }));

    for (const [projId, proj] of projections) {
      await validateProjectionComponent(projId, proj, readCatalogue as never);
    }
    await validateBuiltinProductReferences(panels, projections, readCatalogue as never);

    // Also verify readBuiltinProducts loads this panel cleanly via bundle directory
    const bundle = await new Promise<string>((ok, fail) => mkdtemp(path.join(tmpdir(), "da-panel-"), (e, d) => (e ? fail(e) : ok(d))));
    try {
      await new Promise<void>((ok, fail) => symlink(dir, path.join(bundle, "data-adapters"), (e) => (e ? fail(e) : ok())));
      writeFileSync(path.join(bundle, "index.json"), JSON.stringify(["data-adapters"]));
      const { readBuiltinProducts } = await import("../../product-panels/builtin-products");
      // Just verify settings.json entry parses cleanly and points to builtin-product-data-adapters
      const settings = JSON.parse(readFileSync(resolve(repoRoot, "packages/data-engine-core/src/main/resources/applications/settings.json"), "utf8"));
      const use = settings.declaration.panelUses.find((entry: { id: string }) => entry.id === "data-adapters");
      expect(use).toBeDefined();
      panelCheck.builtinApplicationPanelUseSchema.parse(use);
      expect(use.panelId).toBe("builtin-product-data-adapters");
      expect(use.path).toBe("/settings/system-config/data-adapters");
      expect(Object.keys(use.names).sort()).toEqual([...expectedLocales].sort());
      expect(typeof readBuiltinProducts).toBe("function");
    } finally {
      await new Promise<void>((ok) => rm(bundle, { recursive: true, force: true }, () => ok()));
    }
  });
});
