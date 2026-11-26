import type { ObjectDecisionRequest } from "../../product-governance/authorization";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import {
  assistantAgentsQuerySchema,
  type PageSkillEntrance,
  type PageSkillSource,
  type PageSkillsProjection,
} from "@ontomato/contracts/page-skills";
import type { ApplicationPanelUsesResponse } from "@ontomato/contracts/product-panels";
import { installContentLayout } from "../../../content/layout";
import type { ProtectedSkillOffering } from "../../../core/skills/providers";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { SkillSourceIdentity } from "../../skills/view";
import type { AgentRow } from "../store";

const mocks = vi.hoisted(() => ({
  agents: vi.fn<[], Promise<AgentRow[]>>(),
  query: vi.fn(),
  listOfferings: vi.fn(),
  findByUse: vi.fn(),
  managementAccess: vi.fn<[], Promise<void>>(),
  homePanelId: vi.fn<[], Promise<string | null>>(),
}));

vi.mock("../../../infrastructure/postgres", async original => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query: mocks.query }),
}));
vi.mock("../../product-governance/grants", async original => ({
  ...await original<typeof import("../../product-governance/grants")>(),
  productDefinitionOwnerHeaders: () => ({}),
}));
vi.mock("../../../identity/management", () => ({
  assertManagement: mocks.managementAccess,
}));
vi.mock("../../product-panels/skill-provider", () => ({
  panelSkillProvider: { findByUse: mocks.findByUse },
}));
vi.mock("../../platform-home/store", () => ({ platformHomeStore: { homePanelId: mocks.homePanelId } }));

configureI18n({
  defaultLocale: "en",
  packs: { en: { messages: en, ...enLocaleMeta } },
  languageSwitchEnabled: false,
  appTextLocale: "en",
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), "page-candidates-view-"));
installContentLayout({
  runtimeRoot: root,
  prompts: [],
  runtimeResources: [],
  publicSkillsRoot: path.resolve("skills"),
});

const { registerSkillProvider, protectedSkillRef } = await import("../../../core/skills/providers");
const { registerPageSkillSourceOwner } = await import("../../skills/view");
const { listAssistantAgents } = await import("../agents");
const { listAgentDefinitions } = await import("../definitions");

const domain = "candidates-domain";
const owner = { domainId: domain, userId: "user-1" };
const credentials = { token: "initiator-token", locale: "en" };

const publicDataBrowserSkill: RuntimeSkillRef = {
  namespace: { kind: "provider", provider: "workbench" },
  name: "data-browser-public",
};
const legacyOrderRef: RuntimeSkillRef = {
  namespace: { kind: "domain", domainId: domain },
  name: "panel-menu-orders-123456789012345678901234",
};

// One ref per panel, whatever entrance or placement shows it.
const panelOrderRef = protectedSkillRef("product-panels", domain, "panel-order");
const panelInvoiceRef = protectedSkillRef("product-panels", domain, "panel-invoice");

const ordersEntrance: PageSkillEntrance = { applicationId: "app-orders", entryKey: "use-order", pageKey: "orders-page" };
const observerEntrance: PageSkillEntrance = { applicationId: "operations", entryKey: "ops-turn-evidence", pageKey: "ops-turn-evidence" };
const dataBrowserEntrance: PageSkillEntrance = { applicationId: "data-browser", entryKey: "browse", pageKey: "data-browser" };
const homeEntrance: PageSkillEntrance = { applicationId: "home", entryKey: "home", pageKey: "home" };

const agentIds = {
  regular: "11111111-1111-4111-8111-111111111111",
  publicOnly: "22222222-2222-4222-8222-222222222222",
  orderCustom: "33333333-3333-4333-8333-333333333333",
  legacyOrderCustom: "44444444-4444-4444-8444-444444444444",
  invoiceCustom: "55555555-5555-4555-8555-555555555555",
  disabledOrder: "66666666-6666-4666-8666-666666666666",
  secondOrderCustom: "77777777-7777-4777-8777-777777777777",
};

function agentRow(
  id: string,
  kind: string,
  skills: RuntimeSkillRef[],
  options: { enabled?: boolean; sortOrder?: number } = {},
): AgentRow {
  return {
    id,
    domain_id: domain,
    kind,
    name: kind,
    description: "",
    icon: null,
    enabled: options.enabled ?? true,
    owner_id: null, execution_user_id: null,
    system_prompt: "prompt",
    model_selection: { modelId: null },
    skills,
    class_names: [],
    enabled_mcp_service_ids: [],
    sort_order: options.sortOrder ?? 0,
  };
}

function protectedOffering(
  sourceKey: string,
  options: {
    entrances: readonly PageSkillEntrance[];
    resourceIds: readonly string[];
  },
): ProtectedSkillOffering {
  return {
    kind: "protected",
    sourceKey,
    entrances: options.entrances,
    resourceIds: options.resourceIds,
    readManifest: async (ref) => ({ name: ref.name, description: `Protected ${sourceKey}` }),
    provide: async (ref) => ({
      skill: ref,
      files: [{ path: "SKILL.md", content: `---\nname: ${ref.name}\ndescription: Protected ${sourceKey}\n---\n` }],
    }),
  };
}

let offerings: ProtectedSkillOffering[] = [];
registerSkillProvider({
  id: "product-panels",
  name: "Product panels",
  list: mocks.listOfferings,
  findProtectedSource: async key => offerings.find(offering => offering.sourceKey === key) ?? null,
});

let dynamicAssociations: { entrance: PageSkillEntrance; identity: SkillSourceIdentity }[] = [];
let resolveDynamic: (input: {
  entrance: PageSkillEntrance;
  source: PageSkillSource;
}) => Promise<SkillSourceIdentity | null> = async () => null;

registerPageSkillSourceOwner({
  kinds: ["object-detail", "home"],
  listAssociations: async () => dynamicAssociations,
  resolve: async ({ entrance, source }) => resolveDynamic({ entrance, source }),
});

let projection: PageSkillsProjection;
let grantedIds: string[];
let panelUsesHandler: (url: string) => Response;
let pageSkillsFetches = 0;

function queryFromSearch(params: Record<string, string>) {
  return assistantAgentsQuerySchema.parse(Object.fromEntries(new URLSearchParams(params)));
}

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  pageSkillsFetches = 0;
  offerings = [
    protectedOffering("panel-order", {
      entrances: [ordersEntrance],
      resourceIds: ["panel-order", "proj-order"],
    }),
    protectedOffering("panel-invoice", {
      entrances: [ordersEntrance],
      resourceIds: ["panel-invoice", "proj-invoice"],
    }),
  ];
  dynamicAssociations = [
    {
      entrance: dataBrowserEntrance,
      identity: { providerId: "product-panels", sourceKey: "panel-order" },
    },
    {
      entrance: dataBrowserEntrance,
      identity: { providerId: "product-panels", sourceKey: "panel-invoice" },
    },
  ];
  resolveDynamic = async ({ source }) => {
    if (source.kind === "object-detail" && source.object.className === "Order") {
      return { providerId: "product-panels", sourceKey: "panel-order" };
    }
    if (source.kind === "object-detail" && source.object.className === "Invoice") {
      return { providerId: "product-panels", sourceKey: "panel-invoice" };
    }
    return null;
  };
  projection = {
    pageSkills: [
      {
        ...dataBrowserEntrance,
        skill: publicDataBrowserSkill,
      },
      {
        ...ordersEntrance,
        defaults: [{ pageKey: "orders-page", defaultAgent: { kind: "id", id: agentIds.orderCustom } }],
      },
    ],
    registeredSkills: [publicDataBrowserSkill],
    admittedEntrances: [ordersEntrance],
  };
  grantedIds = ["panel-order", "proj-order", "panel-invoice", "proj-invoice"];
  panelUsesHandler = () => {
    const body: ApplicationPanelUsesResponse = {
      applicationId: "app-orders",
      entry: { path: "/applications/orders", renderer: "panels" },
      panelUses: [
        {
          id: "use-order",
          pageKey: "orders-page",
          panelId: "panel-order",
          path: "/applications/orders/list",

        },
      ],
    };
    return Response.json({ success: true, data: body });
  };

  mocks.findByUse.mockImplementation(async (_domain, { useId }) => offerings.find(offering =>
    offering.sourceKey === (useId === "ops-turn-evidence" ? "builtin-product-ops-turn-evidence" : "panel-order"),
  ) ?? null);
  mocks.listOfferings.mockImplementation(async () => { throw new Error("Candidate reads must not enumerate skills"); });
  mocks.query.mockImplementation(async (sql: string, params: [string[]] | [string, string[]]) => {
    if (sql.includes('"assistant_agents"')) return { rows: await mocks.agents() };
    const product = /"(builtin_)?product_(panels|projections)"/.exec(sql);
    if (!product) throw new Error(`Unexpected query: ${sql}`);
    const builtin = Boolean(product[1]);
    const panels = product[2] === "panels";
    const ids = params.length === 1 ? params[0] : params[1];
    return {
      rows: [...new Set(offerings.flatMap(offer => offer.resourceIds))]
        .filter(id => ids.includes(id) && panels === !id.startsWith("proj-"))
        .map(id => ({ id, domainId: builtin ? null : domain, ownerId: builtin ? null : "author" })),
    };
  });
  mocks.managementAccess.mockReset().mockResolvedValue(undefined);
  mocks.homePanelId.mockResolvedValue(null);
  mocks.agents.mockResolvedValue([
    agentRow(agentIds.regular, "regular", [], { sortOrder: 0 }),
    agentRow(agentIds.publicOnly, "custom-public", [publicDataBrowserSkill], { sortOrder: 1 }),
    agentRow(agentIds.orderCustom, agentIds.orderCustom, [panelOrderRef], { sortOrder: 2 }),
    agentRow(agentIds.legacyOrderCustom, "custom-legacy", [legacyOrderRef], { sortOrder: 3 }),
    agentRow(agentIds.invoiceCustom, "custom-invoice", [panelInvoiceRef], { sortOrder: 4 }),
    agentRow(agentIds.disabledOrder, "custom-disabled", [panelOrderRef], { enabled: false, sortOrder: 5 }),
    agentRow(agentIds.secondOrderCustom, "second-order-custom", [panelOrderRef], { sortOrder: 6 }),
  ]);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      if (url.endsWith("/authorization/objects/decide-batch")) {
        const { requests } = JSON.parse(String(init?.body)) as { requests: ObjectDecisionRequest[] };
        return Response.json({ decisions: requests.map(request => {
          if (!("target" in request)) throw new Error("Unexpected creation request");
          const { id, kind } = request.target;
          const allowed = kind === "AGENT"
            ? grantedIds.includes(id) || Object.values(agentIds).includes(id)
            : request.verb === "USE" && grantedIds.includes(id);
          return allowed ? { allowed: true } : { allowed: false, code: "FORBIDDEN", reason: "Denied" };
        }) });
      }
      if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: projection });
      if (url.includes("/platform/page-skills?")) {
        const params = new URL(url, "http://owner.test").searchParams;
        const entrance = [ordersEntrance, dataBrowserEntrance, observerEntrance, homeEntrance]
          .find(entry => entry.entryKey === params.get("entryKey"));
        expect(entrance).toBeDefined();
        const panelIds: Record<string, string> = {
          "use-order": "panel-order", "ops-turn-evidence": "builtin-product-ops-turn-evidence", home: "builtin-home",
        };
        expect(Object.fromEntries(params)).toEqual({
          ...entrance,
          ...(params.has("panelId") && { panelId: panelIds[entrance!.entryKey] }),
        });
        pageSkillsFetches += 1;
        return Response.json({ success: true, data: projection });
      }
      if (url.includes("/resolve-entry?")) {
        const response = panelUsesHandler(url);
        if (!response.ok) return response;
        const { data } = await response.json();
        const requested = new URL(url, "http://owner.test").searchParams.get("useId");
        const use = data.panelUses.find((entry: { id: string }) => entry.id === requested);
        if (!use) return Response.json({ error: { code: "NOT_FOUND", message: "Unknown use" } }, { status: 404 });
        return Response.json({ success: true, data: {
          applicationId: data.applicationId, use, menu: { singleEntry: true, groups: [], panelUses: [] },
        } });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sizeDirectory(agents: number, skills: number) {
  offerings = Array.from({ length: skills }, (_, i) => protectedOffering(`panel-fixture-${i}`, {
    entrances: [ordersEntrance], resourceIds: [`panel-fixture-${i}`, `proj-fixture-${i}`],
  }));
  const rows = Array.from({ length: agents }, (_, i) => {
    const id = i === 0 ? agentIds.regular : `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`;
    return agentRow(id, i === 0 ? "regular" : id, [protectedSkillRef("product-panels", domain, `panel-fixture-${i}`)]);
  });
  grantedIds = [...rows.map(row => row.id), ...offerings.flatMap(offer => offer.resourceIds)];
  mocks.agents.mockResolvedValue(rows);
  mocks.listOfferings.mockResolvedValue(offerings);
}

it.each([[2, 2, 1], [80, 220, 1], [220, 220, 2]])("lists %i ordinary agents without reading a domain skill catalogue of size %i (at most %i RPCs)", async (agents, skills, rpcBudget) => {
  sizeDirectory(agents, skills);

  const result = await listAssistantAgents(owner, credentials);

  expect(result.agents).toHaveLength(agents);
  expect(result.agents).toContainEqual(expect.objectContaining({ id: agentIds.regular, enabled: true }));
  expect(result).not.toHaveProperty("presetAgentIds");
  expect(mocks.query.mock.calls.length).toBeLessThanOrEqual(1);
  // Round 2 #2: ordinary candidates skip skill expansion, but agent authorization still spans batches.
  expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(rpcBudget);
  expect(mocks.listOfferings).not.toHaveBeenCalled();
});

it.each([25, 220, 450])("lists a fixed settings page in a single range read across %i agents and skills", async size => {
  sizeDirectory(size, size);
  const limit = 20;
  mocks.query.mockImplementationOnce(async (sql: string, params: unknown[]) => {
    expect(sql).not.toMatch(/system_prompt|execution_user_id|\bskills\b|SELECT \*/);
    return { rows: (await mocks.agents()).slice(0, Number(params.at(-1))) };
  });
  vi.mocked(fetch).mockImplementationOnce(async (url, request) => {
    expect(String(url)).toMatch(/\/authorization\/objects\/read-ranges$/);
    expect(JSON.parse(String(request?.body))).toEqual({ kind: "AGENT", verbs: ["VIEW"] });
    return Response.json({ ranges: { VIEW: { fixed: false, all: true, authorId: null, objectIds: [] } } });
  });

  const result = await listAgentDefinitions(owner, credentials, { limit });

  expect(result.agents).toHaveLength(limit);
  expect(result.agents[0]).not.toHaveProperty("skills");
  expect(result.nextCursor).not.toBeNull();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.listOfferings).not.toHaveBeenCalled();
});

it("returns only agents that carry the requested public skill", async () => {
  const result = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({ ...dataBrowserEntrance }),
  );

  expect(pageSkillsFetches).toBe(1);
  // Only agents whose effective skills include the public member are offered, never protected-only agents.
  expect(result.agents.map((agent) => agent.id)).toEqual([agentIds.regular, agentIds.publicOnly]);
  expect(result.defaultAgentId).toBe(agentIds.regular);

  // A dynamic-only group without a public skill rejects public queries instead of taking skills[0].
  await expect(
    listAssistantAgents(owner, credentials, queryFromSearch({ ...ordersEntrance })),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });
});

it("resolves application-use member queries through one view, filters by effective skills, and applies pageKey defaults", async () => {
  const source: PageSkillSource = { kind: "application-use", applicationId: "app-orders", useId: "use-order" };
  const result = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      ...ordersEntrance,
      member: JSON.stringify({ source: source, memberPath: [], ref: panelOrderRef }),
    }),
  );

  expect(pageSkillsFetches).toBe(1);
  // Regular (admitted member) and the direct protected ref match. An agent that chose the old aggregate ref no longer
  // carries the panel's skill: that selection is void and is chosen again under the panel's own ref. Public-only, sibling
  // protected and disabled agents are excluded.
  expect(result.agents.map((agent) => agent.id)).toEqual([
    agentIds.regular,
    agentIds.orderCustom,
    agentIds.secondOrderCustom,
  ]);
  expect(result.defaultAgentId).toBe(agentIds.orderCustom);
  expect(result.presetAgentIds).toEqual({ regular: agentIds.regular });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("panelId=panel-order"), expect.anything());
  expect(mocks.agents).toHaveBeenCalledTimes(1);

  // Without a matching pageKey default in the group, default falls back to regular.
  projection.pageSkills[1] = { ...ordersEntrance, defaults: [{ pageKey: "other-page", defaultAgent: { kind: "id", id: agentIds.orderCustom } }] };
  const fallbackDefault = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      ...ordersEntrance,
      member: JSON.stringify({ source: source, memberPath: [], ref: panelOrderRef }),
    }),
  );
  expect(fallbackDefault.defaultAgentId).toBe(agentIds.regular);
});

it("uses the registered home root in Java and admits the member of the user's actual home panel", async () => {
  const source = { kind: "application-use", applicationId: "home", useId: "home" };
  mocks.homePanelId.mockResolvedValue("panel-order");
  mocks.findByUse.mockResolvedValue(protectedOffering("panel-order", {
    entrances: [homeEntrance], resourceIds: ["panel-order", "proj-order"],
  }));
  panelUsesHandler = () => Response.json({ success: true, data: {
    applicationId: "home", panelUses: [{ id: "home", pageKey: "home", panelId: "builtin-home", path: "/home" }],
  } });
  projection = { pageSkills: [homeEntrance], admittedEntrances: [homeEntrance], registeredSkills: [] };
  const result = await listAssistantAgents(owner, credentials, queryFromSearch({
    ...homeEntrance, member: JSON.stringify({ source, memberPath: [], ref: panelOrderRef }),
  }));
  expect(result.agents).toContainEqual(expect.objectContaining({ id: agentIds.orderCustom }));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("panelId=builtin-home"), expect.anything());
});

it("resolves dynamic-owner member queries on a shared entry to the exact protected member", async () => {
  const orderSource: PageSkillSource = {
    kind: "object-detail",
    useId: "use-detail",
    object: { className: "Order", primaryKey: "ord-1" },
  };
  const orderResult = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      ...dataBrowserEntrance,
      member: JSON.stringify({ source: orderSource, memberPath: [], ref: panelOrderRef }),
    }),
  );

  expect(pageSkillsFetches).toBe(1);
  expect(orderResult.agents.map((agent) => agent.id)).toEqual([
    agentIds.regular,
    agentIds.orderCustom,
    agentIds.secondOrderCustom,
  ]);
  expect(orderResult.defaultAgentId).toBe(agentIds.regular);

  const invoiceSource: PageSkillSource = {
    kind: "object-detail",
    useId: "use-detail",
    object: { className: "Invoice", primaryKey: "inv-1" },
  };
  const invoiceResult = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      ...dataBrowserEntrance,
      member: JSON.stringify({ source: invoiceSource, memberPath: [], ref: panelInvoiceRef }),
    }),
  );
  expect(invoiceResult.agents.map((agent) => agent.id)).toEqual([agentIds.regular, agentIds.invoiceCustom]);
});

it("rejects member queries with 403 and never falls back to the group's public member when resolution returns null", async () => {
  const detailSource: PageSkillSource = {
    kind: "object-detail",
    useId: "use-detail",
    object: { className: "Order", primaryKey: "ord-1" },
  };

  // Mismatched memberKey (sibling member's key) on a group that HAS a public skill.
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...dataBrowserEntrance,
        member: JSON.stringify({ source: detailSource, memberPath: [], ref: panelInvoiceRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Owner returns null (e.g. source no longer maps to a protected panel).
  resolveDynamic = async () => null;
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...dataBrowserEntrance,
        member: JSON.stringify({ source: detailSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Application-use retargeted to a different panelId.
  const appSource: PageSkillSource = { kind: "application-use", applicationId: "app-orders", useId: "use-order" };
  panelUsesHandler = () =>
    Response.json({
      success: true,
      data: {
        applicationId: "app-orders",
        entry: { path: "/applications/orders", renderer: "panels" },
        panelUses: [
          {
            id: "use-order",
            pageKey: "orders-page",
            panelId: "panel-invoice",
            path: "/applications/orders/list",

          },
        ],
      },
    });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...ordersEntrance,
        member: JSON.stringify({ source: appSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // An admitted sibling shares the pageKey and panel but does not authorize this use.
  const siblingEntrance = { ...ordersEntrance, entryKey: "sibling-use" };
  projection.admittedEntrances = [siblingEntrance];
  projection.pageSkills.push(siblingEntrance);
  offerings[0] = { ...offerings[0]!, entrances: [ordersEntrance, siblingEntrance] };
  panelUsesHandler = () =>
    Response.json({
      success: true,
      data: {
        applicationId: "app-orders",
        entry: { path: "/applications/orders", renderer: "panels" },
        panelUses: [
          {
            id: "use-order",
            pageKey: "orders-page",
            panelId: "panel-order",
            path: "/applications/orders/list",

          },
        ],
      },
    });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...ordersEntrance,
        member: JSON.stringify({ source: appSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Missing dependency "use" grant on proj-order.
  projection.admittedEntrances = [ordersEntrance];
  grantedIds = ["panel-order"];
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...ordersEntrance,
        member: JSON.stringify({ source: appSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Java rejects entry resolution with 403.
  grantedIds = ["panel-order", "proj-order"];
  panelUsesHandler = () => new Response("forbidden", { status: 403 });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...ordersEntrance,
        member: JSON.stringify({ source: appSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });
});

it("propagates source resolution errors instead of treating them as null", async () => {
  const appSource: PageSkillSource = { kind: "application-use", applicationId: "app-orders", useId: "use-order" };
  panelUsesHandler = () => new Response("upstream failure", { status: 500 });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...ordersEntrance,
        member: JSON.stringify({ source: appSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toMatchObject({ status: 500 });

  const detailSource: PageSkillSource = {
    kind: "object-detail",
    useId: "use-detail",
    object: { className: "Order", primaryKey: "ord-1" },
  };
  resolveDynamic = async () => {
    throw new Error("source owner unavailable");
  };
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        ...dataBrowserEntrance,
        member: JSON.stringify({ source: detailSource, memberPath: [], ref: panelOrderRef }),
      }),
    ),
  ).rejects.toThrow("source owner unavailable");
});

it("uses only agent authorization for ops-diagnosis in chat and still verifies the page entrance", async () => {
  const { HttpError } = await import("../../../utils/errors");
  const opsId = "88888888-8888-4888-8888-888888888888";
  const builderId = "99999999-9999-4999-8999-999999999999";
  const opsTurnRef = protectedSkillRef("product-panels", domain, "builtin-product-ops-turn-evidence");

  mocks.agents.mockResolvedValue([
    agentRow(agentIds.regular, "regular", [], { sortOrder: 0 }),
    agentRow(builderId, "app-builder", [], { sortOrder: 2 }),
    agentRow(opsId, "ops-diagnosis", [], { sortOrder: 3 }),
  ]);
  offerings = [
    ...offerings,
    protectedOffering("builtin-product-ops-turn-evidence", {
      entrances: [observerEntrance],
      resourceIds: ["builtin-product-ops-turn-evidence"],
    }),
  ];
  projection = {
    pageSkills: [
      ...projection.pageSkills,
      {
        ...observerEntrance,
        defaults: [{ pageKey: "ops-turn-evidence", defaultAgent: { kind: "preset", agentKind: "ops-diagnosis" } }],
      },
    ],
    registeredSkills: [publicDataBrowserSkill],
    admittedEntrances: [ordersEntrance, observerEntrance],
  };
  panelUsesHandler = () =>
    Response.json({
      success: true,
      data: {
        applicationId: "operations",
        entry: { path: "/ops", renderer: "operations" },
        panelUses: [
          {
            id: "ops-turn-evidence",
            pageKey: "ops-turn-evidence",
            panelId: "builtin-product-ops-turn-evidence",
            path: "/ops/turn",

            defaultAgent: { kind: "preset", agentKind: "ops-diagnosis" },
          },
        ],
      },
    });
  grantedIds = [...grantedIds, "builtin-product-ops-turn-evidence", opsId, builderId];

  // Both authorized system agents appear in the chat directory.
  const unfiltered = await listAssistantAgents(owner, credentials);
  expect(unfiltered.agents.map((a) => a.id)).toEqual([agentIds.regular, builderId, opsId]);
  expect(unfiltered.agents.find((a) => a.id === opsId)).toMatchObject({ kind: "ops-diagnosis" });

  // Observer page: ops-diagnosis is selected as defaultAgentId and exposed in presetAgentIds["ops-diagnosis"].
  const opsSource: PageSkillSource = { kind: "application-use", applicationId: "operations", useId: "ops-turn-evidence" };
  const opsPage = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      ...observerEntrance,
      member: JSON.stringify({ source: opsSource, memberPath: [], ref: opsTurnRef }),
    }),
  );
  // The page registers the diagnosis agent, so the assistant is not a candidate here.
  expect(opsPage.agents.map((a) => a.id)).toEqual([opsId]);
  expect(opsPage.defaultAgentId).toBe(opsId);
  expect(opsPage.presetAgentIds).toEqual({ "ops-diagnosis": opsId });

  // The data browser does not offer the diagnosis agent.
  const nonOpsPage = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({ ...dataBrowserEntrance }),
  );
  expect(nonOpsPage.agents.map((a) => a.id)).toEqual([agentIds.regular]);
  expect(nonOpsPage.presetAgentIds).toEqual({ regular: agentIds.regular });

  // Diagnosis candidate selection depends on entry admission and agent use.
  mocks.managementAccess.mockRejectedValue(new HttpError(403, "Management denied", "FORBIDDEN"));
  expect((await listAssistantAgents(owner, credentials)).agents.map((a) => a.id)).toEqual([agentIds.regular, builderId, opsId]);
  const diagnosisPage = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      ...observerEntrance,
      member: JSON.stringify({ source: opsSource, memberPath: [], ref: opsTurnRef }),
    }),
  );
  expect(diagnosisPage.agents.map((a) => a.id)).toEqual([opsId]);
  expect(diagnosisPage.presetAgentIds).toEqual({ "ops-diagnosis": opsId });
  expect(mocks.managementAccess).not.toHaveBeenCalled();

  // Revoking USE removes diagnosis from the directory.
  grantedIds = grantedIds.filter((id) => id !== opsId);
  expect((await listAssistantAgents(owner, credentials)).agents.map((a) => a.id)).toEqual([agentIds.regular, builderId]);
});
