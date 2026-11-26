import { z } from "zod";
import {
  ontologyAgentModelSchema, ontologyAgentModelWriteSchema, type ModelSelection,
} from "@ontomato/contracts/model-settings";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { RETRIEVAL_AGENT_ID } from "@ontomato/contracts/product-governance";
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
import { assistantDescription, assistantName } from "../assistant/labels";
import { isPresetAgentKind } from "../assistant/preset-definitions";
import { assistantService } from "../assistant/service";
import { assistantStore, type AssistantOwner, type AgentRow } from "../assistant/store";
import { readFavorites } from "../platform-home/service";
import { createOpsDiagnosisDefinition } from "../ops-diagnosis/panel-model";
import { decideObjects, readAgentAccess, readObjectRanges, requireAllowed } from "../product-governance/authorization";
import { agentObject, allowedAgents } from "../assistant/authorization";
import { ownerEnvelopeSchema } from "./data-query-operations";
import { operationHost } from "./operation-host";

const retrievalPath = `${DATA_QUERY_GATEWAY}/ontology/ai/agent-models`;
export const systemFormValues = modelSelectionWrite.extend({ name: z.string().optional(), description: z.string().optional() });
type SystemAgent = { id: string; name: string; description: string; modelSelection: ModelSelection; editable?: boolean };
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
      const { id, modelSelection, editable } = await callRetrieval(
        `${retrievalPath}/${RETRIEVAL_AGENT_ID}`,
        ontologyAgentModelSchema.extend({ editable: z.boolean() }).strict(),
        { method: "GET" },
      );
      return {
        id, modelSelection, editable,
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
    retrieval,
    async forTarget(primaryKey: string) {
      if (primaryKey === RETRIEVAL_AGENT_ID) return retrieval;
      if (await builder.matches(primaryKey)) return builder;
      if (await diagnosis.matches(primaryKey)) return diagnosis;
    },
  };
}

export async function agentPolicyDefinition(
  owner: AssistantOwner, credentials: AssistantCredentials, id: string,
) {
  if (id === RETRIEVAL_AGENT_ID) {
    await createSystemAgentOwners(owner, credentials).retrieval.read();
    return agentObject({ id, domain_id: owner.domainId, owner_id: null });
  }
  return agentObject(await assistantStore.agent(id, owner));
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

export interface VisibleAgentMcpUsage {
  /** Whether the caller can view at least one MCP-capable agent definition in this domain. */
  readonly hasVisibleAgents: boolean;
  /** Caller-visible agent display names grouped by enabled external MCP service ID. */
  readonly byServiceId: ReadonlyMap<string, readonly string[]>;
}

/**
 * Returns caller-visible agents' external MCP service references using the agent owner's own
 * definition authorization.
 */
export async function readVisibleAgentMcpUsages(
  owner: AssistantOwner,
  viewer: AssistantCredentials,
): Promise<VisibleAgentMcpUsage> {
  const agents = (await assistantStore.channelAgents(owner.domainId))
    .filter(agent => !isAppBuilderKind(agent.kind) && !isOpsDiagnosisKind(agent.kind));
  const visible = await allowedAgents(agents, "VIEW", viewer);
  const byServiceId = new Map<string, string[]>();
  for (const agent of visible) {
    const label = assistantName(agent, viewer.locale);
    for (const serviceId of agent.enabled_mcp_service_ids ?? []) {
      const list = byServiceId.get(serviceId);
      if (list) list.push(label);
      else byServiceId.set(serviceId, [label]);
    }
  }
  return { hasVisibleAgents: visible.length > 0, byServiceId };
}

type FormInputs = Pick<PanelFormRequest, "values" | "changedField">;

export function createAgentDefinitionDirectory(owner: AssistantOwner, viewer: AssistantCredentials) {
  const systems = createSystemAgentOwners(owner, viewer);
  const word = (key: string) => tForLocale(viewer.locale, `panels.productCatalog.${key}`);
  const catalogueWord = (key: string) => word(`application.${key}`);
  const storedRecord = (agent: Pick<AgentRow, "id" | "kind" | "name" | "description" | "enabled" | "icon">,
    canEdit: boolean, domainShared?: boolean,
  ) => agentDefinitionRecord({
    id: agent.id,
    name: assistantName(agent, viewer.locale),
    description: assistantDescription(agent, viewer.locale),
    enabled: agent.enabled,
    icon: agent.icon,
  }, isPresetAgentKind(agent.kind) ? "preset" : "custom", viewer.locale, canEdit, domainShared);
  const systemRecord = (agent: SystemAgent, canEdit: boolean, domainShared?: boolean) =>
    agentDefinitionRecord({ ...agent, enabled: true }, "system", viewer.locale, canEdit, domainShared);

  async function viewRetrieval() {
    try {
      return await systems.retrieval.read();
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 403)) throw error;
      return undefined;
    }
  }

  async function grants(id: string) {
    validateId(id);
    return readAgentAccess(await agentPolicyDefinition(owner, viewer, id), viewer);
  }

  async function viewLocal(id: string) {
    const agent = await assistantStore.agent(id, owner);
    const object = agentObject(agent);
    const [view, edit] = await decideObjects([{ ...object, verb: "VIEW" }, { ...object, verb: "EDIT" }], viewer);
    requireAllowed(view);
    return { agent, canEdit: edit.allowed, object };
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
      const { VIEW, EDIT } = await readObjectRanges("AGENT", ["VIEW", "EDIT"], viewer);
      const agents = await assistantStore.agentDefinitionSummaries(owner.domainId, VIEW, { includeSystem: true, editRange: EDIT });
      const local = await Promise.all(agents.map(async agent => {
        const source = isAppBuilderKind(agent.kind) ? systems.builder : isOpsDiagnosisKind(agent.kind) ? systems.diagnosis : undefined;
        return source ? systemRecord(await source.read(), agent.editable) : storedRecord(agent, agent.editable);
      }));
      const retriever = await viewRetrieval();
      return retriever ? [...local, systemRecord(retriever, retriever.editable === true)] : local;
    },
    async count() {
      const [total, retriever] = await Promise.all([
        readObjectRanges("AGENT", ["VIEW"], viewer).then(({ VIEW }) =>
          assistantStore.countVisibleAgentDefinitions(owner.domainId, VIEW, { includeSystem: true })),
        viewRetrieval(),
      ]);
      return { rows: [], total: total + Number(retriever !== undefined) };
    },
    async record(primaryKey: string) {
      validateId(primaryKey);
      if (primaryKey === RETRIEVAL_AGENT_ID) {
        const retriever = await systems.retrieval.read();
        const shared = retriever.editable ? (await grants(primaryKey)).shared : undefined;
        return systemRecord(retriever, retriever.editable === true, shared);
      }
      const { agent, object, canEdit } = await viewLocal(primaryKey);
      const shared = canEdit ? (await readAgentAccess(object, viewer)).shared : undefined;
      const source = isAppBuilderKind(agent.kind) ? systems.builder : isOpsDiagnosisKind(agent.kind) ? systems.diagnosis : undefined;
      return source ? systemRecord(await source.read(), canEdit, shared) : storedRecord(agent, canEdit, shared);
    },
    async form(primaryKey: string, inputs: FormInputs) {
      validateId(primaryKey);
      if (primaryKey === RETRIEVAL_AGENT_ID) {
        const retriever = await systems.retrieval.read();
        return systemAgentForm(retriever, inputs, retriever.editable === true, viewer.locale);
      }
      const source = await systems.forTarget(primaryKey);
      if (!source)
        return describeAgentDefinitionForm({ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey }, ...inputs }, owner, viewer);
      const { canEdit } = await viewLocal(primaryKey);
      return systemAgentForm(await source.read(), inputs, canEdit, viewer.locale);
    },
    async createForm(inputs: FormInputs) {
      return describeAgentDefinitionForm({ target: { kind: "draft" }, ...inputs }, owner, viewer);
    },
    grants,
    async grantRows(primaryKey: string): Promise<PanelRecord[]> {
      const { grants: policyGrants, shared } = await grants(primaryKey);
      return [
        ...policyGrants.map(({ policyId, name, level }): PanelRecord => {
          const verb = level.toLowerCase();
          const levelLabel = level === "VIEW" ? word("grantView") : catalogueWord(level === "EDIT" ? "grantEdit" : "grantUse");
          return {
            primaryKey: policyId,
            className: AGENT_DEFINITION,
            label: name,
            fields: { policyId, level: verb, levelLabel, verb, verbLabel: levelLabel, revocable: true },
            fieldLabels: { levelLabel: catalogueWord("grantVerb"), verbLabel: catalogueWord("grantVerb") },
            tones: { levelLabel: level === "EDIT" ? "warning" : level === "VIEW" ? "info" : "default" },
          };
        }),
        ...(shared ? [{
          primaryKey: "domain", className: AGENT_DEFINITION, label: word("grantDomain"),
          fields: { level: "use", levelLabel: catalogueWord("grantUse"), revocable: false },
        }] : []),
      ];
    },
  };
}
