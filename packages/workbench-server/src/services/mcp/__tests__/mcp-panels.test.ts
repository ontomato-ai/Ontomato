import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCP_HEADER_MASK, type McpServiceView } from "@ontomato/contracts/agent-runtime-mcp";
import * as panelCheck from "@ontomato/contracts/panel-check";
import {
  CHECK_EXTERNAL_MCP_SERVICE,
  CREATE_EXTERNAL_MCP_SERVICE,
  DELETE_EXTERNAL_MCP_SERVICE,
  EXTERNAL_MCP_SERVICE,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { PanelOperationHost } from "../../product-panels/server-operations";

const mockAssertManagement = vi.fn(async (..._args: unknown[]) => undefined);
const mockGrantedProductIds = vi.fn(async (..._args: unknown[]): Promise<string[]> => []);
const mockChannelAgents = vi.fn(async (..._args: unknown[]): Promise<Array<{
  id: string;
  kind: string;
  name: string;
  enabled_mcp_service_ids: string[];
}>> => []);

const mockRuntime = {
  mcpOptions: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []),
  mcpServices: vi.fn(async (): Promise<{ services: McpServiceView[] }> => ({ services: [] })),
  saveMcpService: vi.fn(async (_input: unknown, _id?: string): Promise<{ service: McpServiceView }> => {
    throw new Error("saveMcpService mock not configured");
  }),
  deleteMcpService: vi.fn(async (_id: string): Promise<void> => undefined),
  mcpTools: vi.fn(async (_id: string, _signal: AbortSignal): Promise<{
    tools: Array<{ name: string; title?: string; description?: string; inputSchema?: Record<string, unknown> }>;
  }> => ({ tools: [] })),
};

vi.mock("../../../config/application", () => ({
  config: { dataQuery: { baseUrl: "http://java" }, apiBase: "/api" },
}));
vi.mock("../../../identity/management", () => ({
  assertManagement: (...args: unknown[]) => mockAssertManagement(...args),
}));
vi.mock("../../../product/installed", () => ({
  workbenchProduct: () => ({ analysisMcpServerName: "analysis-agents", opsMcpServerName: "ops-agent" }),
}));
vi.mock("../catalog", () => ({
  publishedMcpCatalogue: vi.fn(async () => ({
    success: true,
    services: [
      {
        name: "analysis-agents",
        title: "Raw Analysis MCP",
        mcpUrl: "http://example/mcp/analysis-agents",
        tools: [
          {
            name: "list_agents",
            title: "List Agents",
            description: "List enabled agents",
            inputSchema: { type: "object", properties: { limit: { type: "number" } } },
          },
        ],
      },
      {
        name: "ops-agent",
        title: "Raw Ops MCP",
        mcpUrl: "http://example/mcp/ops-agent",
        tools: [],
      },
    ],
  })),
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: vi.fn(() => mockRuntime),
}));
vi.mock("../../product-governance/grants", () => ({
  productGrantAllowed: vi.fn(async () => false),
  readProductGrantRecords: vi.fn(async () => ({ grants: [] })),
  requireProductGrant: vi.fn(async () => undefined),
}));
vi.mock("../../assistant/authorization", () => ({
  allowedAgents: async (agents: { id: string }[], verb: string, credentials: unknown) => {
    const ids = await mockGrantedProductIds(verb, credentials);
    return agents.filter(agent => ids.includes(agent.id));
  },
}));
vi.mock("../../assistant/store", () => ({
  assistantStore: {
    channelAgents: (...args: unknown[]) => mockChannelAgents(...args),
  },
}));

installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: true,
  appTextLocale: "en",
  packs: {
    en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta },
  },
});

const { readPublishedMcpServices, readPublishedMcpService, readPublishedMcpServiceTools } = await import("../panel-reads");
const { createExternalMcpReads, externalMcpServerOperations } = await import("../external-mcp-panel");
const { platformTypeEntries } = await import("../../product-panels/type-table");
const { validateBuiltinProductReferences } = await import("../../product-panels/references");

const SERVICE_ID_1 = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID_2 = "22222222-2222-4222-8222-222222222222";
const AGENT_ID_VISIBLE = "33333333-3333-4333-8333-333333333333";
const AGENT_ID_HIDDEN = "44444444-4444-4444-8444-444444444444";

const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "tok", locale: "en" } as never;

function makeHost(): PanelOperationHost {
  return {
    initiator: { owner, credentials: viewer },
    executor: { owner, credentials: viewer },
    locale: "en",
    requestWorkbench: vi.fn(),
    request: vi.fn(),
  };
}

function getWriteOp(id: string) {
  const op = externalMcpServerOperations.find((item) => item.handlerRef === id);
  if (!op || op.effect !== "write" || op.batch) throw new Error(`Missing write operation ${id}`);
  return {
    ...op,
    run: (host: PanelOperationHost, target: { kind: "draft" } | { kind: "object"; objectType: string; primaryKey: string }, input: Record<string, unknown>, intentId: string) =>
      (op.execute as (h: PanelOperationHost, t: typeof target, i: Record<string, unknown>, id: string) => Promise<unknown>)(host, target, input, intentId),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertManagement.mockResolvedValue(undefined);
  mockGrantedProductIds.mockResolvedValue([]);
  mockChannelAgents.mockResolvedValue([]);
  mockRuntime.mcpOptions.mockResolvedValue([]);
  mockRuntime.mcpServices.mockResolvedValue({ services: [] });
  mockRuntime.mcpTools.mockResolvedValue({ tools: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PublishedMcpService owner reads", () => {
  it("returns clean summary fields (with authHint, without redundant tools JSON) and structured tools rows", async () => {
    const list = await readPublishedMcpServices(owner, viewer);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      primaryKey: "analysis-agents",
      label: "Agent service",
      fields: {
        mcpUrl: "http://example/mcp/analysis-agents",
        status: "Published",
        toolCount: "1",
        authHint: expect.any(String),
      },
      tones: { status: "success" },
    });
    expect(list[0]!.fields).not.toHaveProperty("tools");

    const single = await readPublishedMcpService(owner, viewer, "analysis-agents");
    expect(single.primaryKey).toBe("analysis-agents");

    const tools = await readPublishedMcpServiceTools(owner, viewer, "analysis-agents");
    expect(tools).toEqual([
      expect.objectContaining({
        primaryKey: "list_agents",
        label: "List Agents",
        subtitle: "list_agents",
        fields: {
          name: "list_agents",
          description: "List enabled agents",
          inputSchema: JSON.stringify({ type: "object", properties: { limit: { type: "number" } } }, null, 2),
        },
      }),
    ]);

    await expect(readPublishedMcpServiceTools(owner, viewer, "missing")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});

describe("ExternalMcpService owner reads and caller-scoped usedBy", () => {
  it("serves options and resolve without requiring a management operation", async () => {
    mockAssertManagement.mockRejectedValue(new HttpError(403, "Forbidden", "FORBIDDEN"));
    mockRuntime.mcpOptions.mockResolvedValue([{ id: SERVICE_ID_1, name: "Orders MCP" }]);

    const reads = createExternalMcpReads(owner, viewer);
    expect(await reads.options()).toEqual({
      options: [{ primaryKey: SERVICE_ID_1, value: SERVICE_ID_1, label: "Orders MCP" }],
    });

    const resolved = await reads.resolve([SERVICE_ID_1, SERVICE_ID_2]);
    expect(resolved.options).toEqual([
      { primaryKey: SERVICE_ID_1, value: SERVICE_ID_1, label: "Orders MCP" },
      { primaryKey: SERVICE_ID_2, value: SERVICE_ID_2, label: SERVICE_ID_2, unavailable: { reason: expect.any(String) } },
    ]);
    expect(mockAssertManagement).not.toHaveBeenCalled();
  });

  it("computes usedBy only from caller-visible agents and omits usedBy when caller sees no agents or query fails", async () => {
    mockRuntime.mcpServices.mockResolvedValue({
      services: [
        { id: SERVICE_ID_1, name: "Orders MCP", url: "https://orders.example/mcp", headers: { authorization: MCP_HEADER_MASK } },
        { id: SERVICE_ID_2, name: "Billing MCP", url: "https://billing.example/mcp", headers: {} },
      ],
    });
    mockGrantedProductIds.mockResolvedValue([AGENT_ID_VISIBLE]);
    mockChannelAgents.mockResolvedValue([
      { id: AGENT_ID_VISIBLE, kind: "custom", name: "Sales Agent", enabled_mcp_service_ids: [SERVICE_ID_1] },
      { id: AGENT_ID_HIDDEN, kind: "custom", name: "Secret Agent", enabled_mcp_service_ids: [SERVICE_ID_1, SERVICE_ID_2] },
    ]);

    const reads = createExternalMcpReads(owner, viewer);
    const listWithUsage = await reads.list();
    expect(listWithUsage[0]!.fields).toMatchObject({
      name: "Orders MCP",
      url: "https://orders.example/mcp",
      headerNames: "authorization",
      usedBy: "Sales Agent",
    });
    expect(listWithUsage[1]!.fields).toMatchObject({
      name: "Billing MCP",
      usedBy: "Not used",
    });
    // Secret mask/values are never returned in list fields.
    expect(JSON.stringify(listWithUsage)).not.toContain(MCP_HEADER_MASK);

    // Caller sees no agents -> omit usedBy completely.
    mockGrantedProductIds.mockResolvedValue([]);
    const listNoVisibleAgents = await reads.list();
    expect(listNoVisibleAgents[0]!.fields).not.toHaveProperty("usedBy");
    expect(listNoVisibleAgents[1]!.fields).not.toHaveProperty("usedBy");

    // Agent lookup failure must never block main external MCP list.
    mockGrantedProductIds.mockRejectedValue(new Error("agent owner temporarily down"));
    const listOnAgentError = await reads.list();
    expect(listOnAgentError).toHaveLength(2);
    expect(listOnAgentError[0]!.fields).not.toHaveProperty("usedBy");
  });

  it("redacts stored header values on form read and marks header values as secret", async () => {
    mockRuntime.mcpServices.mockResolvedValue({
      services: [
        { id: SERVICE_ID_1, name: "Orders MCP", url: "https://orders.example/mcp", headers: { authorization: MCP_HEADER_MASK } },
      ],
    });
    const reads = createExternalMcpReads(owner, viewer);
    const form = await reads.form(SERVICE_ID_1, { changedField: null });

    expect(form.values).toEqual({
      name: "Orders MCP",
      url: "https://orders.example/mcp",
      headers: [{ name: "authorization", value: "", storedName: "authorization" }],
    });
    const headersField = form.fields.find((field) => field.path === "/headers");
    expect(headersField?.control.kind).toBe("object-array");
    if (headersField?.control.kind === "object-array") {
      const valueField = headersField.control.itemFields.find((f) => f.path === "/value");
      expect(valueField?.control).toMatchObject({ kind: "text", secret: true });
      const storedField = headersField.control.itemFields.find((f) => f.path === "/storedName");
      expect(storedField?.control).toEqual({ kind: "hidden" });
    }
  });

  it("discovers tools on demand via tools read and propagates upstream failures", async () => {
    mockRuntime.mcpTools.mockResolvedValueOnce({
      tools: [
        {
          name: "create_order",
          title: "Create Order",
          description: "Creates an order",
          inputSchema: { type: "object", required: ["sku"] },
        },
      ],
    });
    const reads = createExternalMcpReads(owner, viewer);
    const tools = await reads.tools(SERVICE_ID_1);
    expect(tools).toEqual([
      expect.objectContaining({
        primaryKey: "create_order",
        label: "Create Order",
        subtitle: "create_order",
        fields: {
          name: "create_order",
          description: "Creates an order",
          inputSchema: JSON.stringify({ type: "object", required: ["sku"] }, null, 2),
        },
      }),
    ]);

    mockRuntime.mcpTools.mockRejectedValueOnce(new HttpError(502, "Unable to connect to MCP service", "MCP_DISCOVERY_FAILED"));
    await expect(reads.tools(SERVICE_ID_1)).rejects.toMatchObject({
      status: 502,
      code: "MCP_DISCOVERY_FAILED",
    });
  });
});

describe("ExternalMcpService server operations", () => {
  it("creates a service and returns created ref, refusing duplicate names on /name", async () => {
    const createOp = getWriteOp(CREATE_EXTERNAL_MCP_SERVICE);
    mockRuntime.saveMcpService.mockResolvedValueOnce({
      service: { id: SERVICE_ID_1, name: "Orders MCP", url: "https://orders.example/mcp", headers: { authorization: MCP_HEADER_MASK } },
    });

    const createInput = {
      values: { name: "Orders MCP", url: "https://orders.example/mcp", headers: [{ name: "Authorization", value: "Bearer top-secret" }] },
      submittedFields: ["/name", "/url", "/headers"],
    };
    expect(createOp.inputSchema.parse(createInput)).toEqual(createInput);
    const created = await createOp.run(
      makeHost(),
      { kind: "draft" },
      createInput,
      "intent-1",
    );
    expect(created).toMatchObject({
      kind: "success",
      data: { id: SERVICE_ID_1 },
      created: { objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
    });
    expect(mockRuntime.saveMcpService).toHaveBeenCalledWith({
      name: "Orders MCP",
      url: "https://orders.example/mcp",
      headers: { authorization: "Bearer top-secret" },
    });

    mockRuntime.saveMcpService.mockRejectedValueOnce(new HttpError(409, "MCP service name already exists", "MCP_NAME_EXISTS"));
    const duplicate = await createOp.run(
      makeHost(),
      { kind: "draft" },
      { values: { name: "Orders MCP", url: "https://orders.example/mcp", headers: [] } },
      "intent-2",
    );
    expect(duplicate).toMatchObject({
      kind: "refusal",
      code: "MCP_NAME_EXISTS",
      errors: [{ field: "/name", code: "already_exists" }],
    });
  });

  it("preserves stored header secrets when left blank on edit and refuses renaming stored header without new value", async () => {
    mockRuntime.mcpServices.mockResolvedValue({
      services: [
        { id: SERVICE_ID_1, name: "Orders MCP", url: "https://orders.example/mcp", headers: { authorization: MCP_HEADER_MASK } },
      ],
    });
    mockRuntime.saveMcpService.mockResolvedValue({
      service: { id: SERVICE_ID_1, name: "Orders MCP", url: "https://orders.example/mcp", headers: { authorization: MCP_HEADER_MASK } },
    });

    const saveOp = getWriteOp(`${EXTERNAL_MCP_SERVICE}.save`);
    const kept = await saveOp.run(
      makeHost(),
      { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
      {
        values: {
          name: "Orders MCP",
          url: "https://orders.example/mcp",
          headers: [
            { name: "authorization", value: "", storedName: "authorization" },
            { name: "X-Region", value: "eu-west" },
          ],
        },
      },
      "intent-3",
    );
    expect(kept).toMatchObject({ kind: "success", data: { id: SERVICE_ID_1 } });
    expect(mockRuntime.saveMcpService).toHaveBeenCalledWith(
      {
        name: "Orders MCP",
        url: "https://orders.example/mcp",
        headers: { authorization: null, "x-region": "eu-west" },
      },
      SERVICE_ID_1,
    );

    const partialRenameInput = {
      values: {
        name: "Orders MCP v2",
        url: "https://ignored.example/mcp",
        headers: [],
      },
      submittedFields: ["/name"],
    };
    expect(saveOp.inputSchema.parse(partialRenameInput)).toEqual(partialRenameInput);
    const partialRenamed = await saveOp.run(
      makeHost(),
      { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
      partialRenameInput,
      "intent-3b",
    );
    expect(partialRenamed).toMatchObject({ kind: "success", data: { id: SERVICE_ID_1 } });
    expect(mockRuntime.saveMcpService).toHaveBeenLastCalledWith(
      {
        name: "Orders MCP v2",
        url: "https://orders.example/mcp",
        headers: { authorization: null },
      },
      SERVICE_ID_1,
    );

    const renamedWithoutSecret = await saveOp.run(
      makeHost(),
      { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
      {
        values: {
          name: "Orders MCP",
          url: "https://orders.example/mcp",
          headers: [{ name: "x-api-key", value: "", storedName: "authorization" }],
        },
      },
      "intent-4",
    );
    expect(renamedWithoutSecret).toMatchObject({
      kind: "refusal",
      code: "INVALID_EXTERNAL_MCP",
      errors: [{ field: "/headers/0/name", code: "invalid_format" }],
    });
  });

  it("inspects delete impact with visible referencing agents and deletes service", async () => {
    mockRuntime.mcpServices.mockResolvedValue({
      services: [
        { id: SERVICE_ID_1, name: "Orders MCP", url: "https://orders.example/mcp", headers: {} },
      ],
    });
    mockGrantedProductIds.mockResolvedValue([AGENT_ID_VISIBLE]);
    mockChannelAgents.mockResolvedValue([
      { id: AGENT_ID_VISIBLE, kind: "custom", name: "Sales Agent", enabled_mcp_service_ids: [SERVICE_ID_1] },
    ]);

    const deleteOp = getWriteOp(DELETE_EXTERNAL_MCP_SERVICE);
    const impact = await deleteOp.inspectImpact!.inspect(makeHost(), [
      { target: { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 }, input: {} },
    ]);
    expect(impact?.summary).toContain("Orders MCP");
    expect(impact?.summary).toContain("Sales Agent");

    const deleted = await deleteOp.run(
      makeHost(),
      { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
      {},
      "intent-5",
    );
    expect(deleted).toMatchObject({
      kind: "success",
      affected: {
        removed: [{ objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 }],
      },
    });
    expect(mockRuntime.deleteMcpService).toHaveBeenCalledWith(SERVICE_ID_1);
  });

  it("configures inline non-reorderable headers editor (EM-06) and checks service reachability (EM-04)", async () => {
    const reads = createExternalMcpReads(owner, viewer);
    const createForm = await reads.createForm({ changedField: null });
    const headersField = createForm.fields.find((field) => field.path === "/headers");
    expect(headersField?.control).toMatchObject({
      kind: "object-array",
      presentation: "inline",
      reorderable: false,
      addLabel: "Add header",
    });

    const checkOp = externalMcpServerOperations.find((op) => op.handlerRef === CHECK_EXTERNAL_MCP_SERVICE);
    expect(checkOp).toBeDefined();
    expect(checkOp?.effect).toBe("read");
    if (!checkOp || checkOp.effect !== "read") throw new Error("Expected read operation");

    mockRuntime.mcpTools.mockResolvedValueOnce({
      tools: [
        { name: "create_order", title: "Create Order", description: "Creates an order" },
        { name: "list_orders", title: "List Orders" },
      ],
    });
    const okResult = await checkOp.execute(makeHost(), {
      target: { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
      input: {},
    });
    expect(okResult).toEqual({
      kind: "json",
      value: {
        reachable: true,
        toolCount: 2,
        status: { label: "Available", tone: "success" },
      },
      message: "Service available (2 tools)",
    });

    mockRuntime.mcpTools.mockRejectedValueOnce(new Error("Connection refused"));
    const failedResult = await checkOp.execute(makeHost(), {
      target: { kind: "object", objectType: EXTERNAL_MCP_SERVICE, primaryKey: SERVICE_ID_1 },
      input: {},
    });
    expect(failedResult).toEqual({
      kind: "json",
      value: {
        reachable: false,
        toolCount: 0,
        error: "Connection refused",
        status: { label: "Unreachable", tone: "danger" },
      },
      message: "Service unreachable: Connection refused",
    });
  });
});

describe("built-in MCP panels validation", () => {
  it("passes checkBuiltinPanelSource, projection expansion, 8-language parity, and settings.json entries", async () => {
    const repoRoot = resolve(__dirname, "../../../../../..");
    const { checkBuiltinPanelSource } = await import(
      resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
    );
    const { components } = await import(resolve(repoRoot, "packages/apps-sdk/src/catalogue.ts"));

    const typeMap = platformTypeEntries();
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
    const expectedLocales = ["ar", "de", "en", "fr", "it", "ja", "zh-CN", "zh-TW"];

    for (const dirName of ["published-mcp", "external-mcp"]) {
      const dir = resolve(repoRoot, "packages/platform-admin/resources/builtin-panels", dirName);
      await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds });
      const mod = readFileSync(resolve(dir, "panel.mjs"), "utf8");
      expect(mod).not.toContain("usePanelData");

      const reg = JSON.parse(readFileSync(resolve(dir, "registration.json"), "utf8"));
      const desc = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));
      const html = readFileSync(resolve(dir, "panel.html"), "utf8");

      if (dirName === "published-mcp") {
        expect(desc.manifest.members.serviceTools.config).toMatchObject({
          layout: "accordion",
          rowExpandMode: "multiple",
          showHeader: false,
          showFooter: false,
        });
      }
      if (dirName === "external-mcp") {
        expect(desc.manifest.members.services.operations.check).toMatchObject({
          operation: CHECK_EXTERNAL_MCP_SERVICE,
          target: "row",
        });
        expect(desc.manifest.members.services.config.columns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "status",
              kind: "tag",
              resultFrom: { operation: "check", field: "status" },
            }),
          ]),
        );
        const rowItems = desc.manifest.members.services.config.rowActions.items as Array<Record<string, unknown>>;
        for (const item of rowItems) {
          expect(item).not.toHaveProperty("danger");
          expect(item).not.toHaveProperty("primary");
        }
        expect(rowItems.at(-1)).toMatchObject({
          kind: "operation",
          operation: "delete",
          icon: "trash",
          iconOnly: true,
          tone: "danger",
        });
        expect(desc.manifest.members.inspectedTools.config).toMatchObject({
          layout: "accordion",
          rowExpandMode: "multiple",
          showHeader: false,
          showFooter: false,
        });
      }

      // Verify 8-language message key parity.
      const messages = desc.content.messages as Record<string, Record<string, string>>;
      expect(Object.keys(messages).sort()).toEqual(expectedLocales);
      const enKeys = Object.keys(messages.en!).sort();
      for (const locale of expectedLocales) {
        expect(Object.keys(messages[locale]!).sort(), `${dirName}/${locale}`).toEqual(enKeys);
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

    await validateBuiltinProductReferences(panels, projections, readCatalogue as never);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, "packages/data-engine-core/src/main/resources/applications/settings.json"), "utf8"),
    );
    const uses = settings.declaration.panelUses as Array<{ id: string; panelId: string; path: string }>;
    expect(uses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-mcp",
          panelId: "builtin-product-external-mcp",
          path: "/settings/external-mcp",
        }),
        expect.objectContaining({
          id: "published-mcp",
          panelId: "builtin-product-published-mcp",
          path: "/settings/mcp-services",
        }),
      ]),
    );
  });
});
