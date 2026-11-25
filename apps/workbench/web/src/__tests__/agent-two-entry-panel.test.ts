import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, onBeforeUnmount } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { DELETE_AGENT, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ApplicationPanelUse, ProductProjection } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.html?raw";
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.json";
import catalogModule from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.mjs?raw";
import catalogRecipes from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/recipes.md?raw";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-detail/panel.html?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-detail/panel.json";
import detailModule from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-detail/panel.mjs?raw";
import detailRecipes from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-detail/recipes.md?raw";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, type Sent } from "./panel-frame";

const AGENT_DEFINITION = "platform:AgentDefinition";
const CAPABILITY_MAP_PATH = "/ontology/assets/capability-map";

const CUSTOM_ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const PRESET_ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a02";
const SYSTEM_ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a03";
const CREATED_ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a04";
const MISSING_ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a99";

const typeTable = {
  objectTypes: Object.fromEntries(
    Object.entries(platformObjectTypes).map(([id, entry]) => [
      id,
      platformTypeTableEntrySchema.parse({
        ...entry,
        operations: id === AGENT_DEFINITION
          ? [
              {
                id: `${AGENT_DEFINITION}.save`,
                kind: "form.save",
                effect: "write",
                batch: false,
                inputSchema: { type: "object" },
                target: { source: "draft" },
              },
              {
                id: DELETE_AGENT,
                kind: "action",
                effect: "write",
                batch: false,
                inputSchema: { type: "object" },
                target: { source: "input", input: "agent" },
              },
              {
                id: "agents.grant",
                kind: "action",
                effect: "write",
                batch: false,
                inputSchema: { type: "object" },
                target: { source: "input", input: "agent" },
              },
              {
                id: "agents.revoke",
                kind: "action",
                effect: "write",
                batch: false,
                inputSchema: { type: "object" },
                target: { source: "input", input: "agent" },
              },
              {
                id: "agents.share",
                kind: "action",
                effect: "write",
                batch: false,
                inputSchema: { type: "object" },
                target: { source: "input", input: "agent" },
              },
            ]
          : [],
      }),
    ]),
  ),
};

const builtinCatalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function compilePanel(
  panelId: string,
  name: string,
  source: { manifest: unknown; content: { messages: Record<string, Record<string, string>> } },
  html: string,
  module: string,
) {
  const authoring = panelAuthoringManifestSchema.parse(source.manifest);
  const projections = new Map<string, ProductProjection>();
  const members = Object.fromEntries(
    Object.entries(authoring.members).map(([memberName, entry]) => {
      if (!("component" in entry)) throw new Error(`Expected authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, entry, {
        state: authoring.state,
        typeTable,
        components: builtinCatalogue,
      });
      projections.set(entry.id!, {
        ...projection,
        id: entry.id!,
        name: memberName,
        description: memberName,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      });
      return [memberName, { ...placement, target: { projectionId: entry.id! } }];
    }),
  );
  const panel = {
    ...panelRecord(panelId, name, definePanel({ state: authoring.state, members })),
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
    content: { html, module, messages: source.content.messages },
  };
  return { panel, projections };
}

const compiledCatalog = compilePanel(
  "builtin-product-agent-settings",
  "Agents",
  catalogSource,
  catalogHtml,
  catalogModule,
);
const compiledDetail = compilePanel(
  "builtin-product-agent-detail",
  "Agent",
  detailSource,
  detailHtml,
  detailModule,
);
const allProjections = new Map<string, ProductProjection>([
  ...compiledCatalog.projections,
  ...compiledDetail.projections,
]);
const allPanels = new Map([
  [compiledCatalog.panel.id, compiledCatalog.panel],
  [compiledDetail.panel.id, compiledDetail.panel],
]);

type Category = "custom" | "preset" | "system";
const categoryLabel: Record<Category, string> = {
  custom: "Custom",
  preset: "Preset",
  system: "System",
};

interface MockAgent {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: Category;
  systemPrompt?: string;
  canEdit?: boolean;
  canGrant?: boolean;
  domainShared?: boolean;
}

interface MockGrantRow {
  principalKind: "principal" | "role" | "domain";
  principalId: string;
  principalName: string;
  level: "use" | "view" | "edit";
}

const DEFAULT_AGENTS: MockAgent[] = [
  { id: CUSTOM_ID, name: "Sales Analyst", description: "Analyzes sales orders", enabled: true, category: "custom", systemPrompt: "Be concise" },
  { id: PRESET_ID, name: "Ontology Assistant", description: "Product built-in assistant", enabled: true, category: "preset", systemPrompt: "Help model ontology" },
  { id: SYSTEM_ID, name: "Operations Diagnosis", description: "Diagnoses runtime failures", enabled: true, category: "system", domainShared: true },
];

function agentRecord(agent: MockAgent) {
  const canEdit = agent.canEdit ?? true;
  const canGrant = agent.canGrant ?? canEdit;
  const domainShared = canEdit ? (agent.domainShared ?? false) : undefined;
  return {
    primaryKey: agent.id,
    label: agent.name,
    fields: {
      name: agent.name,
      description: agent.description,
      icon: "",
      agentTitle: [agent.name, ""],
      enabled: agent.enabled ? "Enabled" : "Disabled",
      category: categoryLabel[agent.category],
      ...(domainShared !== undefined && { domainShared }),
    },
    outputs: {
      category: agent.category,
      canEdit,
      canGrant,
      ...(domainShared !== undefined && { domainShared }),
    },
    tones: { enabled: agent.enabled ? "success" : "default" },
  };
}

const grantLevelLabel: Record<MockGrantRow["level"], string> = {
  use: "Use",
  view: "View",
  edit: "Edit",
};

function toGrantPanelRecord(grant: MockGrantRow) {
  const isDomain = grant.principalKind === "domain";
  const principalKindLabel = isDomain ? "Domain" : grant.principalKind === "role" ? "Role" : "Member";
  const levelLabel = grantLevelLabel[grant.level];
  const tone = grant.level === "edit" ? "warning" : grant.level === "view" ? "info" : "default";
  return {
    primaryKey: `${grant.principalKind}:${grant.principalId}`,
    className: AGENT_DEFINITION,
    label: isDomain ? principalKindLabel : grant.principalName,
    ...(!isDomain && grant.principalName !== grant.principalId && { subtitle: grant.principalId }),
    fields: {
      principalKind: grant.principalKind,
      principalKindLabel,
      principalId: grant.principalId,
      level: grant.level,
      levelLabel,
      verb: grant.level,
      verbLabel: levelLabel,
      revocable: !isDomain,
    },
    tones: {
      principalKindLabel: isDomain ? "success" : "info",
      levelLabel: tone,
      verbLabel: tone,
    },
  };
}

const field = (path: string, label: string, control: PanelFormDescription["fields"][number]["control"], more = {}) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });

const fullFields: PanelFormDescription["fields"] = [
  field("/name", "Name", { kind: "text" }, { required: true, section: "basics" }),
  field("/description", "Description", { kind: "text", multiline: true }, { section: "basics" }),
  field("/enabled", "Enabled", { kind: "switch" }, { section: "basics" }),
  field("/modelSelection/modelId", "Model", { kind: "reference", objectType: "platform:ModelOption", multiple: false }, { section: "model" }),
  field("/systemPrompt", "Instructions", { kind: "markdown" }, { section: "prompt" }),
  field("/skills", "Skills", { kind: "reference", objectType: "platform:Skill", multiple: true }, { section: "capabilities" }),
  field("/enabledMcpServiceIds", "MCP services", { kind: "reference", objectType: "platform:ExternalMcpService", multiple: true }, { section: "capabilities" }),
  field("/executionUserId", "Runs as", { kind: "reference", objectType: "platform:User", multiple: false }, { section: "execution" }),
  field("/classNames", "Data scope", { kind: "reference", objectType: "platform:ObjectType", multiple: true, relatedObjectTypes: ["platform:Relationship"] }, { section: "data" }),
];

const fullSections: PanelFormDescription["sections"] = [
  { key: "basics", title: "Basics" },
  { key: "model", title: "Model" },
  { key: "prompt", title: "Instructions" },
  { key: "capabilities", title: "Capabilities" },
  { key: "execution", title: "Execution" },
  { key: "data", title: "Data scope" },
];

const systemFields: PanelFormDescription["fields"] = [
  field("/name", "Name", { kind: "text" }, { readOnly: true, section: "basics" }),
  field("/description", "Description", { kind: "text", multiline: true }, { readOnly: true, section: "basics" }),
  field("/modelSelection/modelId", "Model", { kind: "reference", objectType: "platform:ModelOption", multiple: false }, { section: "model" }),
];

const systemSections: PanelFormDescription["sections"] = [
  { key: "basics", title: "Basics" },
  { key: "model", title: "Model" },
];

const defaultValues: PanelFormValues = {
  name: "",
  description: "",
  enabled: true,
  systemPrompt: "",
  modelSelection: { modelId: null },
  skills: [],
  enabledMcpServiceIds: [],
  executionUserId: null,
  classNames: [],
};

function formDescriptionFor(agent: MockAgent | null): PanelFormDescription {
  if (!agent) {
    return {
      sections: fullSections,
      fields: fullFields,
      values: defaultValues,
      errors: [],
      save: { method: "POST", path: "/assistant/agent-definitions", bodySchema: {} },
    };
  }
  if (agent.category === "system") {
    const canEdit = agent.canEdit ?? true;
    return {
      sections: systemSections,
      fields: systemFields.map((entry) => (!canEdit ? { ...entry, readOnly: true } : entry)),
      values: { name: agent.name, description: agent.description, modelSelection: { modelId: "openai/gpt-4o" } },
      errors: [],
      save: { method: "PUT", path: `/assistant/agent-definitions/${agent.id}`, bodySchema: {} },
    };
  }
  const canEdit = agent.canEdit ?? true;
  return {
    sections: fullSections,
    fields: fullFields.map((entry) => (!canEdit ? { ...entry, readOnly: true } : entry)),
    values: {
      ...defaultValues,
      name: agent.name,
      description: agent.description,
      enabled: agent.enabled,
      systemPrompt: agent.systemPrompt ?? "",
      modelSelection: { modelId: "openai/gpt-4o" },
      classNames: ["Order"],
    },
    errors: [],
    save: { method: "PUT", path: `/assistant/agent-definitions/${agent.id}`, bodySchema: {} },
  };
}

function appUses(appId: "ontology" | "agents"): {
  catalogUse: ApplicationPanelUse;
  detailUse: ApplicationPanelUse;
  extraUses: ApplicationPanelUse[];
} {
  if (appId === "agents") {
    return {
      catalogUse: {
        ...panelUse("agents-agent-settings", "agents-agent-settings", compiledCatalog.panel.id, "/agents/settings"),
        inputs: { detailPath: { literal: "/agents/settings/detail" } },
      },
      detailUse: {
        ...panelUse("agents-agent-detail", "agents-agent-detail", compiledDetail.panel.id, "/agents/settings/detail"),
        inputs: { catalogPath: { literal: "/agents/settings" } },
      },
      extraUses: [],
    };
  }
  return {
    catalogUse: {
      ...panelUse("ontology-agent-settings", "agent-settings", compiledCatalog.panel.id, "/ontology/agents"),
      inputs: { detailPath: { literal: "/ontology/agents/detail" } },
    },
    detailUse: {
      ...panelUse("ontology-agent-detail", "agent-detail", compiledDetail.panel.id, "/ontology/agents/detail"),
      inputs: { catalogPath: { literal: "/ontology/agents" } },
    },
    extraUses: [
      panelUse("ontology-capability-map", "capability-map", "builtin-product-capability-map", CAPABILITY_MAP_PATH),
    ],
  };
}

function mountTwoEntryApp(options: {
  appId?: "ontology" | "agents";
  initialPath?: string;
  agents?: MockAgent[];
  grantsByAgent?: Record<string, MockGrantRow[]>;
  listForbidden?: boolean;
  askUnsaved?: () => Promise<boolean>;
  recordResponse?: (primaryKey: string) => Response | null;
  onCreated?: (values: Record<string, unknown>) => void;
  onDeleted?: (primaryKey: string) => void;
  onGrant?: (targetId: string, input: Record<string, unknown>) => void;
  onRevoke?: (targetId: string, input: Record<string, unknown>) => void;
  onShare?: (targetId: string, shared: boolean) => void;
} = {}) {
  const appId = options.appId ?? "ontology";
  const { catalogUse, detailUse, extraUses } = appUses(appId);
  const uses = [catalogUse, detailUse, ...extraUses];
  const agentList = (options.agents ?? DEFAULT_AGENTS).map((item) => ({ ...item }));
  const initialGrants: Record<string, MockGrantRow[]> = options.grantsByAgent ?? {
    [CUSTOM_ID]: [{ principalKind: "principal", principalId: "user-owner", principalName: "Alice", level: "edit" }],
    [SYSTEM_ID]: [
      { principalKind: "domain", principalId: "*", principalName: "Domain", level: "use" },
      { principalKind: "role", principalId: "role-admin", principalName: "Domain Admin", level: "edit" },
    ],
  };
  const grantsByAgent = new Map<string, MockGrantRow[]>(
    Object.entries(initialGrants).map(([id, rows]) => [id, rows.map((row) => ({ ...row }))]),
  );
  const userOptions = [
    { primaryKey: "user-alice", value: "user-alice", label: "Alice" },
    { primaryKey: "user-bob", value: "user-bob", label: "Bob" },
  ];
  const roleOptions = [
    { primaryKey: "role-admin", value: "role-admin", label: "Domain Admin" },
    { primaryKey: "role-analyst", value: "role-analyst", label: "Analyst" },
  ];

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: catalogUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
      { path: detailUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
      { path: CAPABILITY_MAP_PATH, component: { render: () => h("div", { class: "capability-map-target" }, "Capability Map") } },
    ],
  });

  const reads: ProductPanelReadRequest[] = [];
  const intents = new Map<string, { operationId: string; targetId?: string; input?: Record<string, unknown> }>();
  let intentSeq = 0;

  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: appId === "agents" ? "/agents" : "/ontology", renderer: "panels" },
          panelUses: uses,
        },
      });
    }
    const panelMatch = /^\/api\/product-panels\/([^/]+)$/.exec(path);
    if (panelMatch && allPanels.has(panelMatch[1]!)) {
      return panelAnswer(allPanels.get(panelMatch[1]!)!, request);
    }
    const snapMatch = /^\/api\/product-panels\/([^/]+)\/snapshot$/.exec(path);
    if (snapMatch && allPanels.has(snapMatch[1]!)) {
      return panelSnapshot(allPanels.get(snapMatch[1]!)!, Object.fromEntries(allProjections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: allProjections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      reads.push(body);
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        const targetRef = (body.inputs.agent ?? body.inputs.target) as { primaryKey?: string } | undefined;
        if (member === "createForm") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: `${AGENT_DEFINITION}.save`,
                label: "Save agent",
                effect: "write",
                target: { source: "draft", slot: "createForm" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "form") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: `${AGENT_DEFINITION}.save`,
                label: "Save agent",
                effect: "write",
                target: { source: "input", input: "agent" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "remove") {
          if (!targetRef?.primaryKey) return Response.json({ status: "ready", value: {} });
          const found = agentList.find((item) => item.id === targetRef.primaryKey);
          const unavailable = found?.canEdit === false
            ? { reason: "You do not have permission to edit this agent." }
            : found?.category === "system"
              ? { reason: "Built-in system agents cannot be deleted." }
              : found?.category === "preset"
                ? { reason: "Built-in agents come with the product and cannot be deleted" }
                : undefined;
          return Response.json({
            status: "ready",
            value: {
              delete: {
                kind: "action",
                handlerRef: DELETE_AGENT,
                label: "Delete agent",
                effect: "write",
                target: { source: "input", input: "agent" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
                ...(unavailable ? { unavailable } : {}),
              },
            },
          });
        }
        if (member === "grantsList") {
          return Response.json({
            status: "ready",
            value: {
              revoke: {
                kind: "action",
                handlerRef: "agents.revoke",
                label: "Revoke",
                effect: "write",
                target: { source: "input", input: "agent" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "shareEnable" || member === "shareDisable") {
          return Response.json({
            status: "ready",
            value: {
              share: {
                kind: "action",
                handlerRef: "agents.share",
                label: member === "shareEnable" ? "Enable domain-wide use" : "Disable domain-wide use",
                effect: "write",
                target: { source: "input", input: "agent" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "grantSubmit") {
          return Response.json({
            status: "ready",
            value: {
              grant: {
                kind: "action",
                handlerRef: "agents.grant",
                label: "Grant",
                effect: "write",
                target: { source: "input", input: "agent" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      if (member === "list") {
        if (options.listForbidden) return Response.json({ status: "forbidden" });
        return Response.json({ status: "ready", value: agentList.map(agentRecord) });
      }
      if (member === "header" || member === "shareStatusDesc") {
        const target = (body.inputs.agent ?? body.inputs.target) as { primaryKey?: string } | undefined;
        const id = target?.primaryKey ?? "";
        const override = member === "header" ? options.recordResponse?.(id) : null;
        if (override) return override;
        const found = agentList.find((item) => item.id === id);
        if (!found) return Response.json({ status: "error", message: "Agent definition not found" });
        return Response.json({ status: "ready", value: agentRecord(found) });
      }
      if (member === "grantsList") {
        const target = (body.inputs.agent ?? body.inputs.target) as { primaryKey?: string } | undefined;
        const id = target?.primaryKey ?? "";
        const found = agentList.find((item) => item.id === id);
        if (found?.canEdit === false) return Response.json({ status: "forbidden" });
        return Response.json({ status: "ready", value: (grantsByAgent.get(id) ?? []).map(toGrantPanelRecord) });
      }
      if (member === "userPicker") {
        if (body.dataName === "selected") {
          const id = (body.inputs.selected as { primaryKey?: string } | undefined)?.primaryKey;
          const match = userOptions.find((entry) => entry.primaryKey === id) ?? null;
          return Response.json({ status: "ready", value: match });
        }
        return Response.json({ status: "ready", value: { options: userOptions } });
      }
      if (member === "rolePicker") {
        if (body.dataName === "selected") {
          const id = (body.inputs.selected as { primaryKey?: string } | undefined)?.primaryKey;
          const match = roleOptions.find((entry) => entry.primaryKey === id) ?? null;
          return Response.json({ status: "ready", value: match });
        }
        return Response.json({ status: "ready", value: { options: roleOptions } });
      }
      if (member === "createForm") {
        return Response.json({ status: "ready", value: formDescriptionFor(null) });
      }
      if (member === "form") {
        const target = (body.inputs.agent ?? body.inputs.target) as { primaryKey?: string } | undefined;
        const found = agentList.find((item) => item.id === target?.primaryKey) ?? null;
        return Response.json({ status: "ready", value: formDescriptionFor(found) });
      }
      if (member === "scope") {
        return Response.json({
          status: "ready",
          value: body.dataName === "nodes"
            ? [{ primaryKey: "Order", label: "Orders", fields: {} }]
            : [],
        });
      }
      if (member === "model") {
        return Response.json({
          status: "ready",
          value: { options: [{ primaryKey: "openai/gpt-4o", value: "openai/gpt-4o", label: "GPT-4o" }] },
        });
      }
      return Response.json({ status: "ready", value: { options: [] } });
    }
    if (path === "/api/panel-operations/intents") {
      const body = request.body as {
        operationId: string;
        call?: { target?: { primaryKey?: string }; input?: Record<string, unknown> };
      };
      intentSeq += 1;
      const intentId = `22222222-2222-4222-8222-22222222222${intentSeq}`;
      intents.set(intentId, {
        operationId: body.operationId,
        targetId: body.call?.target?.primaryKey,
        input: body.call?.input,
      });
      return Response.json({
        intentId,
        operationId: body.operationId,
        label: body.operationId.includes("delete") ? "Delete agent" : "Save agent",
        confirmation: { kind: "none" },
      });
    }
    if (/^\/api\/panel-operation-intents\/[^/]+$/.test(path)) {
      const intentId = path.split("/").at(-1)!;
      const meta = intents.get(intentId);
      return Response.json({
        intentId,
        operationId: meta?.operationId ?? "form.save",
        label: "Run",
        confirmation: { kind: "none" },
      });
    }
    if (/^\/api\/panel-operations\/intents\/[^/]+\/dispatch$/.test(path)) {
      const intentId = path.split("/").at(-2)!;
      const meta = intents.get(intentId);
      if (meta?.operationId === "createForm.save") {
        const values = (meta.input?.values ?? {}) as Record<string, unknown>;
        options.onCreated?.(values);
        const created: MockAgent = {
          id: CREATED_ID,
          name: String(values.name ?? "New Agent"),
          description: String(values.description ?? ""),
          enabled: true,
          category: "custom",
        };
        agentList.push(created);
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            data: { id: CREATED_ID, ...values },
            created: { objectType: AGENT_DEFINITION, primaryKey: CREATED_ID },
            affected: {
              objects: [{ objectType: AGENT_DEFINITION, primaryKey: CREATED_ID }],
              objectTypes: [AGENT_DEFINITION],
            },
          },
        });
      }
      if (meta?.operationId === "remove.delete") {
        const targetId = meta.targetId ?? CUSTOM_ID;
        const idx = agentList.findIndex((item) => item.id === targetId);
        if (idx >= 0) agentList.splice(idx, 1);
        options.onDeleted?.(targetId);
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            message: "Deleted agent",
            data: {},
            affected: {
              objects: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
              objectTypes: [AGENT_DEFINITION],
              removed: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
            },
          },
        });
      }
      if (meta?.operationId === "shareEnable.share" || meta?.operationId === "shareDisable.share") {
        const targetId = meta.targetId ?? CUSTOM_ID;
        const shared = meta.input?.shared === true;
        const targetAgent = agentList.find((item) => item.id === targetId);
        if (targetAgent) targetAgent.domainShared = shared;
        const current = (grantsByAgent.get(targetId) ?? []).filter((row) => row.principalKind !== "domain");
        if (shared) {
          current.unshift({ principalKind: "domain", principalId: "*", principalName: "Domain", level: "use" });
        }
        grantsByAgent.set(targetId, current);
        options.onShare?.(targetId, shared);
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            data: {},
            affected: {
              objects: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
              objectTypes: [AGENT_DEFINITION],
            },
          },
        });
      }
      if (meta?.operationId === "grantSubmit.grant") {
        const targetId = meta.targetId ?? CUSTOM_ID;
        const input = meta.input ?? {};
        const principalKind = input.principalKind === "role" ? "role" : "principal";
        const principalId = String(input.principalId ?? "");
        const level = (input.verb === "edit" || input.verb === "view" ? input.verb : "use") as MockGrantRow["level"];
        const namePool = principalKind === "role" ? roleOptions : userOptions;
        const principalName = namePool.find((item) => item.primaryKey === principalId)?.label ?? principalId;
        const current = (grantsByAgent.get(targetId) ?? []).filter(
          (row) => !(row.principalKind === principalKind && row.principalId === principalId),
        );
        current.push({ principalKind, principalId, principalName, level });
        grantsByAgent.set(targetId, current);
        options.onGrant?.(targetId, input);
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            data: {},
            affected: {
              objects: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
              objectTypes: [AGENT_DEFINITION],
            },
          },
        });
      }
      if (meta?.operationId === "grantsList.revoke") {
        const targetId = meta.targetId ?? CUSTOM_ID;
        const input = meta.input ?? {};
        const principalKind = String(input.principalKind ?? "");
        const principalId = String(input.principalId ?? "");
        const current = (grantsByAgent.get(targetId) ?? []).filter(
          (row) => !(row.principalKind === principalKind && row.principalId === principalId),
        );
        grantsByAgent.set(targetId, current);
        options.onRevoke?.(targetId, input);
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            data: {},
            affected: {
              objects: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
              objectTypes: [AGENT_DEFINITION],
            },
          },
        });
      }
      return Response.json({
        kind: "dispatched",
        intentId,
        outcome: {
          kind: "success",
          data: meta?.input?.values ?? {},
          affected: {
            objects: meta?.targetId ? [{ objectType: AGENT_DEFINITION, primaryKey: meta.targetId }] : [],
            objectTypes: [AGENT_DEFINITION],
          },
        },
      });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    reads,
    sent,
    catalogUse,
    detailUse,
    async open(path = options.initialPath ?? catalogUse.path) {
      useApplicationCatalog().applications.value = [
        {
          id: appId,
          kind: "product",
          names: { en: appId === "agents" ? "Agent platform" : "Ontology" },
          descriptions: {},
          icon: appId === "agents" ? "agents" : "ontology",
          rail: "apps",
          category: appId === "agents" ? "business" : "build",
          sort: 0,
          entry: { path: appId === "agents" ? "/agents" : "/ontology", renderer: "panels" },
          scheduleAdapter: null,
          releaseId: null,
          panelUses: uses,
        },
      ];
      await router.push(path);
      const Shell = defineComponent({
        setup() {
          if (options.askUnsaved) {
            const unsaved = provideUnsavedChanges(options.askUnsaved);
            const removeLeaveCheck = router.beforeEach((to) => unsaved.allows(to.path));
            onBeforeUnmount(removeLeaveCheck);
          }
          return () => h(RouterView);
        },
      });
      return mountPlatformPage(() => h(Shell), router);
    },
  };
}

const answerLeaveConfirm = async (choice: "keep" | "discard") => {
  const box = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
      .find((candidateBox) => candidateBox.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    if (!found) throw new Error(`Expected unsaved leave confirm dialog for '${choice}'`);
    return found;
  }, { timeout: 5000 });
  const selector = choice === "keep"
    ? ".el-message-box__btns button.ontomato-danger-confirm-cancel"
    : ".el-message-box__btns button.el-button--danger";
  const button = box.querySelector<HTMLButtonElement>(selector);
  expect(button).toBeTruthy();
  button!.click();
  await vi.waitFor(() => {
    const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
      .find((candidateBox) => candidateBox.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    expect(open).toBeUndefined();
  }, { timeout: 5000 });
};

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

describe("agent-settings & agent-detail two-entry builtin panels", () => {
  it("contains zero usePanelData/PanelData and zero two-pane-layout across catalog and detail", () => {
    for (const text of [
      catalogModule,
      catalogHtml,
      JSON.stringify(catalogSource),
      catalogRecipes,
      detailModule,
      detailHtml,
      JSON.stringify(detailSource),
      detailRecipes,
    ]) {
      expect(text).not.toMatch(/usePanelData|PanelData|two-pane-layout/);
    }
    expect(Object.keys(catalogSource.manifest.state).sort()).toEqual(["creating", "detailPath", "search"]);
    expect(catalogSource.manifest.state.search.deepLink).toBe(true);
    expect(catalogSource.manifest.state.creating.deepLink).toBe(true);
    expect(catalogSource.manifest.state.detailPath.external).toBe(true);
    expect(Object.keys(detailSource.manifest.state).sort()).toEqual([
      "catalogPath",
      "grantDialog",
      "grantPrincipalId",
      "grantPrincipalKind",
      "grantRole",
      "grantUser",
      "grantVerb",
      "selected",
      "tab",
    ]);
    expect(detailSource.manifest.state.selected.deepLink).toBe(true);
    expect(detailSource.manifest.state.tab.deepLink).toBe(true);
    expect(detailSource.manifest.state.catalogPath.external).toBe(true);
    for (const key of ["grantDialog", "grantPrincipalId", "grantPrincipalKind", "grantRole", "grantUser", "grantVerb"] as const) {
      expect(detailSource.manifest.state[key].deepLink).toBe(false);
    }
    expect(detailSource.manifest.members.remove.config.hideWhenUnavailable).toBe(true);
    // All 8 locales in agent-detail panel messages maintain exact key parity.
    const messageLocales = Object.keys(detailSource.content.messages).sort();
    expect(messageLocales).toEqual(["ar", "de", "en", "fr", "it", "ja", "zh-CN", "zh-TW"]);
    const enKeys = Object.keys(detailSource.content.messages.en).sort();
    for (const locale of messageLocales) {
      expect(Object.keys(detailSource.content.messages[locale as keyof typeof detailSource.content.messages]).sort()).toEqual(enKeys);
    }
  });

  it("renders full-width searchable catalog with no default selection and navigates to ontology detail on row click", { timeout: 20000 }, async () => {
    const app = mountTwoEntryApp({ appId: "ontology" });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelectorAll(".sdk-object-list-table tbody tr")).toHaveLength(3);
      }, { timeout: 5000 });

      expect(app.router.currentRoute.value.path).toBe("/ontology/agents");
      expect(app.router.currentRoute.value.query.selected).toBeUndefined();
      // No form/record reads until the user opens an agent or clicks New agent.
      expect(app.reads.some((r) => r.memberPath[0]?.member === "form" || r.memberPath[0]?.member === "header")).toBe(false);

      // Search filters rows locally in place.
      const searchInput = page.element.querySelector<HTMLInputElement>(".sdk-object-list-search");
      expect(searchInput).toBeTruthy();
      searchInput!.value = "Diagnosis";
      searchInput!.dispatchEvent(new Event("input"));
      await vi.waitFor(() => {
        expect(page.element.querySelectorAll(".sdk-object-list-table tbody tr")).toHaveLength(1);
      }, { timeout: 5000 });
      expect(page.element.querySelector(".sdk-object-list-table tbody tr")?.textContent).toContain("Operations Diagnosis");

      // Unmatched search shows noMatch text cleanly.
      searchInput!.value = "nonexistent-xyz";
      searchInput!.dispatchEvent(new Event("input"));
      await vi.waitFor(() => {
        expect(page.element.textContent).toContain("No matching agents.");
      }, { timeout: 5000 });

      // Clear search and click row -> navigates to /ontology/agents/detail?selected=<id>.
      searchInput!.value = "";
      searchInput!.dispatchEvent(new Event("input"));
      await vi.waitFor(() => {
        expect(page.element.querySelectorAll(".sdk-object-list-table tbody tr")).toHaveLength(3);
      }, { timeout: 5000 });

      const salesRow = [...page.element.querySelectorAll<HTMLElement>(".sdk-object-list-table tbody tr")]
        .find((row) => row.textContent?.includes("Sales Analyst"))!;
      salesRow.click();

      await vi.waitFor(() => {
        expect(app.router.currentRoute.value.path).toBe("/ontology/agents/detail");
        expect(app.router.currentRoute.value.query.selected).toBe(CUSTOM_ID);
        expect(page.element.querySelector('[data-field="/name"] input')).toBeTruthy();
      }, { timeout: 5000 });
    } finally {
      page.app.unmount();
    }
  });

  it("opens centered create dialog with /name and /description, guards unsaved close, and jumps to detail on create", { timeout: 25000 }, async () => {
    let submitted: Record<string, unknown> | null = null;
    const app = mountTwoEntryApp({
      appId: "agents",
      onCreated: (values) => { submitted = values; },
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelectorAll(".sdk-object-list-table tbody tr")).toHaveLength(3);
      }, { timeout: 5000 });

      const newBtn = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .find((btn) => btn.textContent?.includes("New agent"))!;
      expect(newBtn).toBeTruthy();
      newBtn.click();

      await vi.waitFor(() => {
        expect(document.querySelector('.agents-create-body [data-field="/name"] input')).toBeTruthy();
        expect(document.querySelector('.agents-create-body [data-field="/description"] textarea')).toBeTruthy();
      }, { timeout: 5000 });
      // Only /name and /description are shown in the minimal creation dialog.
      expect(document.querySelector('.agents-create-body [data-field="/systemPrompt"]')).toBeNull();
      expect(document.querySelector('.agents-create-body [data-field="/classNames"]')).toBeNull();

      const nameInput = document.querySelector<HTMLInputElement>('.agents-create-body [data-field="/name"] input')!;
      nameInput.value = "Forecast Helper";
      nameInput.dispatchEvent(new Event("input"));
      await nextTick();

      // Clicking Cancel / closing while dirty prompts confirmation; Keep keeps draft.
      const closeBtn = document.querySelector<HTMLButtonElement>(".el-dialog__headerbtn");
      expect(closeBtn).toBeTruthy();
      closeBtn!.click();
      await answerLeaveConfirm("keep");
      expect(document.querySelector<HTMLInputElement>('.agents-create-body [data-field="/name"] input')?.value).toBe("Forecast Helper");

      // Submit Create -> navigates to /agents/settings/detail?selected=<CREATED_ID>.
      const createBtn = [...document.querySelectorAll<HTMLButtonElement>(".agents-create-body .sdk-owner-form-actions button")]
        .find((btn) => btn.textContent?.trim() === "Create")!;
      expect(createBtn).toBeTruthy();
      createBtn.click();

      await vi.waitFor(() => {
        expect(app.router.currentRoute.value.path).toBe("/agents/settings/detail");
        expect(app.router.currentRoute.value.query.selected).toBe(CREATED_ID);
      }, { timeout: 5000 });
      expect(submitted).toMatchObject({ name: "Forecast Helper" });
    } finally {
      page.app.unmount();
    }
  });

  it("hides New agent and shows alert when catalog list read is forbidden", async () => {
    const app = mountTwoEntryApp({ listForbidden: true });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector('[role="alert"]')?.textContent).toContain("analysis-agent");
      }, { timeout: 5000 });
      expect(page.element.textContent).not.toContain("New agent");
    } finally {
      page.app.unmount();
    }
  });

  it("renders system built-in detail with model-only form, info banner, category badge, and no Delete button", { timeout: 20000 }, async () => {
    const app = mountTwoEntryApp({
      appId: "ontology",
      initialPath: panelAddress("/ontology/agents/detail", { selected: SYSTEM_ID }),
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector('[data-field="/modelSelection/modelId"]')).toBeTruthy();
      }, { timeout: 5000 });
      expect(page.element.textContent).toContain("Operations Diagnosis");
      expect(page.element.textContent).toContain("System");
      expect(page.element.textContent).toContain("only support changing their model configuration");
      expect(page.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(true);
      expect(page.element.querySelector('[data-field="/systemPrompt"]')).toBeNull();
      // Delete button is hidden for system built-in agents (hideWhenUnavailable: true).
      const deleteButtons = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .filter((btn) => btn.textContent?.includes("Delete"));
      expect(deleteButtons).toHaveLength(0);
    } finally {
      page.app.unmount();
    }
  });

  it("renders preset agent detail with full form and hides Delete button", { timeout: 20000 }, async () => {
    const app = mountTwoEntryApp({
      appId: "agents",
      initialPath: panelAddress("/agents/settings/detail", { selected: PRESET_ID }),
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector('[data-field="/systemPrompt"]')).toBeTruthy();
      }, { timeout: 5000 });
      expect(page.element.textContent).toContain("Preset");
      // View class is only shown in ontology manager context, not under /agents/settings/detail.
      expect(page.element.textContent).not.toContain("View class");
      const deleteButtons = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .filter((btn) => btn.textContent?.includes("Delete"));
      expect(deleteButtons).toHaveLength(0);

      // Back returns to /agents/settings (the wired catalogPath).
      const backBtn = page.element.querySelector<HTMLButtonElement>(".sdk-page-header-back");
      expect(backBtn).toBeTruthy();
      backBtn!.click();
      await vi.waitFor(() => {
        expect(app.router.currentRoute.value.path).toBe("/agents/settings");
      }, { timeout: 5000 });
    } finally {
      page.app.unmount();
    }
  });

  it("supports View class, dirty-back confirmation, and Delete returning to catalog on custom agent detail", { timeout: 25000 }, async () => {
    let deletedId: string | null = null;
    let leaveAsked = 0;
    const app = mountTwoEntryApp({
      appId: "ontology",
      initialPath: panelAddress("/ontology/agents/detail", { selected: CUSTOM_ID }),
      askUnsaved: async () => {
        leaveAsked += 1;
        return false;
      },
      onDeleted: (id) => { deletedId = id; },
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Sales Analyst");
      }, { timeout: 5000 });

      // Dirty edit guards Back navigation.
      const nameInput = page.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      nameInput.value = "Sales Analyst v2";
      nameInput.dispatchEvent(new Event("input"));
      await nextTick();

      const backBtn = page.element.querySelector<HTMLButtonElement>(".sdk-page-header-back")!;
      backBtn.click();
      await vi.waitFor(() => {
        expect(leaveAsked).toBe(1);
      }, { timeout: 5000 });
      expect(app.router.currentRoute.value.path).toBe("/ontology/agents/detail");
      expect(page.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Sales Analyst v2");

      // Discard via header draft bar so we can test View class and Delete cleanly.
      const discardBtn = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .find((btn) => btn.textContent?.trim() === "Discard")!;
      expect(discardBtn).toBeTruthy();
      discardBtn.click();
      const discardBox = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".el-message-box");
        if (!found) throw new Error("Expected discard confirm dialog");
        return found;
      });
      [...discardBox.querySelectorAll<HTMLButtonElement>("button")].find((btn) => btn.textContent?.trim() === "Discard")!.click();
      await vi.waitFor(() => {
        expect(page.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Sales Analyst");
      }, { timeout: 5000 });

      // View class button is omitted from the editor header in both entries (AG-13).
      const viewClassBtn = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .find((btn) => btn.textContent?.trim() === "View class");
      expect(viewClassBtn).toBeUndefined();

      // Delete custom agent -> returns to /ontology/agents.
      const deleteBtn = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .find((btn) => btn.textContent?.includes("Delete"))!;
      expect(deleteBtn).toBeTruthy();
      deleteBtn.click();
      await vi.waitFor(() => {
        expect(deletedId).toBe(CUSTOM_ID);
        expect(app.router.currentRoute.value.path).toBe("/ontology/agents");
      }, { timeout: 5000 });
    } finally {
      page.app.unmount();
    }
  });

  it("renders missing and forbidden detail states in place without mounting form or Delete", async () => {
    const missingApp = mountTwoEntryApp({
      initialPath: panelAddress("/ontology/agents/detail", { selected: MISSING_ID }),
    });
    const missingPage = await missingApp.open();
    try {
      await vi.waitFor(() => {
        expect(missingPage.element.querySelector('[role="alert"]')?.textContent).toContain("Agent definition not found");
      }, { timeout: 5000 });
      expect(missingPage.element.querySelector('[data-field="/name"]')).toBeNull();
    } finally {
      missingPage.app.unmount();
    }

    const forbiddenApp = mountTwoEntryApp({
      initialPath: panelAddress("/ontology/agents/detail", { selected: CUSTOM_ID }),
      recordResponse: () => Response.json({ status: "forbidden" }),
    });
    const forbiddenPage = await forbiddenApp.open();
    try {
      await vi.waitFor(() => {
        expect(forbiddenPage.element.querySelector('[role="alert"]')?.textContent).toContain("permission");
      }, { timeout: 5000 });
      expect(forbiddenPage.element.querySelector('[data-field="/name"]')).toBeNull();
    } finally {
      forbiddenPage.app.unmount();
    }
  });

  it("manages domain-wide sharing and single-select 3-level grants (use/view/edit) and revocations for editors", { timeout: 25000 }, async () => {
    const shareCalls: Array<{ targetId: string; shared: boolean }> = [];
    const grantCalls: Array<{ targetId: string; input: Record<string, unknown> }> = [];
    const revokeCalls: Array<{ targetId: string; input: Record<string, unknown> }> = [];

    const app = mountTwoEntryApp({
      appId: "agents",
      initialPath: panelAddress("/agents/settings/detail", { selected: CUSTOM_ID }),
      onShare: (targetId, shared) => shareCalls.push({ targetId, shared }),
      onGrant: (targetId, input) => grantCalls.push({ targetId, input }),
      onRevoke: (targetId, input) => revokeCalls.push({ targetId, input }),
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector('[data-field="/name"] input')).toBeTruthy();
      }, { timeout: 5000 });
      // Default config tab does not eagerly read grantRows before switching to Permissions & sharing.
      expect(app.reads.some((r) => "dataName" in r && r.memberPath[0]?.member === "grantsList")).toBe(false);

      // Switch to Permissions & sharing tab.
      const grantsTab = [...page.element.querySelectorAll<HTMLElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.includes("Permissions & sharing"))!;
      expect(grantsTab).toBeTruthy();
      grantsTab.click();

      await vi.waitFor(() => {
        expect(page.element.querySelector('[data-tab="grants"]')).toBeTruthy();
        expect(page.element.textContent).toContain("Only the members and roles explicitly granted below");
        expect(page.element.textContent).toContain("Alice");
      }, { timeout: 5000 });

      // Enable domain-wide sharing -> invokes agents.share({ shared: true }) and updates description + button.
      const enableShareBtn = [...page.element.querySelectorAll<HTMLButtonElement>('[data-tab="grants"] button')]
        .find((btn) => btn.textContent?.includes("Enable domain-wide use"))!;
      expect(enableShareBtn).toBeTruthy();
      enableShareBtn.click();

      await vi.waitFor(() => {
        expect(shareCalls).toEqual([{ targetId: CUSTOM_ID, shared: true }]);
        expect(page.element.textContent).toContain("All members in this domain can use this agent.");
        expect(page.element.textContent).toContain("Disable domain-wide use");
      }, { timeout: 5000 });

      // Open Add grant dialog, switch to Role, pick Analyst, choose View level, and submit.
      const addGrantBtn = [...page.element.querySelectorAll<HTMLButtonElement>('[data-tab="grants"] button')]
        .find((btn) => btn.textContent?.includes("Add grant"))!;
      expect(addGrantBtn).toBeTruthy();
      addGrantBtn.click();

      await vi.waitFor(() => {
        expect(document.querySelector(".el-dialog")).toBeTruthy();
      }, { timeout: 5000 });

      const roleOptionBtn = [...document.querySelectorAll<HTMLButtonElement>(".el-dialog .el-segmented__item, .el-dialog .sdk-segmented-option, .el-dialog button, .el-dialog label")]
        .find((el) => el.textContent?.trim() === "Role")!;
      expect(roleOptionBtn).toBeTruthy();
      roleOptionBtn.click();

      // Open role picker and pick "Analyst".
      await vi.waitFor(() => {
        expect(app.reads.some((r) => r.memberPath[0]?.member === "rolePicker")).toBe(true);
      }, { timeout: 5000 });
      const pickerTrigger = document.querySelector<HTMLElement>(".el-dialog .sdk-inline-reference-picker-select .el-select__wrapper, .el-dialog .sdk-inline-reference-picker-select input, .el-dialog .sdk-inline-reference-picker-select");
      expect(pickerTrigger).toBeTruthy();
      pickerTrigger!.click();
      await vi.waitFor(() => {
        const analystOption = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item, [role='option']")]
          .find((el) => el.textContent?.includes("Analyst"));
        if (!analystOption) throw new Error("Expected Analyst option in rolePicker dropdown");
        analystOption.click();
      }, { timeout: 5000 });

      // Choose single-select level "View" and verify its description updates.
      const viewLevelBtn = [...document.querySelectorAll<HTMLElement>(".el-dialog .el-segmented__item, .el-dialog .sdk-segmented-option, .el-dialog button, .el-dialog label")]
        .find((el) => el.textContent?.trim() === "View")!;
      expect(viewLevelBtn).toBeTruthy();
      viewLevelBtn.click();
      await vi.waitFor(() => {
        expect(document.querySelector(".el-dialog")?.textContent).toContain("read-only mode");
      }, { timeout: 5000 });

      // Submit Grant -> dispatches agents.grant with { principalKind: "role", principalId: "role-analyst", verb: "view" }.
      const submitBtn = [...document.querySelectorAll<HTMLButtonElement>(".el-dialog__footer button")]
        .find((btn) => btn.textContent?.trim() === "Grant")!;
      expect(submitBtn).toBeTruthy();
      await vi.waitFor(() => {
        expect(submitBtn.disabled).toBe(false);
      }, { timeout: 5000 });
      submitBtn.click();

      await vi.waitFor(() => {
        expect(grantCalls).toEqual([{
          targetId: CUSTOM_ID,
          input: { principalKind: "role", principalId: "role-analyst", verb: "view" },
        }]);
        expect(page.element.querySelector('[data-tab="grants"]')?.textContent).toContain("Analyst");
      }, { timeout: 5000 });

      // Revoke the newly granted Analyst role row -> dispatches agents.revoke with { principalKind: "role", principalId: "role-analyst" }.
      const analystRow = [...page.element.querySelectorAll<HTMLElement>('[data-tab="grants"] .sdk-object-list-table tbody tr')]
        .find((row) => row.textContent?.includes("Analyst"))!;
      expect(analystRow).toBeTruthy();
      const revokeBtn = [...analystRow.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.trim() === "Revoke")!;
      expect(revokeBtn).toBeTruthy();
      revokeBtn.click();

      await vi.waitFor(() => {
        expect(revokeCalls).toEqual([{
          targetId: CUSTOM_ID,
          input: { principalKind: "role", principalId: "role-analyst" },
        }]);
        expect(page.element.querySelector('[data-tab="grants"]')?.textContent).not.toContain("Analyst");
      }, { timeout: 5000 });
    } finally {
      page.app.unmount();
    }
  });

  it("hides Permissions & sharing tab, falls back from ?tab=grants, and skips grantRows for view-only readers", { timeout: 20000 }, async () => {
    const app = mountTwoEntryApp({
      appId: "agents",
      agents: DEFAULT_AGENTS.map((agent) => ({ ...agent, canEdit: false, canGrant: false })),
      initialPath: panelAddress("/agents/settings/detail", { selected: CUSTOM_ID, tab: "grants" }),
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector('[data-field="/name"] input')).toBeTruthy();
      }, { timeout: 5000 });
      expect(page.element.textContent).toContain("read-only access");
      expect(page.element.querySelector('[data-tab="grants"]')).toBeNull();
      expect(page.element.querySelectorAll('[role="tab"]')).toHaveLength(0);
      expect(app.reads.some((r) => "dataName" in r && r.memberPath[0]?.member === "grantsList")).toBe(false);
      expect(page.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(true);
      const deleteButtons = [...page.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .filter((btn) => btn.textContent?.includes("Delete"));
      expect(deleteButtons).toHaveLength(0);
    } finally {
      page.app.unmount();
    }
  });

  it("shows system business-gate notice inside Permissions & sharing tab for system built-in agents", { timeout: 20000 }, async () => {
    const app = mountTwoEntryApp({
      appId: "ontology",
      initialPath: panelAddress("/ontology/agents/detail", { selected: SYSTEM_ID, tab: "grants" }),
    });
    const page = await app.open();
    try {
      await vi.waitFor(() => {
        expect(page.element.querySelector('[data-tab="grants"]')).toBeTruthy();
        expect(page.element.textContent).toContain("feature access gate");
        expect(page.element.textContent).toContain("Domain Admin");
      }, { timeout: 5000 });
      // Deep-linking directly to the grants tab does not eagerly mount or read the heavy config form tab.
      expect(page.element.querySelector('[data-tab="config"]')).toBeNull();
      expect(app.reads.some((r) => "dataName" in r && r.memberPath[0]?.member === "form")).toBe(false);
    } finally {
      page.app.unmount();
    }
  });
});
