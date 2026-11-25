import { z } from "zod";
import {
  ontologyAgentModelSchema, ontologyAgentModelWriteSchema, type ModelSelection,
} from "@ontomato/contracts/model-settings";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { RETRIEVAL_AGENT_ID, productGrantVerbSchema, type ProductGrantRecord } from "@ontomato/contracts/product-governance";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormDescription, PanelFormRequest, PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { isAppBuilderKind } from "../app-builder/definition";
import { createAppBuilderDefinition } from "../app-builder/panel-model";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { agentDefinitionRecord } from "../assistant/definition-record";
import { formJsonSchema, modelPanelField, modelSelectionWrite } from "../assistant/model-panel-form";
import { describeAgentDefinitionForm } from "../assistant/definition-form";
import { readAgentDefinitionRow } from "../assistant/definitions";
import { assistantDescription, assistantName } from "../assistant/labels";
import { isPresetAgentKind } from "../assistant/preset-definitions";
import { assistantService } from "../assistant/service";
import { assistantStore, type AssistantOwner, type AgentRow } from "../assistant/store";
import { readFavorites } from "../platform-home/service";
import { createOpsDiagnosisDefinition } from "../ops-diagnosis/panel-model";
import { grantedProductIds, productGrantAllowed, readProductGrantRecords, requireProductGrant } from "../product-governance/grants";
import { ownerEnvelopeSchema } from "./data-query-operations";
import { operationHost } from "./operation-host";

const retrievalPath = `${DATA_QUERY_GATEWAY}/ontology/ai/agent-models`;
export const systemFormValues = modelSelectionWrite.extend({ name: z.string().optional(), description: z.string().optional() });
type SystemAgent = { id: string; name: string; description: string; modelSelection: ModelSelection };
type SystemOwner = {
  read(): Promise<SystemAgent>;
  save(id: string, selection: ModelSelection): Promise<{ modelSelection: ModelSelection }>;
};

export function createSystemAgentOwners(owner: AssistantOwner, viewer: AssistantCredentials) {
  const builder = createAppBuilderDefinition(owner, viewer);
  const diagnosis = createOpsDiagnosisDefinition(owner, viewer);
  const host = operationHost({ owner, credentials: viewer });
  async function callRetrieval<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init: NonNullable<Parameters<typeof fetch>[1]>) {
    const response = await host.request(path, init);
    const envelope = ownerEnvelopeSchema.parse(await response.json());
    if (!response.ok || !envelope.success) {
      throw new HttpError(response.ok ? 422 : response.status, envelope.message ?? response.statusText,
        typeof envelope.code === "string" ? envelope.code : response.status === 403 ? "FORBIDDEN" : undefined);
    }
    return schema.parse(envelope.data);
  }
  const retrieval: SystemOwner = {
    async read() {
      const { id, modelSelection } = await callRetrieval(
        `${retrievalPath}/${RETRIEVAL_AGENT_ID}`,
        ontologyAgentModelSchema,
        { method: "GET" },
      );
      return {
        id, modelSelection,
        name: tForLocale(viewer.locale, "panels.agentDefinition.retrievalName"),
        description: tForLocale(viewer.locale, "panels.agentDefinition.retrievalDescription"),
      };
    },
    async save(id, modelSelection) {
      const saved = await callRetrieval(`${retrievalPath}/${encodeURIComponent(id)}`, ontologyAgentModelSchema, {
        method: "PUT",
        body: JSON.stringify(ontologyAgentModelWriteSchema.parse({ modelSelection })),
      });
      return { modelSelection: saved.modelSelection };
    },
  };
  return {
    builder,
    diagnosis,
    fixed: [
      { id: RETRIEVAL_AGENT_ID, source: retrieval },
    ],
    async forTarget(primaryKey: string) {
      if (primaryKey === RETRIEVAL_AGENT_ID) return retrieval;
      if (await builder.matches(primaryKey)) return builder;
      if (await diagnosis.matches(primaryKey)) return diagnosis;
    },
  };
}

function systemAgentForm(agent: SystemAgent, inputs: Pick<PanelFormRequest, "values">, canEdit: boolean, locale?: string): PanelFormDescription {
  const { name, description, modelSelection } = agent;
  const text = (key: string) => tForLocale(locale, `panels.agentForm.${key}`);
  const readOnlyField = (key: "name" | "description") => ({
    path: `/${key}`, label: text(key), section: "basics",
    valueSchema: formJsonSchema(z.string()), readOnly: true, required: false,
    control: { kind: "text" as const, ...(key === "description" ? { multiline: true } : {}) },
  });
  return {
    sections: [
      { key: "basics", title: text("sections.basics") },
      { key: "model", title: text("sections.model"), hint: text("sections.modelHint") },
    ],
    fields: [
      readOnlyField("name"),
      readOnlyField("description"),
      {
        ...modelPanelField(locale), section: "model",
        ...(!canEdit && { readOnly: true, readOnlyReason: text("editReadOnly") }),
      },
    ],
    values: { name, description, modelSelection: inputs.values?.modelSelection ?? modelSelection },
    errors: [],
    save: {
      method: "PUT",
      path: `/assistant/agent-definitions/${agent.id}`,
      bodySchema: formJsonSchema(systemFormValues),
    },
  };
}

const agentId = z.string().uuid();
function validateId(primaryKey: string) {
  if (!agentId.safeParse(primaryKey).success)
    throw new HttpError(400, "Invalid agent definition target", "INVALID_REQUEST");
}

const isShared = (grants: ProductGrantRecord[]) =>
  grants.some(grant => grant.principalKind === "domain" && grant.verb === "use");

export interface VisibleAgentMcpUsage {
  /** Whether the caller can view at least one MCP-capable agent definition in this domain. */
  readonly hasVisibleAgents: boolean;
  /** Caller-visible agent display names grouped by enabled external MCP service ID. */
  readonly byServiceId: ReadonlyMap<string, readonly string[]>;
}

/**
 * Returns caller-visible agents' external MCP service references using the agent owner's own
 * visibility rules (`grantedProductIds("view", viewer)` + `assistantStore.channelAgents`).
 */
export async function readVisibleAgentMcpUsages(
  owner: AssistantOwner,
  viewer: AssistantCredentials,
): Promise<VisibleAgentMcpUsage> {
  const [ids, agents] = await Promise.all([
    grantedProductIds("view", viewer),
    assistantStore.channelAgents(owner.domainId),
  ]);
  const visible = new Set(ids);
  const byServiceId = new Map<string, string[]>();
  let visibleCount = 0;
  for (const agent of agents) {
    if (!visible.has(agent.id) || isAppBuilderKind(agent.kind) || isOpsDiagnosisKind(agent.kind)) continue;
    visibleCount += 1;
    const label = assistantName(agent, viewer.locale);
    for (const serviceId of agent.enabled_mcp_service_ids ?? []) {
      const list = byServiceId.get(serviceId);
      if (list) list.push(label);
      else byServiceId.set(serviceId, [label]);
    }
  }
  return { hasVisibleAgents: visibleCount > 0, byServiceId };
}

type FormInputs = Pick<PanelFormRequest, "values" | "changedField">;

export function createAgentDefinitionDirectory(owner: AssistantOwner, viewer: AssistantCredentials) {
  const systems = createSystemAgentOwners(owner, viewer);
  const word = (key: string) => tForLocale(viewer.locale, `panels.productCatalog.${key}`);
  const catalogueWord = (key: string) => word(`application.${key}`);
  const storedRecord = (agent: AgentRow, canEdit: boolean, domainShared?: boolean) => agentDefinitionRecord({
    id: agent.id,
    name: assistantName(agent, viewer.locale),
    description: assistantDescription(agent, viewer.locale),
    enabled: agent.enabled,
  }, isPresetAgentKind(agent.kind) ? "preset" : "custom", viewer.locale, canEdit, domainShared);
  const systemRecord = (agent: SystemAgent, canEdit: boolean, domainShared?: boolean) =>
    agentDefinitionRecord({ ...agent, enabled: true }, "system", viewer.locale, canEdit, domainShared);

  async function visibleDefinitions() {
    const [ids, agents] = await Promise.all([
      grantedProductIds("view", viewer),
      assistantStore.channelAgents(owner.domainId),
    ]);
    const visible = new Set(ids);
    const stored: AgentRow[] = [];
    const builtIn = [];
    for (const agent of agents) {
      if (!visible.has(agent.id)) continue;
      if (isAppBuilderKind(agent.kind)) builtIn.push({ id: agent.id, source: systems.builder });
      else if (isOpsDiagnosisKind(agent.kind)) builtIn.push({ id: agent.id, source: systems.diagnosis });
      else stored.push(agent);
    }
    builtIn.push(...systems.fixed.filter(agent => visible.has(agent.id)));
    return { stored, builtIn };
  }

  async function grants(primaryKey: string) {
    validateId(primaryKey);
    await requireProductGrant(primaryKey, "edit", viewer);
    if (!await systems.forTarget(primaryKey)) await readAgentDefinitionRow(primaryKey, owner);
    const result = await readProductGrantRecords(primaryKey, viewer);
    return { grants: result.grants, shared: isShared(result.grants) };
  }

  return {
    async available(params: { search?: string; favoritesOnly?: boolean } = {}): Promise<PanelRecord[]> {
      const [{ agents }, favorites] = await Promise.all([
        assistantService.agents(owner, viewer),
        readFavorites(owner),
      ]);
      const enabled = agents.filter(agent => agent.enabled);
      const favoriteIds = favorites.filter(item => item.kind === "agent").map(item => item.id);
      const favoriteSet = new Set(favoriteIds);
      const ordered = params.favoritesOnly
        ? favoriteIds.flatMap(id => enabled.find(agent => agent.id === id) ?? [])
        : enabled;
      const queryText = params.search?.trim().toLocaleLowerCase() ?? "";
      return ordered.flatMap((agent): PanelRecord[] => {
        const description = agent.description?.trim() || undefined;
        if (queryText && !`${agent.name}\n${description ?? ""}`.toLocaleLowerCase().includes(queryText)) {
          return [];
        }
        return [{
          primaryKey: agent.id,
          className: AGENT_DEFINITION,
          label: agent.name,
          ...(description && { subtitle: description }),
          fields: {
            category: "agents",
            icon: agent.icon ?? "",
            favorite: favoriteSet.has(agent.id),
          },
          outputs: {
            openPath: `/agents/chat?agentId=${encodeURIComponent(agent.id)}`,
          },
        }];
      });
    },
    async list() {
      const [{ stored, builtIn }, editIds] = await Promise.all([
        visibleDefinitions(),
        grantedProductIds("edit", viewer),
      ]);
      const editable = new Set(editIds);
      return [
        ...stored.map(agent => storedRecord(agent, editable.has(agent.id))),
        ...await Promise.all(builtIn.map(async ({ id, source }) => systemRecord(await source.read(), editable.has(id)))),
      ];
    },
    async count() {
      const { stored, builtIn } = await visibleDefinitions();
      return { rows: [], total: stored.length + builtIn.length };
    },
    async record(primaryKey: string) {
      validateId(primaryKey);
      await requireProductGrant(primaryKey, "view", viewer);
      const source = await systems.forTarget(primaryKey);
      const canEdit = await productGrantAllowed(primaryKey, "edit", viewer);
      const domainShared = canEdit ? isShared((await readProductGrantRecords(primaryKey, viewer)).grants) : undefined;
      return source
        ? systemRecord(await source.read(), canEdit, domainShared)
        : storedRecord(await readAgentDefinitionRow(primaryKey, owner), canEdit, domainShared);
    },
    async form(primaryKey: string, inputs: FormInputs) {
      validateId(primaryKey);
      const source = await systems.forTarget(primaryKey);
      if (!source)
        return describeAgentDefinitionForm({ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey }, ...inputs }, owner, viewer);
      await requireProductGrant(primaryKey, "view", viewer);
      const canEdit = await productGrantAllowed(primaryKey, "edit", viewer);
      return systemAgentForm(await source.read(), inputs, canEdit, viewer.locale);
    },
    async createForm(inputs: FormInputs) {
      return describeAgentDefinitionForm({ target: { kind: "draft" }, ...inputs }, owner, viewer);
    },
    grants,
    async grantRows(primaryKey: string): Promise<PanelRecord[]> {
      const result = await grants(primaryKey);
      const highest = new Map<string, ProductGrantRecord>();
      const levels = productGrantVerbSchema.options;
      for (const grant of result.grants) {
        const key = `${grant.principalKind}:${grant.principalId}`;
        const previous = highest.get(key);
        if (!previous || levels.indexOf(grant.verb) > levels.indexOf(previous.verb)) highest.set(key, grant);
      }
      return Array.from(highest, ([key, { principalKind, principalId, principalName, verb: level }]): PanelRecord => {
        const isDomain = principalKind === "domain";
        const principalKindLabel = isDomain ? word("grantDomain") : catalogueWord(principalKind === "role" ? "grantRole" : "grantPrincipal");
        const levelLabel = level === "view" ? word("grantView") : catalogueWord(level === "edit" ? "grantEdit" : "grantUse");
        const tone = level === "edit" ? "warning" : level === "view" ? "info" : "default";
        return {
          primaryKey: key,
          className: AGENT_DEFINITION,
          label: isDomain ? principalKindLabel : principalName || principalId,
          ...(!isDomain && principalName && principalName !== principalId && { subtitle: principalId }),
          fields: { principalKind, principalKindLabel, principalId, level, levelLabel, verb: level, verbLabel: levelLabel, revocable: !isDomain },
          fieldLabels: { principalKindLabel: catalogueWord("grantKind"), levelLabel: catalogueWord("grantVerb"), verbLabel: catalogueWord("grantVerb") },
          tones: { principalKindLabel: isDomain ? "success" : "info", levelLabel: tone, verbLabel: tone },
        };
      });
    },
  };
}
