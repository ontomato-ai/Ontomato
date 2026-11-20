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
  native: vi.fn<[string, string], Promise<string | undefined>>(),
  profile: vi.fn<[unknown, string], Promise<string | null>>(),
}));

vi.mock("../store", () => ({ assistantStore: { agents: mocks.agents } }));
vi.mock("../../product-assets/platform-assets", () => ({ nativeProfileId: mocks.native }));
vi.mock("../../product-assets/agent-profile", () => ({ profileIdForAgent: mocks.profile }));
vi.mock("../../product-assets/grants", () => ({
  withProductGrants: (_owner: unknown, action: () => unknown) => action(),
}));

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

const panelOrderRef = protectedSkillRef("product-panels", domain, "panel-order", "analysis-agent");
const panelInvoiceRef = protectedSkillRef("product-panels", domain, "panel-invoice", "analysis-agent");

const menuEntrance: PageSkillEntrance = { permissionCode: "orders-menu", pageKey: "orders-page" };
const dataBrowserEntrance: PageSkillEntrance = { access: "domain-member", pageKey: "data-browser" };

const agentIds = {
  regular: "11111111-1111-4111-8111-111111111111",
  publicOnly: "22222222-2222-4222-8222-222222222222",
  orderCustom: "33333333-3333-4333-8333-333333333333",
  legacyOrderCustom: "44444444-4444-4444-8444-444444444444",
  invoiceCustom: "55555555-5555-4555-8555-555555555555",
  disabledOrder: "66666666-6666-4666-8666-666666666666",
  productProfile: "77777777-7777-4777-8777-777777777777",
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
    execution_user_id: null,
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
    legacyAggregateRefs?: readonly RuntimeSkillRef[];
  },
): ProtectedSkillOffering {
  return {
    kind: "protected",
    sourceKey,
    scopeKey: "analysis-agent",
    entrances: options.entrances,
    resourceIds: options.resourceIds,
    legacyAggregateRefs: options.legacyAggregateRefs,
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
  list: async () => offerings,
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
      entrances: [menuEntrance],
      resourceIds: ["panel-order", "proj-order"],
      legacyAggregateRefs: [legacyOrderRef],
    }),
    protectedOffering("panel-invoice", {
      entrances: [menuEntrance],
      resourceIds: ["panel-invoice", "proj-invoice"],
    }),
  ];
  dynamicAssociations = [
    {
      entrance: dataBrowserEntrance,
      identity: { providerId: "product-panels", sourceKey: "panel-order", scopeKey: "analysis-agent" },
    },
    {
      entrance: dataBrowserEntrance,
      identity: { providerId: "product-panels", sourceKey: "panel-invoice", scopeKey: "analysis-agent" },
    },
  ];
  resolveDynamic = async ({ source }) => {
    if (source.kind === "object-detail" && source.object.className === "Order") {
      return { providerId: "product-panels", sourceKey: "panel-order", scopeKey: "analysis-agent" };
    }
    if (source.kind === "object-detail" && source.object.className === "Invoice") {
      return { providerId: "product-panels", sourceKey: "panel-invoice", scopeKey: "analysis-agent" };
    }
    return null;
  };
  projection = {
    pageSkills: [
      {
        access: "domain-member",
        pageKey: "data-browser",
        skill: publicDataBrowserSkill,
      },
      {
        permissionCode: "orders-menu",
        defaults: [{ pageKey: "orders-page", defaultAgent: { kind: "id", id: agentIds.orderCustom } }],
      },
    ],
    registeredSkills: [publicDataBrowserSkill],
    admittedEntrances: [menuEntrance],
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
          access: { permissionCode: "orders-menu" },
        },
      ],
    };
    return Response.json({ success: true, data: body });
  };

  mocks.native.mockResolvedValue(undefined);
  mocks.profile.mockImplementation(async (_owner, id) => (id === agentIds.productProfile ? "profile-1" : null));
  mocks.agents.mockResolvedValue([
    agentRow(agentIds.regular, "regular", [], { sortOrder: 0 }),
    agentRow(agentIds.publicOnly, "custom-public", [publicDataBrowserSkill], { sortOrder: 1 }),
    agentRow(agentIds.orderCustom, "custom-order", [panelOrderRef], { sortOrder: 2 }),
    agentRow(agentIds.legacyOrderCustom, "custom-legacy", [legacyOrderRef], { sortOrder: 3 }),
    agentRow(agentIds.invoiceCustom, "custom-invoice", [panelInvoiceRef], { sortOrder: 4 }),
    agentRow(agentIds.disabledOrder, "custom-disabled", [panelOrderRef], { enabled: false, sortOrder: 5 }),
    agentRow(agentIds.productProfile, "custom-profile", [panelOrderRef], { sortOrder: 6 }),
  ]);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/platform/page-skills")) {
        pageSkillsFetches += 1;
        return Response.json({ success: true, data: projection });
      }
      if (url.endsWith("/product-governance/resources")) {
        return Response.json({ ids: grantedIds });
      }
      if (url.includes("/panel-uses")) {
        return panelUsesHandler(url);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("resolves public queries through view.publicPageSkill even when a group also holds protected members", async () => {
  const result = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({ pageKey: "data-browser", access: "domain-member" }),
  );

  expect(pageSkillsFetches).toBe(1);
  // Only agents whose effective skills include the public member are offered, never protected-only agents.
  expect(result.agents.map((agent) => agent.id)).toEqual([agentIds.regular, agentIds.publicOnly]);
  expect(result.defaultAgentId).toBe(agentIds.regular);

  // A dynamic-only group without a public skill rejects public queries instead of taking skills[0].
  await expect(
    listAssistantAgents(owner, credentials, queryFromSearch({ pageKey: "orders-page", permissionCode: "orders-menu" })),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });
});

it("resolves application-use member queries through one view, filters by effective skills, and applies pageKey defaults", async () => {
  const source: PageSkillSource = { kind: "application-use", applicationId: "app-orders", useId: "use-order" };
  const result = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      pageKey: "orders-page",
      permissionCode: "orders-menu",
      source: JSON.stringify(source),
      memberKey: panelOrderRef.name,
    }),
  );

  expect(pageSkillsFetches).toBe(1);
  // Regular (admitted member), direct protected ref, and expanded legacy ref match;
  // public-only, sibling protected, disabled, and product-profile agents are excluded.
  expect(result.agents.map((agent) => agent.id)).toEqual([
    agentIds.regular,
    agentIds.orderCustom,
    agentIds.legacyOrderCustom,
  ]);
  expect(result.defaultAgentId).toBe(agentIds.orderCustom);

  // Without a matching pageKey default in the group, default falls back to regular.
  projection.pageSkills[1] = { permissionCode: "orders-menu", defaults: [{ pageKey: "other-page", defaultAgent: { kind: "id", id: agentIds.orderCustom } }] };
  const fallbackDefault = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      pageKey: "orders-page",
      permissionCode: "orders-menu",
      source: JSON.stringify(source),
      memberKey: panelOrderRef.name,
    }),
  );
  expect(fallbackDefault.defaultAgentId).toBe(agentIds.regular);
});

it("resolves dynamic-owner member queries on a multi-member group to the exact protected member", async () => {
  const orderSource: PageSkillSource = {
    kind: "object-detail",
    useId: "use-detail",
    object: { className: "Order", primaryKey: "ord-1" },
  };
  const orderResult = await listAssistantAgents(
    owner,
    credentials,
    queryFromSearch({
      pageKey: "data-browser",
      access: "domain-member",
      source: JSON.stringify(orderSource),
      memberKey: panelOrderRef.name,
    }),
  );

  expect(pageSkillsFetches).toBe(1);
  expect(orderResult.agents.map((agent) => agent.id)).toEqual([
    agentIds.regular,
    agentIds.orderCustom,
    agentIds.legacyOrderCustom,
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
      pageKey: "data-browser",
      access: "domain-member",
      source: JSON.stringify(invoiceSource),
      memberKey: panelInvoiceRef.name,
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
        pageKey: "data-browser",
        access: "domain-member",
        source: JSON.stringify(detailSource),
        memberKey: panelInvoiceRef.name,
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
        pageKey: "data-browser",
        access: "domain-member",
        source: JSON.stringify(detailSource),
        memberKey: panelOrderRef.name,
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
            access: { permissionCode: "orders-menu" },
          },
        ],
      },
    });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        pageKey: "orders-page",
        permissionCode: "orders-menu",
        source: JSON.stringify(appSource),
        memberKey: panelOrderRef.name,
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Sibling entrance only in admittedEntrances (exact entrance not admitted).
  projection.admittedEntrances = [{ permissionCode: "orders-menu", pageKey: "sibling-page" }];
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
            access: { permissionCode: "orders-menu" },
          },
        ],
      },
    });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        pageKey: "orders-page",
        permissionCode: "orders-menu",
        source: JSON.stringify(appSource),
        memberKey: panelOrderRef.name,
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Missing dependency "use" grant on proj-order.
  projection.admittedEntrances = [menuEntrance];
  grantedIds = ["panel-order"];
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        pageKey: "orders-page",
        permissionCode: "orders-menu",
        source: JSON.stringify(appSource),
        memberKey: panelOrderRef.name,
      }),
    ),
  ).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });

  // Java rejects /panel-uses with 403.
  grantedIds = ["panel-order", "proj-order"];
  panelUsesHandler = () => new Response("forbidden", { status: 403 });
  await expect(
    listAssistantAgents(
      owner,
      credentials,
      queryFromSearch({
        pageKey: "orders-page",
        permissionCode: "orders-menu",
        source: JSON.stringify(appSource),
        memberKey: panelOrderRef.name,
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
        pageKey: "orders-page",
        permissionCode: "orders-menu",
        source: JSON.stringify(appSource),
        memberKey: panelOrderRef.name,
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
        pageKey: "data-browser",
        access: "domain-member",
        source: JSON.stringify(detailSource),
        memberKey: panelOrderRef.name,
      }),
    ),
  ).rejects.toThrow("source owner unavailable");
});
